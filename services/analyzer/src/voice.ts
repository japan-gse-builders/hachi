import type { GoogleGenAI } from '@google/genai';
import type { Storage } from 'firebase-admin/storage';
import {
  measureVoiceTiming,
  monoWav,
  parseWav,
  tokenize,
  type SpeechExample,
  type Turn,
  type VoiceMeasures,
} from '@hachi/core';
import { z } from 'zod';
import { ReviewError } from './model.js';

/** Reads a call recording from `gs://bucket/path`. */
export interface RecordingSource {
  read(gsUri: string): Promise<Buffer>;
}

export class GcsRecordings implements RecordingSource {
  constructor(private readonly storage: Pick<Storage, 'bucket'>) {}

  async read(gsUri: string): Promise<Buffer> {
    const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri);
    if (!m) throw new Error('Recording location is not a gs:// URI');
    const [data] = await this.storage.bucket(m[1]!).file(m[2]!).download();
    return data;
  }
}

export const DISFLUENCY_KINDS = ['filler', 'repetition', 'false_start', 'correction'] as const;

/** What the model hears in the resident's channel. */
export interface ListeningReview {
  verbatim: string;
  disfluencies: { quote: string; kind: (typeof DISFLUENCY_KINDS)[number]; atSec: number }[];
  /** 0..1: how clearly the resident can be heard (line quality, not how they speak). */
  audioQuality: number;
}

export interface SpeechListener {
  readonly model: string;
  /**
   * `onUsage` reports what the request cost for the monthly spend ledger, in the same shape and for
   * the same reason as the reviewer's: passed in rather than returned so that the caches the
   * evaluation scripts wrap this in simply do not call it when they answer from disk.
   */
  listen(residentWav: Buffer, onUsage?: (tokens: { in: number; out: number }) => void): Promise<ListeningReview>;
}

export const listeningSchema = z.object({
  verbatim: z.string().max(20_000),
  disfluencies: z
    .array(z.object({ quote: z.string().trim().min(1).max(200), kind: z.enum(DISFLUENCY_KINDS), atSec: z.number().min(0) }))
    .max(500),
  audioQuality: z.number().min(0).max(1),
});

export const LISTENING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verbatim: { type: 'string' },
    disfluencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          kind: { type: 'string', enum: [...DISFLUENCY_KINDS] },
          atSec: { type: 'number', minimum: 0 },
        },
        required: ['quote', 'kind', 'atSec'],
      },
    },
    audioQuality: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['verbatim', 'disfluencies', 'audioQuality'],
} as const;

export const LISTENING_INSTRUCTION = [
  'You hear one side of a phone call: an older adult talking with an AI assistant. Only this person is audible.',
  'verbatim: transcribe exactly what they say. Keep every filler (um, uh, er), repeated word, cut-off word and restart. Do not tidy or complete sentences. Leave silence out.',
  'disfluencies: each filler, immediate repetition ("the the"), false start or cut-off word ("vi- visiting"), and self-correction ("Tuesday, no, Wednesday"). quote = the few words around it as spoken; atSec = seconds from the start of the audio.',
  'audioQuality: 0 to 1, how clearly the speech can be heard on this line (1 = clear). Judge the line and background noise, not the way they speak.',
  'Answer only with JSON that matches the schema.',
].join('\n');

/** Gemini listens to the resident's channel, because the live transcript smooths hesitations away. */
export class GeminiListener implements SpeechListener {
  constructor(
    private readonly ai: Pick<GoogleGenAI, 'models'>,
    readonly model: string,
  ) {}

  async listen(residentWav: Buffer, onUsage?: (tokens: { in: number; out: number }) => void): Promise<ListeningReview> {
    let raw: string | undefined;
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: residentWav.toString('base64') } }, { text: 'Transcribe and list the disfluencies.' }] }],
        config: {
          systemInstruction: LISTENING_INSTRUCTION,
          responseMimeType: 'application/json',
          responseJsonSchema: LISTENING_JSON_SCHEMA,
          temperature: 0,
        },
      });
      raw = res.text;
      const u = res.usageMetadata;
      if (u) onUsage?.({ in: u.promptTokenCount ?? 0, out: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new ReviewError(`Gemini listening failed: ${(err as Error).message}`, status === undefined || status === 429 || status >= 500);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      throw new ReviewError('Gemini listening returned invalid JSON', true, 'invalid_output');
    }
    const parsed = listeningSchema.safeParse(json);
    if (!parsed.success) throw new ReviewError(`Gemini listening output does not match the schema: ${parsed.error.issues[0]?.path.join('.')}`, true, 'invalid_output');
    return parsed.data;
  }
}

/** Less speech than this cannot be measured meaningfully, so the model is not asked. */
const MIN_RESIDENT_SPEECH_MS = 5_000;
const MAX_EXAMPLES = 4;

/** The resident turn that contains the answer starting at `ms` (transcript turns start late). */
function turnAt(transcript: Turn[], ms: number): Turn | undefined {
  return transcript.find((t) => t.speaker === 'resident' && t.endMs >= ms);
}

/**
 * SPK-01 / SPK-03 from the stereo recording: response time from when each side is audible, and
 * self-repairs from what the model hears. Returns the slowest answers and clearest repairs as
 * examples staff can play.
 */
export async function measureRecording(
  wav: Buffer,
  transcript: Turn[],
  listener: SpeechListener,
  onUsage?: (tokens: { in: number; out: number }) => void,
): Promise<VoiceMeasures & { audioQuality: number | null }> {
  const audio = parseWav(wav);
  const timing = measureVoiceTiming(audio);
  const slow: SpeechExample[] = [...timing.gaps]
    .sort((a, b) => b.gapMs - a.gapMs)
    .slice(0, 2)
    .flatMap((g) => {
      const t = turnAt(transcript, g.residentStartMs);
      return t ? [{ kind: 'slow_response' as const, quote: t.text.slice(0, 200), startMs: g.residentStartMs }] : [];
    });
  if (timing.residentSpeechMs < MIN_RESIDENT_SPEECH_MS) {
    return { responseLatencyMs: timing.responseLatencyMs, repairRate: null, examples: slow, audioQuality: null };
  }
  const heard = await listener.listen(monoWav(audio.channels[0]!, audio.sampleRate), onUsage);
  const words = tokenize(heard.verbatim).length;
  const repairs: SpeechExample[] = heard.disfluencies
    .filter((d) => d.kind !== 'filler')
    .slice(0, MAX_EXAMPLES - slow.length)
    .map((d) => ({ kind: d.kind, quote: d.quote, startMs: Math.round(d.atSec * 1000) }));
  return {
    responseLatencyMs: timing.responseLatencyMs,
    repairRate: words ? (heard.disfluencies.length / words) * 100 : null,
    examples: [...slow, ...repairs],
    audioQuality: heard.audioQuality,
  };
}
