/**
 * SYNTHETIC R1/R2 evaluation: runs synthetic call transcripts through the production worker
 * (`analyzeCall` → GeminiReviewer + analyse + recordDetections) against an in-memory store and
 * writes a report. Nothing is written to Firestore or Cloud Storage and no calls or texts are
 * placed; Gemini results are cached under eval/.cache/.
 *
 *   npm run eval:r12 -w @hachi/analyzer -- [--seed 2026 --seed 7] [--repeats 2] [--case r1p-stroke] [--fresh] [--concurrency 16]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { detectR1, type Detection } from '@hachi/core';
import { MemoryStore, type CallRecord, type Resident } from '@hachi/store';
import { groundEmergencies } from '../src/analysis.js';
import { formatTranscript, GeminiReviewer, ReviewError, reviewInstruction, type CallReviewer, type ModelReview, type ReviewInput } from '../src/model.js';
import { analyzeCall, type WorkerDeps } from '../src/worker.js';
import { renderReport, summarise, type CaseResult } from './r12-metrics.js';
import { generateR12Scenario, type ScriptedCase } from './r12-scenario.js';

const { values: args } = parseArgs({
  options: {
    seed: { type: 'string', multiple: true, default: ['2026', '7'] },
    repeats: { type: 'string', default: '2' },
    case: { type: 'string', multiple: true },
    fresh: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '16' },
    out: { type: 'string' },
  },
});

const EVAL_DIR = import.meta.dirname;
const CACHE = join(EVAL_DIR, '.cache');
const REPO = join(EVAL_DIR, '..', '..', '..');
const seeds = args.seed.map(Number);
const repeats = Number(args.repeats);
const outDir = args.out ?? (args.case ? join(CACHE, 'smoke') : join(REPO, 'docs', 'eval'));
const concurrency = Number(args.concurrency);
const project = process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'hachicall-nao';
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const location = process.env.GEMINI_LOCATION?.trim() || 'global';
/** USD per million tokens, for the cost estimate only. */
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_M ?? 0.5);
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_M ?? 3);

