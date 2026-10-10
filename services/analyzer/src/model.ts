import type { GoogleGenAI } from '@google/genai';
import { ANSWER_LABELS, WELLBEING_TAG_IDS, WELLBEING_TAGS, type Locale, type ScreenItem, type TagBasis, type Turn } from '@hachi/core';
import { z } from 'zod';

/** A wellbeing tag as the model returned it; `id` is checked against the vocabulary later. */
export interface ModelTag {
  id: string;
  turn: number;
  basis: TagBasis;
  confidence: number;
}

/** What the model returns for one call. Turn numbers refer to the `[n]` labels of the transcript. */
export interface ModelReview {
  emergencies: { turn: number; quote: string; symptom: string; confidence: number }[];
  intake: { status: 'normal' | 'poor' | 'unknown'; fluids: 'normal' | 'poor' | 'unknown'; reportedPoorDays: number; evidenceTurns: number[] };
  staffSummary: { health: string; meals: string; topics: string[] };
  familySummary: { health: string; meals: string; topics: string[] };
  memory: { topics: string[]; plans: string[]; likes: string[] };
  topicCoherence: number;
  temporaryCondition: boolean;
  noisy: boolean;
  tags: ModelTag[];
  headline: string;
  /** Which of the call's set questions the resident answered, and with which of its options. */
  answers: { itemId: string; answer: string; turn: number }[];
  /** The resident asked for someone to ring them; absent when they did not. */
  contactRequest?: { who: string; confirmed: boolean; turn: number };
}

export interface ReviewInput {
  preferredName: string;
  transcript: Turn[];
  staffLocale: Locale;
  /** The set questions this call was told to ask; nothing else can be answered. */
  items?: readonly ScreenItem[];
  /**
   * What the request cost, as the provider reported it, for the monthly spend ledger. Passed in
   * rather than returned so that a reviewer which cannot report usage — the caches and replayers
   * the evaluation scripts use — simply does not call it.
   */
  onUsage?(tokens: { in: number; out: number }): void;
}

export interface CallReviewer {
  readonly model: string;
  review(input: ReviewInput): Promise<ModelReview>;
}

/** What went wrong with a Gemini request, so a failed analysis can say why without its raw message. */
export type ReviewFailure = 'unavailable' | 'rejected' | 'invalid_output';

export class ReviewError extends Error {
  readonly kind: ReviewFailure;

  constructor(
    message: string,
    readonly retryable: boolean,
    kind?: ReviewFailure,
  ) {
    super(message);
    this.name = 'ReviewError';
    this.kind = kind ?? (retryable ? 'unavailable' : 'rejected');
  }
}

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, len = 200) => z.array(text(len)).max(max);
const turn = z.number().int().min(0);
const summary = z.object({ health: text(600), meals: text(600), topics: list(8) });

const MAX_TAGS = 30;
const tag = z.object({ id: z.string(), turn, basis: z.enum(['said', 'inferred']), confidence: z.number().min(0).max(1) });
/** A malformed tag or headline is dropped rather than failing the review, so R1/R2 never wait on them. */
const tags = z
  .array(z.unknown())
  .catch([])
  .transform((xs) => xs.flatMap((x) => tag.safeParse(x).data ?? []).slice(0, MAX_TAGS));
const headline = z.string().catch('').transform((s) => s.trim());
const MAX_ANSWERS = 8;
const answer = z.object({ itemId: z.string(), answer: text(80), turn });
/** An unusable answer is dropped, like a tag, so a set question never holds up R1 or R2. */
const answers = z
  .array(z.unknown())
  .catch([])
  .transform((xs) => xs.flatMap((x) => answer.safeParse(x).data ?? []).slice(0, MAX_ANSWERS));

