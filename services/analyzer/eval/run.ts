/**
 * SYNTHETIC R3 evaluation: synthesises calls, runs them through the production analysis path
 * (measureRecording + GeminiReviewer + analyse) and writes a report. No resident, call or case is
 * written to Firestore and nothing is written to Cloud Storage; Gemini and TTS results are cached
 * under eval/.cache/. What this run spends *is* written to the monthly spend ledger — see
 * eval/spend.ts for why that is not optional.
 *
 *   npm run eval:r3 -w @hachi/analyzer -- [--seed 2026] [--people N] [--calls N] [--fresh] [--concurrency 6] [--ignore-budget]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { assessSpeechChange, buildBaseline, measureVoiceTiming, median, parseWav, tokenize, USD, type CallSpeechSample, type Turn } from '@hachi/core';
import type { CallRecord, Resident } from '@hachi/store';
import { analyse } from '../src/analysis.js';
import { formatTranscript, GeminiReviewer, ReviewError, reviewInstruction, type CallReviewer, type ModelReview, type ReviewInput } from '../src/model.js';
import { GeminiListener, LISTENING_INSTRUCTION, measureRecording, type ListeningReview, type SpeechListener } from '../src/voice.js';
import { mixCall, trimSilence, type Clip } from './mix.js';
import { renderReport, summarise, type CallResult } from './metrics.js';
import { CHANGE_START_DAY, countByKind, generateScenario, HACHI_VOICE, hashSeed, type PersonProfile, type ScriptedCall } from './scenario.js';
import { BudgetRefused, openEvalSpend, spendBanner, type EvalSpend } from './spend.js';
import { CloudTts, TTS_SAMPLE_RATE } from './tts.js';

const { values: args } = parseArgs({
  options: {
    seed: { type: 'string', default: '2026' },
    people: { type: 'string' },
    calls: { type: 'string' },
    fresh: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '6' },
    out: { type: 'string' },
    'ignore-budget': { type: 'boolean', default: false },
  },
});

const EVAL_DIR = import.meta.dirname;
const CACHE = join(EVAL_DIR, '.cache');
const REPO = join(EVAL_DIR, '..', '..', '..');
const seed = Number(args.seed);
const limited = args.people !== undefined || args.calls !== undefined;
const outDir = args.out ?? (limited ? join(CACHE, 'smoke') : join(REPO, 'docs', 'eval'));
const concurrency = Number(args.concurrency);
const project = process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'hachicall-nao';
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const location = process.env.GEMINI_LOCATION?.trim() || 'global';

const sha = (...parts: (string | Buffer)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** Retries retryable model errors with exponential backoff, as Cloud Tasks would. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ReviewError) || !err.retryable || i + 1 >= attempts) throw err;
      await sleep(1000 * 2 ** i + Math.random() * 500);
    }
  }
}

async function cached<T>(file: string, compute: () => Promise<T>): Promise<T> {
  if (!args.fresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      // Not cached yet.
    }
  }
  const value = await compute();
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}

let geminiRequests = 0;

class CachedListener implements SpeechListener {
  heard: ListeningReview | null = null;
  constructor(private readonly inner: SpeechListener) {}
  get model() {
    return this.inner.model;
  }
  async listen(residentWav: Buffer, onUsage?: (tokens: { in: number; out: number }) => void): Promise<ListeningReview> {
    const key = sha(this.inner.model, LISTENING_INSTRUCTION, residentWav);
    this.heard = await cached(join(CACHE, 'gemini', `listen-${key}.json`), () => {
      geminiRequests++;
      return this.inner.listen(residentWav, onUsage);
    });
    return this.heard;
  }
}

class CachedReviewer implements CallReviewer {
  constructor(private readonly inner: CallReviewer) {}
  get model() {
    return this.inner.model;
  }
  review(input: ReviewInput): Promise<ModelReview> {
    const key = sha(this.inner.model, reviewInstruction(input.staffLocale), formatTranscript(input.preferredName, input.transcript));
    return cached(join(CACHE, 'gemini', `review-${key}.json`), () => {
      geminiRequests++;
      return this.inner.review(input);
    });
  }
}

// ---------------------------------------------------------------- synthesis

interface Rendered {
  call: ScriptedCall;
  profile: PersonProfile;
  wav: Buffer;
  transcript: Turn[];
  durationMs: number;
}

const tts = new CloudTts(join(CACHE, 'tts'), project);

async function render(call: ScriptedCall, profile: PersonProfile): Promise<Rendered> {
  const clips: Clip[] = [];
  for (const t of call.turns) {
    const pcm = t.speaker === 'agent' ? await tts.synth(HACHI_VOICE, t.spoken, 1) : await tts.synth(profile.voice, t.spoken, profile.speakingRate);
    clips.push({ speaker: t.speaker, pcm: trimSilence(pcm, TTS_SAMPLE_RATE), gapBeforeMs: t.gapBeforeMs, text: t.text });
  }
  const mixed = mixCall(clips, { sampleRate: TTS_SAMPLE_RATE, noiseSeed: hashSeed(seed, call.id, 'noise') });
  const dir = join(CACHE, 'calls', String(seed));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${call.id}.wav`), mixed.wav);
  return { call, profile, ...mixed };
}

// ---------------------------------------------------------------- main

const started = Date.now();

// Before the first byte of TTS, because the cheapest moment to refuse is the one before anything
// has been spent.
let spend: EvalSpend;
try {
  spend = await openEvalSpend({ project, ignoreBudget: args['ignore-budget'] });
} catch (err) {
  if (!(err instanceof BudgetRefused)) throw err;
  console.error(`eval:r3 refused: ${err.message}`);
  process.exit(1);
}
console.log(spendBanner(spend));

const scenario = generateScenario(seed, {
  ...(args.people ? { people: Number(args.people) } : {}),
  ...(args.calls ? { calls: Number(args.calls) } : {}),
});
const all = scenario.people.flatMap((p) => p.calls.map((call) => ({ call, profile: p.profile })));
console.log(`SYNTHETIC R3 eval: seed ${seed}, ${scenario.people.length} people, ${all.length} calls, model ${model}`);

const rendered = await pool(all, 4, ({ call, profile }) => render(call, profile));
console.log(`synthesised ${rendered.length} calls (TTS: ${tts.requests} new requests, ${tts.cached} cached clips)`);

const ai = new GoogleGenAI({ enterprise: true, project, location });
const reviewer = new CachedReviewer(new GeminiReviewer(ai, model));
let done = 0;
const heardAll = await pool(rendered, concurrency, async (r) => {
  const listener = new CachedListener(new GeminiListener(ai, model));
  const onUsage = (t: { in: number; out: number }) => spend.record(t);
  const [measured, review] = await Promise.allSettled([
    withRetry(() => measureRecording(r.wav, r.transcript, listener, onUsage)),
    withRetry(() => reviewer.review({ preferredName: r.profile.name, transcript: r.transcript, staffLocale: 'en', onUsage })),
  ]);
  if (++done % 10 === 0 || done === rendered.length) console.log(`  analysed audio/transcript ${done}/${rendered.length}`);
  return { measured, review, heard: listener.heard };
});

const message = (e: unknown) => (e as Error)?.message ?? String(e);
const results: CallResult[] = [];
for (const person of scenario.people) {
  const p = person.profile;
  const resident: Resident = {
    id: p.id,
    name: `${p.name} (synthetic)`,
    preferredName: p.name,
    phone: '',
    channel: 'pstn',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    staff: { name: 'Synthetic staff', phone: '' },
    familyLookup: [],
    serviceStartedAt: scenario.serviceStartedAt,
    active: true,
    createdAt: scenario.serviceStartedAt,
    updatedAt: scenario.serviceStartedAt,
  };
  const history: CallRecord[] = [];
  for (const sc of person.calls) {
    const i = rendered.findIndex((r) => r.call.id === sc.id);
    const r = rendered[i]!;
    const { measured, review, heard } = heardAll[i]!;
    const endedAt = new Date(Date.parse(sc.startedAt) + r.durationMs).toISOString();
    const call: CallRecord = {
      id: sc.id,
      residentId: p.id,
      source: 'live',
      status: 'completed',
      channel: 'pstn',
      startedAt: sc.startedAt,
      endedAt,
      durationSec: Math.round(r.durationMs / 1000),
      localDate: sc.startedAt.slice(0, 10),
      audioUri: `synthetic://${sc.id}.wav`,
      transcript: r.transcript,
      analysisPending: true,
      createdAt: sc.startedAt,
    };
    const voice = measured.status === 'fulfilled' ? measured.value : null;
    const modelReview = review.status === 'fulfilled' ? review.value : null;
    const result = analyse({
      resident,
      call,
      transcript: r.transcript,
      history: [...history].reverse(),
      review: modelReview,
      timing: voice ?? 'unavailable',
      ...(voice?.audioQuality != null ? { audioQuality: voice.audioQuality } : {}),
      model,
      ...(review.status === 'rejected' ? { modelError: message(review.reason) } : {}),
      ...(measured.status === 'rejected' ? { voiceError: message(measured.reason) } : {}),
      now: new Date(endedAt),
    });
    const speech = result.update.speech!;
    const samples = [speech, ...history.map((c) => c.speech).filter((s): s is CallSpeechSample => !!s)];
    const a = assessSpeechChange(samples, buildBaseline(samples, resident.serviceStartedAt));
    const forced = [{ ...speech, usable: true, exclusionReasons: [] }, ...samples.slice(1)];
    const ifIncluded = speech.usable ? null : assessSpeechChange(forced, buildBaseline(forced, resident.serviceStartedAt));
    history.push({ ...call, ...result.update, analysisPending: false });

    const r3 = result.detections.find((d) => d.rule === 'R3');
    const residentTurns = sc.turns.filter((t) => t.speaker === 'resident');
    const gaps = residentTurns.map((t) => t.gapBeforeMs);
    results.push({
      personId: p.id,
      callId: sc.id,
      day: sc.day,
      strength: sc.strength,
      ...(sc.condition ? { condition: sc.condition } : {}),
      scripted: {
        gapsMs: gaps,
        medianGapMs: median(gaps)!,
        disfluencies: countByKind(sc.disfluencies),
        spokenWords: tokenize(residentTurns.map((t) => t.spoken).join(' ')).length,
      },
      measured: {
        responseLatencyMs: voice?.responseLatencyMs ?? null,
        gapCount: measureVoiceTiming(parseWav(r.wav)).gaps.length,
        repairRate: voice?.repairRate ?? null,
        heard: heard ? countByKind(heard.disfluencies) : null,
        heardWords: heard ? tokenize(heard.verbatim).length : null,
        audioQuality: voice?.audioQuality ?? null,
        ...(measured.status === 'rejected' ? { error: message(measured.reason) } : {}),
      },
      review: modelReview ? { topicCoherence: modelReview.topicCoherence, temporaryCondition: modelReview.temporaryCondition, noisy: modelReview.noisy } : null,
      ...(review.status === 'rejected' ? { reviewError: message(review.reason) } : {}),
      sample: { usable: speech.usable, exclusionReasons: speech.exclusionReasons, features: speech.features },
      assessment: {
        status: speech.usable ? a.status : 'excluded',
        urgency: speech.usable ? a.urgency : null,
        magnitude: a.magnitude,
        trend: a.trend,
        contributors: a.contributors.map((c) => ({ feature: c.feature, adverseZ: Math.round(c.adverseZ * 100) / 100 })),
        ...(ifIncluded ? { ifIncluded: { urgency: ifIncluded.urgency, magnitude: ifIncluded.magnitude } } : {}),
      },
      detection: r3 ? { urgency: r3.urgency, summary: r3.summary, magnitude: r3.changeMagnitude ?? 0 } : null,
      otherRules: result.detections.filter((d) => d.rule !== 'R3').map((d) => d.rule),
    });
  }
}

const summary = summarise(
  scenario.people.map(({ profile: p }) => ({ id: p.id, name: p.name, change: p.change, expected: p.expected, expectedFeatures: p.expectedFeatures, note: p.note })),
  results,
  CHANGE_START_DAY,
);
await spend.flush();
const run = {
  synthetic: true,
  seed,
  generatedAt: new Date().toISOString(),
  model,
  people: scenario.people.length,
  calls: results.length,
  durationSec: (Date.now() - started) / 1000,
  geminiRequests,
  ttsRequests: tts.requests,
  spentUsd: spend.spentMicros / USD,
};
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'r3-synthetic.json'), `${JSON.stringify({ run, summary, calls: results }, null, 2)}\n`);
await writeFile(join(outDir, 'r3-synthetic.md'), renderReport(summary, run));

const d = summary.detection;
console.log(
  [
    `sensitivity ${d.changedDetected}/${d.changed}, stable flagged ${d.stableFlagged}/${d.stable}, FP calls ${d.stableFlaggedCalls}/${d.stableAssessedCalls}`,
    `timing MAE ${Math.round(summary.timing.maeMs)} ms, disfluency recall ${Math.round(summary.disfluency.recall * 100)}% precision ${Math.round(summary.disfluency.precision * 100)}%`,
    `errors: listening ${summary.errors.listening}, review ${summary.errors.review}; Gemini requests ${geminiRequests}; ${Math.round(run.durationSec)} s`,
    spend.describe(),
    `report: ${join(outDir, 'r3-synthetic.md')}`,
  ].join('\n'),
);
