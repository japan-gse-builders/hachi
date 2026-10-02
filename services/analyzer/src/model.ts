import type { GoogleGenAI } from '@google/genai';
import type { Locale, Turn } from '@hachi/core';
import { z } from 'zod';

/** What the model returns for one call. Turn numbers refer to the `[n]` labels of the transcript. */
export interface ModelReview {
  emergencies: { turn: number; quote: string; symptom: string; confidence: number }[];
  intake: { status: 'normal' | 'poor' | 'unknown'; reportedPoorDays: number; evidenceTurns: number[] };
  staffSummary: { health: string; meals: string; topics: string[] };
  familySummary: { health: string; meals: string; topics: string[] };
  memory: { topics: string[]; plans: string[]; likes: string[] };
  topicCoherence: number;
  temporaryCondition: boolean;
  noisy: boolean;
}

export interface ReviewInput {
  preferredName: string;
  transcript: Turn[];
  staffLocale: Locale;
}

export interface CallReviewer {
  readonly model: string;
  review(input: ReviewInput): Promise<ModelReview>;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, len = 200) => z.array(text(len)).max(max);
const turn = z.number().int().min(0);
const summary = z.object({ health: text(600), meals: text(600), topics: list(8) });

export const reviewSchema = z.object({
  emergencies: z
    .array(z.object({ turn, quote: text(400), symptom: text(120), confidence: z.number().min(0).max(1) }))
    .max(10),
  intake: z.object({
    status: z.enum(['normal', 'poor', 'unknown']),
    reportedPoorDays: z.number().int().min(0).max(30),
    evidenceTurns: z.array(turn).max(10),
  }),
  staffSummary: summary,
  familySummary: summary,
  memory: z.object({ topics: list(8, 120), plans: list(5, 160), likes: list(8, 120) }),
  topicCoherence: z.number().min(0).max(1),
  temporaryCondition: z.boolean(),
  noisy: z.boolean(),
});

const strings = { type: 'array', items: { type: 'string' } } as const;
const ints = { type: 'array', items: { type: 'integer' } } as const;
const summaryJson = {
  type: 'object',
  properties: { health: { type: 'string' }, meals: { type: 'string' }, topics: strings },
  required: ['health', 'meals', 'topics'],
} as const;

/** JSON Schema given to Gemini's structured output; `reviewSchema` re-validates the reply. */
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    emergencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          turn: { type: 'integer' },
          quote: { type: 'string' },
          symptom: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['turn', 'quote', 'symptom', 'confidence'],
      },
    },
    intake: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['normal', 'poor', 'unknown'] },
        reportedPoorDays: { type: 'integer', minimum: 0 },
        evidenceTurns: ints,
      },
      required: ['status', 'reportedPoorDays', 'evidenceTurns'],
    },
    staffSummary: summaryJson,
    familySummary: summaryJson,
    memory: {
      type: 'object',
      properties: { topics: strings, plans: strings, likes: strings },
      required: ['topics', 'plans', 'likes'],
    },
    topicCoherence: { type: 'number', minimum: 0, maximum: 1 },
    temporaryCondition: { type: 'boolean' },
    noisy: { type: 'boolean' },
  },
  required: ['emergencies', 'intake', 'staffSummary', 'familySummary', 'memory', 'topicCoherence', 'temporaryCondition', 'noisy'],
} as const;

const STAFF_LANGUAGE: Record<Locale, string> = { ja: 'Japanese', en: 'English' };

/** DET-01/02, QUE-02, FAM-03, SPK-01/04, CNV-07. */
export function reviewInstruction(staffLocale: Locale): string {
  return [
    'You review the transcript of a daily check-in phone call between Hachi (an AI assistant) and an older adult who lives in Japan and speaks English.',
    'Answer only with JSON that matches the schema. Use only what is said in the transcript; never guess or add facts. Turn numbers refer to the [n] labels.',
    '',
    'emergencies: possible acute medical problems the resident has NOW, e.g. chest pain or pressure, trouble breathing or choking, being unable to move or get up, face drooping, slurred speech or sudden weakness, fainting, heavy bleeding, feeling they are dying, or asking for help.',
    '- Include understated or hedged complaints ("it is nothing, but my chest feels a bit tight").',
    '- Exclude events in the past that are over, things that happened to other people, and denials ("no, my chest is fine").',
    '- If unsure whether it is current, include it with a lower confidence. Quote the resident\'s words verbatim and give the turn number of that resident turn.',
    'intake: whether the resident has eaten enough. "poor" if they say they have not eaten, barely ate, skipped meals, or have no appetite, today or yesterday; "normal" if they describe eating as usual; "unknown" if it was not discussed. reportedPoorDays: the number of days they said they have not eaten well (0 if not stated). evidenceTurns: resident turns about meals.',
    `staffSummary: for care staff, in ${STAFF_LANGUAGE[staffLocale]}. health = how they feel, meals = what and how much they ate, topics = short phrases. Write that it was not discussed if it was not. Do not diagnose.`,
    'familySummary: for family, in plain, warm English. Short, everyday words, no medical terms, no direct quotes, nothing about how they speak. Write that it was not discussed if it was not.',
    'memory: short phrases the resident mentioned that Hachi can ask about next time: topics and events, plans with their timing, and things they like (family, hobbies, pets).',
    'topicCoherence: 0 to 1, how well the resident\'s answers stay on topic and connect to each other (1 = fully coherent). Judge only the resident.',
    'temporaryCondition: true if the resident mentions something temporary that affects their speech today, such as a cold, sore throat, dentures, or being very tired.',
    'noisy: true if the transcript suggests heavy background noise or a bad line (many garbled or misheard turns).',
  ].join('\n');
}

export function formatTranscript(preferredName: string, transcript: Turn[]): string {
  return [
    `Resident: ${preferredName}`,
    'Transcript:',
    ...transcript.map((t, i) => `[${i}] ${t.speaker === 'agent' ? 'Hachi' : 'Resident'}: ${t.text}`),
  ].join('\n');
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

/** Gemini on Gemini Enterprise Agent Platform (Vertex AI) with structured JSON output. */
export class GeminiReviewer implements CallReviewer {
  constructor(
    private readonly ai: Pick<GoogleGenAI, 'models'>,
    readonly model: string,
  ) {}

  async review(input: ReviewInput): Promise<ModelReview> {
    let raw: string | undefined;
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: formatTranscript(input.preferredName, input.transcript),
        config: {
          systemInstruction: reviewInstruction(input.staffLocale),
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0.2,
        },
      });
      raw = res.text;
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new ReviewError(`Gemini request failed: ${(err as Error).message}`, isRetryableStatus(status));
    }
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      throw new ReviewError('Gemini returned invalid JSON', true);
    }
    const parsed = reviewSchema.safeParse(json);
    if (!parsed.success) throw new ReviewError(`Gemini output does not match the schema: ${parsed.error.issues[0]?.path.join('.')}`, true);
    return parsed.data;
  }
}