export const reviewSchema = z.object({
  emergencies: z
    .array(z.object({ turn, quote: text(400), symptom: text(120), confidence: z.number().min(0).max(1) }))
    .max(10),
  intake: z.object({
    status: z.enum(['normal', 'poor', 'unknown']),
    fluids: z.enum(['normal', 'poor', 'unknown']).catch('unknown'),
    reportedPoorDays: z.number().int().min(0).max(30),
    evidenceTurns: z.array(turn).max(10),
  }),
  staffSummary: summary,
  familySummary: summary,
  memory: z.object({ topics: list(8, 120), plans: list(5, 160), likes: list(8, 120) }),
  topicCoherence: z.number().min(0).max(1),
  temporaryCondition: z.boolean(),
  noisy: z.boolean(),
  tags,
  headline,
  answers,
  /**
   * Dropped rather than fatal, like a tag. The number itself is deliberately not taken from here:
   * it is read back out of the transcript turn, so a model that retypes a digit cannot change it.
   */
  contactRequest: z
    .unknown()
    .catch(null)
    .transform((x) => z.object({ who: text(80), confirmed: z.boolean(), turn }).safeParse(x).data),
});

const strings = { type: 'array', items: { type: 'string' } } as const;
const ints = { type: 'array', items: { type: 'integer' } } as const;
const summaryJson = {
  type: 'object',
  properties: { health: { type: 'string' }, meals: { type: 'string' }, topics: strings },
  required: ['health', 'meals', 'topics'],
} as const;

/** JSON Schema given to Gemini's structured output; `reviewSchema` re-validates the reply. */
export const responseJsonSchema = (items: readonly ScreenItem[] = []) => ({
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string', enum: items.map((i) => i.id) },
          answer: { type: 'string', enum: ANSWER_LABELS },
          turn: { type: 'integer' },
        },
        required: ['itemId', 'answer', 'turn'],
      },
    },
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
        fluids: { type: 'string', enum: ['normal', 'poor', 'unknown'] },
        reportedPoorDays: { type: 'integer', minimum: 0 },
        evidenceTurns: ints,
      },
      required: ['status', 'fluids', 'reportedPoorDays', 'evidenceTurns'],
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
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: WELLBEING_TAG_IDS },
          turn: { type: 'integer' },
          basis: { type: 'string', enum: ['said', 'inferred'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['id', 'turn', 'basis', 'confidence'],
      },
    },
    headline: { type: 'string' },
    contactRequest: {
      type: 'object',
      nullable: true,
      properties: {
        who: { type: 'string' },
        confirmed: { type: 'boolean' },
        turn: { type: 'integer' },
      },
      required: ['who', 'confirmed', 'turn'],
    },
  },
  required: ['emergencies', 'intake', 'staffSummary', 'familySummary', 'memory', 'topicCoherence', 'temporaryCondition', 'noisy', 'tags', 'headline', 'answers'],
});

const TAG_LIST = WELLBEING_TAGS.map((t) => `- ${t.id}: ${t.label.en}${'hint' in t ? ` (${t.hint})` : ''}`);

const STAFF_LANGUAGE: Record<Locale, string> = { ja: 'Japanese', en: 'English' };