const sha = (...parts: string[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
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
let promptTokens = 0;
let outputTokens = 0;

const ai = new GoogleGenAI({ enterprise: true, project, location });
/** Counts tokens for the cost estimate; the request itself is unchanged. */
const metered = {
  models: {
    generateContent: async (req: Parameters<GoogleGenAI['models']['generateContent']>[0]) => {
      const res = await ai.models.generateContent(req);
      const u = res.usageMetadata;
      promptTokens += u?.promptTokenCount ?? 0;
      outputTokens += (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
      return res;
    },
  },
} as unknown as Pick<GoogleGenAI, 'models'>;
const gemini = new GeminiReviewer(metered, model);

/**
 * Cached Gemini review with the backoff Cloud Tasks would give; `repeat` keys an independent
 * sample of the same transcript. Remembers each review so the report can tell which R1 component fired.
 */
class EvalReviewer implements CallReviewer {
  readonly reviews = new Map<string, ModelReview>();
  readonly errors: string[] = [];
  constructor(private readonly repeat: number) {}
  get model() {
    return gemini.model;
  }
  async review(input: ReviewInput): Promise<ModelReview> {
    const transcript = formatTranscript(input.preferredName, input.transcript);
    const key = sha(model, reviewInstruction(input.staffLocale), transcript, `repeat-${this.repeat}`);
    try {
      const review = await cached(join(CACHE, 'gemini', `r12-review-${key}.json`), async () => {
        for (let i = 0; ; i++) {
          try {
            geminiRequests++;
            return await gemini.review(input);
          } catch (err) {
            if (!(err instanceof ReviewError) || !err.retryable || i + 1 >= 5) throw err;
            await sleep(1000 * 2 ** i + Math.random() * 500);
          }
        }
      });
      this.reviews.set(transcript, review);
      return review;
    } catch (err) {
      this.errors.push((err as Error).message);
      throw err;
    }
  }
}

const noQueue: TaskQueue = { enqueue: async (_req: EnqueueRequest) => 'created' };

function residentFor(c: ScriptedCase): Resident {
  const at = c.calls[0]!.startedAt;
  return {
    id: c.residentId,
    name: `${c.name} (synthetic)`,
    preferredName: c.name,
    phone: '',
    channel: 'pstn',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    staff: { name: 'Synthetic staff', phone: '' },
    familyLookup: [],
    serviceStartedAt: '2026-08-01T00:00:00.000Z',
    active: true,
    synthetic: true,
    createdAt: at,
    updatedAt: at,
  };
}

async function runCase(seed: number, repeat: number, c: ScriptedCase): Promise<CaseResult> {
  const store = new MemoryStore();
  const resident = residentFor(c);
  await store.createResident(resident);
  const reviewer = new EvalReviewer(repeat);
  let ids = 0;
  let detections: Detection[] = [];
  for (const sc of c.calls) {
    const endedAt = new Date(Date.parse(sc.startedAt) + sc.durationMs);
    const call: CallRecord = {
      id: sc.id,
      residentId: resident.id,
      source: 'live',
      synthetic: true,
      status: 'completed',
      channel: 'pstn',
      startedAt: sc.startedAt,
      endedAt: endedAt.toISOString(),
      durationSec: Math.round(sc.durationMs / 1000),
      localDate: sc.localDate,
      transcript: sc.transcript,
      analysisPending: true,
      createdAt: sc.startedAt,
    };
    await store.addCalls([call]);
    const now = new Date(endedAt.getTime() + 60_000);
    const deps: WorkerDeps = {
      store,
      reviewer,
      queue: noQueue,
      now: () => now,
      newId: () => `${c.residentId}-${++ids}`,
      config: { leaseSec: 300, settleSec: 0, modelAttempts: 1, staffLocale: 'en', appBaseUrl: 'https://hachi.invalid' },
    };
    const outcome = await analyzeCall(deps, { residentId: resident.id, callId: call.id });
    if (outcome.outcome !== 'analyzed') throw new Error(`${call.id}: ${JSON.stringify(outcome)}`);
    detections = (await store.listCasesByResident(resident.id)).flatMap((k) => k.detections).filter((d) => d.detectedAt === now.toISOString());
  }

  const last = c.calls.at(-1)!;
  const stored = await store.listCalls(resident.id);
  const review = reviewer.reviews.get(formatTranscript(resident.preferredName, last.transcript)) ?? null;
  const r1 = detections.find((d) => d.rule === 'R1');
  const r2 = detections.find((d) => d.rule === 'R2');
  const grounded = review ? groundEmergencies(review, last.transcript, last.id) : [];
  return {
    seed,
    repeat,
    caseId: c.spec.id,
    variant: c.variant,
    rule: c.spec.rule,
    polarity: c.spec.polarity,
    tag: c.spec.tag,
    expectR1: c.spec.expectR1,
    expectR2: c.spec.expectR2,
    reason: c.spec.reason,
    keyLines: last.keyLines,
    r1: {
      urgency: r1?.urgency ?? null,
      byRules: last.transcript.some((t) => t.speaker === 'resident' && detectR1(t.text).length > 0),
      byModel: grounded.length > 0,
      ...(grounded[0] ? { symptom: grounded.map((g) => g.symptom).join('; ') } : {}),
      quotes: r1?.evidence.map((e) => e.quote) ?? [],
    },
    r2: {
      urgency: r2?.urgency ?? null,
      poorIntakeDays: r2?.poorIntakeDays ?? null,
      intake: c.calls.map((sc) => {
        const i = stored.find((x) => x.id === sc.id)?.analysis?.intake;
        return { day: sc.day, status: i?.status ?? 'unknown', ...(i?.reportedPoorDays ? { reportedPoorDays: i.reportedPoorDays } : {}) };
      }),
    },
    reviewErrors: reviewer.errors,
  };
}

// ---------------------------------------------------------------- main

const started = Date.now();
const scenarios = seeds.map((seed) => generateR12Scenario(seed, args.case ? { cases: args.case } : {}));
const jobs = scenarios.flatMap((s) => Array.from({ length: repeats }, (_, repeat) => s.cases.map((c) => ({ seed: s.seed, repeat, c }))).flat());
const calls = jobs.reduce((a, j) => a + j.c.calls.length, 0);
const caseCount = new Set(scenarios[0]?.cases.map((c) => c.spec.id)).size;
console.log(`SYNTHETIC R1/R2 eval: seeds ${seeds.join(', ')} × ${repeats} repeats, ${caseCount} cases × 2 variants, ${calls} calls, model ${model}`);

let done = 0;
const results = await pool(jobs, concurrency, async (j) => {
  const r = await runCase(j.seed, j.repeat, j.c);
  if (++done % 20 === 0 || done === jobs.length) console.log(`  analysed ${done}/${jobs.length} cases`);
  return r;
});

const summary = summarise(results);
const cost = promptTokens || outputTokens ? (promptTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1e6 : null;
const run = {
  synthetic: true,
  seeds,
  repeats,
  generatedAt: new Date().toISOString(),
  model,
  cases: caseCount,
  calls,
  durationSec: (Date.now() - started) / 1000,
  geminiRequests,
  promptTokens,
  outputTokens,
  estimatedCostUsd: cost,
};
const transcripts = scenarios.flatMap((s) =>
  s.cases.map((c) => ({ seed: s.seed, caseId: c.spec.id, variant: c.variant, calls: c.calls.map((sc) => ({ id: sc.id, turns: sc.transcript.map((t) => `${t.speaker}: ${t.text}`) })) })),
);
const oneLineEach = (xs: unknown[]) => `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, 'r12-synthetic.json'),
  `{\n  "run": ${JSON.stringify(run)},\n  "summary": ${JSON.stringify(summary, null, 1)},\n  "results": ${oneLineEach(results)},\n  "transcripts": ${oneLineEach(transcripts)}\n}\n`,
);
await writeFile(join(outDir, 'r12-synthetic.md'), renderReport(summary, run));

const p = summary.pooled;
const f = (r: { hits: number; total: number }) => `${r.hits}/${r.total}`;
console.log(
  [
    `R1 sensitivity ${f(p.r1.sensitivity)}, specificity ${f(p.r1.specificity)} (rules ${f(p.r1.rulesOnly.sensitivity)}/${f(p.r1.rulesOnly.specificity)}, Gemini ${f(p.r1.modelOnly.sensitivity)}/${f(p.r1.modelOnly.specificity)})`,
    `R2 sensitivity ${f(p.r2.sensitivity)}, specificity ${f(p.r2.specificity)}, urgency match ${f(p.r2.urgencyMatch)}`,
    `misses ${summary.misses.length}, unstable ${summary.unstable.length}; Gemini requests ${geminiRequests}, tokens ${promptTokens}/${outputTokens}${cost !== null ? ` ≈ $${cost.toFixed(3)}` : ''}; ${Math.round(run.durationSec)} s`,
    `report: ${join(outDir, 'r12-synthetic.md')}`,
  ].join('\n'),
);