/** DET-01/02, QUE-02, FAM-03, SPK-01/04, CNV-07. */
export function reviewInstruction(staffLocale: Locale, items: readonly ScreenItem[] = []): string {
  const asked = items.flatMap((i) => [
    `- ${i.id}: "${i.text}" Its answers: ${i.options.map((o) => o.label).join(' / ')}.`,
  ]);
  return [
    'You review the transcript of a daily check-in phone call between Hachi (an AI assistant) and an older adult who lives in Japan and speaks English.',
    'Answer only with JSON that matches the schema. Use only what is said in the transcript; never guess or add facts. Turn numbers refer to the [n] labels.',
    '',
    'emergencies: possible acute medical problems the resident has NOW, e.g. chest pain or pressure, trouble breathing or choking, being unable to move or get up, face drooping, slurred speech or sudden weakness, sudden loss of balance, sudden loss of sight or double vision, the worst headache they have ever had, fainting, heavy bleeding, feeling they are dying, or asking for help.',
    '- Include understated or hedged complaints ("it is nothing, but my chest feels a bit tight").',
    '- Exclude events in the past that are over, things that happened to other people, and denials ("no, my chest is fine").',
    '- If unsure whether it is current, include it with a lower confidence. Quote the resident\'s words verbatim and give the turn number of that resident turn.',
    'intake: whether the resident has eaten enough. "poor" if they say they have not eaten, barely ate, skipped meals, or have no appetite, today or yesterday; "normal" if they describe eating as usual; "unknown" if it was not discussed. reportedPoorDays: the number of days they said they have not eaten well (0 if not stated). evidenceTurns: resident turns about meals or drinks.',
    'intake.fluids: whether they have been drinking enough, judged separately from food. "poor" if they say they have drunk little or nothing, or are not thirsty; "normal" if they mention drinks as usual, such as tea with a meal; "unknown" if drinks did not come up. A meal alone does not make it "normal".',
    `staffSummary: for care staff, in ${STAFF_LANGUAGE[staffLocale]}. health = how they feel, meals = what and how much they ate, topics = short phrases. Write that it was not discussed if it was not. Do not diagnose.`,
    'familySummary: for family, in plain, warm English. Short, everyday words, no medical terms, no direct quotes, nothing about how they speak. Write that it was not discussed if it was not.',
    'memory: short phrases the resident mentioned that Hachi can ask about next time: topics and events, plans with their timing, and things they like (family, hobbies, pets).',
    'topicCoherence: 0 to 1, how well the resident\'s answers stay on topic and connect to each other (1 = fully coherent). Judge only the resident.',
    'temporaryCondition: true if the resident mentions something temporary that affects their speech today, such as a cold, sore throat, dentures, or being very tired.',
    'noisy: true if the transcript suggests heavy background noise or a bad line (many garbled or misheard turns).',
    'tags: wellbeing tags for this call, chosen ONLY from the list below (give the id). Tag only what the resident says about themselves for today or the last few days: not other people, not things long past, not denials ("I\'m not lonely" is not mood.lonely). Do not tag anything by default: leave a topic out when it was not talked about. turn = the resident turn the tag comes from. basis = "said" if the resident says it in so many words, "inferred" if it clearly follows from what they say. confidence = 0 to 1. Leave out anything that does not fit a tag.',
    ...TAG_LIST,
    asked.length
      ? [
          'answers: Hachi was asked to put the following set questions to the resident in this call. For each one the resident answered, give its id, the one of its own answers that matches what they said, and the resident turn it came from. Use only an answer listed for that question. Leave a question out if it was not asked, if they changed the subject, or if what they said does not settle it: a guessed answer is worse than none.',
          ...asked,
        ].join('\n')
      : 'answers: an empty list, because this call had no set questions.',
    'contactRequest: only if the resident said yes to Hachi\'s offer to tell someone they would like a phone call. who = the person as the resident described them, in their own words ("my daughter Mary", "my neighbour"). turn = the resident turn where they asked. confirmed = true only if Hachi read a phone number back to them digit by digit and they agreed it was right; false if they named someone without a number, or did not confirm one. Leave contactRequest out entirely if they declined, if Hachi never offered, or if they only talked about someone.',
    'headline: one short sentence for family in plain, warm English about what the resident said or did, using their name: what they ate, how they slept, where they went, who they saw, what they are planning. Mention a concern gently if there is one. Do not describe their mood or spirits (cheerful, in good spirits, content, calm, low, worried) unless they said it about themselves in so many words and you gave a mood tag with basis "said". No medical or diagnosis words, no quotes, nothing about how they speak, no details about money or medicines.',
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
          systemInstruction: reviewInstruction(input.staffLocale, input.items),
          responseMimeType: 'application/json',
          responseJsonSchema: responseJsonSchema(input.items),
          temperature: 0.2,
        },
      });
      raw = res.text;
      const u = res.usageMetadata;
      if (u) input.onUsage?.({ in: u.promptTokenCount ?? 0, out: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new ReviewError(`Gemini request failed: ${(err as Error).message}`, isRetryableStatus(status));
    }
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      throw new ReviewError('Gemini returned invalid JSON', true, 'invalid_output');
    }
    const parsed = reviewSchema.safeParse(json);
    if (!parsed.success) throw new ReviewError(`Gemini output does not match the schema: ${parsed.error.issues[0]?.path.join('.')}`, true, 'invalid_output');
    return parsed.data;
  }
}
