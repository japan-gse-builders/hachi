import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { parseSpendSettings, type Turn } from '@hachi/core';
import { MemoryStore, type CallRecord, type Resident } from '@hachi/store';
import { ReviewError, type CallReviewer, type ModelReview, type ReviewInput } from '../src/model.js';
import type { ListeningReview, RecordingSource, SpeechListener } from '../src/voice.js';
import type { WorkerDeps } from '../src/worker.js';

export const NOW = new Date('2026-10-02T03:00:00.000Z');

export function resident(overrides: Partial<Resident> = {}): Resident {
  return {
    id: 'res-1',
    name: 'Margaret Smith',
    preferredName: 'Maggie',
    phone: '+819000000001',
    channel: 'pstn',
    callTime: '11:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    staff: { name: 'Tanaka', phone: '+81300000000', email: 'staff@example.org' },
    family: { name: 'Alice', sms: '+819000000002', email: 'alice@example.org' },
    familyLookup: ['+819000000002', 'alice@example.org'],
    serviceStartedAt: '2026-08-01T00:00:00.000Z',
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

export const TRANSCRIPT: Turn[] = [
  { speaker: 'agent', text: 'Good morning Maggie, this is Hachi, an AI assistant. How are you today?', startMs: 0, endMs: 4000 },
  { speaker: 'resident', text: 'Oh I am fine, a little tired. My grandson Ken is visiting on Sunday.', startMs: 4500, endMs: 9000 },
  { speaker: 'agent', text: 'How lovely. Have you had something to eat today?', startMs: 9500, endMs: 12000 },
  { speaker: 'resident', text: 'Not really, I only had a biscuit yesterday and nothing this morning.', startMs: 12500, endMs: 17000 },
];

export function call(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: '2026-10-02-1',
    residentId: 'res-1',
    source: 'live',
    status: 'completed',
    channel: 'pstn',
    startedAt: '2026-10-02T02:00:00.000Z',
    endedAt: '2026-10-02T02:05:00.000Z',
    localDate: '2026-10-02',
    transcript: TRANSCRIPT,
    conversation: { endedBy: 'agent', at: '2026-10-02T02:05:00.000Z' },
    analysisPending: true,
    createdAt: '2026-10-02T02:00:00.000Z',
    ...overrides,
  };
}

export function review(overrides: Partial<ModelReview> = {}): ModelReview {
  return {
    emergencies: [],
    answers: [],
    intake: { status: 'normal', fluids: 'normal', reportedPoorDays: 0, evidenceTurns: [] },
    staffSummary: { health: 'Feeling a little tired', meals: 'Skipped breakfast', topics: ['Grandson visiting'] },
    familySummary: { health: 'A little tired', meals: 'Ate very little', topics: ['Grandson visiting'] },
    memory: { topics: ['grandson Ken'], plans: ['Ken visits on Sunday'], likes: ['grandson Ken'] },
    topicCoherence: 0.9,
    temporaryCondition: false,
    noisy: false,
    tags: [
      { id: 'body.tired', turn: 1, basis: 'said', confidence: 0.9 },
      { id: 'mood.looking_forward', turn: 1, basis: 'inferred', confidence: 0.92 },
      { id: 'food.ate_little', turn: 3, basis: 'said', confidence: 0.95 },
    ],
    headline: 'Maggie was a little tired and had not eaten much, but is looking forward to her grandson visiting.',
    ...overrides,
  };
}

export class FakeReviewer implements CallReviewer {
  readonly model = 'gemini-test';
  readonly inputs: ReviewInput[] = [];
  readonly results: (ModelReview | Error)[] = [];
  fallback: ModelReview = review();

  async review(input: ReviewInput): Promise<ModelReview> {
    this.inputs.push(input);
    const r = this.results.shift() ?? this.fallback;
    if (r instanceof Error) throw r;
    return r;
  }

  next(...r: (ModelReview | Error)[]): this {
    this.results.push(...r);
    return this;
  }
}

export class FakeQueue implements TaskQueue {
  readonly tasks: EnqueueRequest[] = [];
  fail = false;

  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    if (this.fail) throw new Error('tasks unavailable');
    if (this.tasks.some((t) => t.name === req.name)) return 'exists';
    this.tasks.push(req);
    return 'created';
  }
}

const RATE = 8000;

function tone(durationMs: number, speech: [number, number][]): Int16Array {
  const out = new Int16Array((durationMs * RATE) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? 20 : -20;
  for (const [a, b] of speech) for (let i = (a * RATE) / 1000; i < (b * RATE) / 1000; i++) out[i] = Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / RATE));
  return out;
}

/** Stereo call recording matching TRANSCRIPT: Hachi on the right, the resident answering on the left. */
export function recording(residentSpeech: [number, number][] = [[5000, 9000], [13000, 17000]], durationMs = 18000): Buffer {
  const left = tone(durationMs, residentSpeech);
  const right = tone(durationMs, [[0, 4000], [9500, 12000]]);
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i++) {
    data.writeInt16LE(left[i]!, i * 4);
    data.writeInt16LE(right[i]!, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function listening(overrides: Partial<ListeningReview> = {}): ListeningReview {
  return {
    verbatim: 'Oh I am fine, um, a little tired. My grand- grandson Ken is visiting on Sunday. Not really, I only had a a biscuit.',
    disfluencies: [
      { quote: 'fine, um, a little', kind: 'filler', atSec: 5.5 },
      { quote: 'grand- grandson', kind: 'false_start', atSec: 7.2 },
      { quote: 'a a biscuit', kind: 'repetition', atSec: 15.1 },
    ],
    audioQuality: 0.9,
    ...overrides,
  };
}

export class FakeListener implements SpeechListener {
  readonly model = 'gemini-test';
  readonly heard: Buffer[] = [];
  readonly results: (ListeningReview | Error)[] = [];
  fallback: ListeningReview = listening();

  async listen(wav: Buffer): Promise<ListeningReview> {
    this.heard.push(wav);
    const r = this.results.shift() ?? this.fallback;
    if (r instanceof Error) throw r;
    return r;
  }
}

export class FakeRecordings implements RecordingSource {
  readonly reads: string[] = [];
  readonly results: (Buffer | Error)[] = [];
  fallback: Buffer = recording();

  async read(uri: string): Promise<Buffer> {
    this.reads.push(uri);
    const r = this.results.shift() ?? this.fallback;
    if (r instanceof Error) throw r;
    return r;
  }
}

export const unavailable = () => new ReviewError('Gemini request failed: 503', true);
export const rejected = () => new ReviewError('Gemini request failed: 400', false);

export async function setup(opts: { calls?: CallRecord[]; resident?: Resident | null; notifications?: boolean; voice?: boolean } = {}) {
  const store = new MemoryStore();
  if (opts.resident !== null) await store.createResident(opts.resident ?? resident());
  await store.addCalls(opts.calls ?? [call()]);
  const reviewer = new FakeReviewer();
  const queue = new FakeQueue();
  const notifications = new FakeQueue();
  const listener = new FakeListener();
  const recordings = new FakeRecordings();
  let clock = NOW.getTime();
  let n = 0;
  const deps: WorkerDeps = {
    store,
    reviewer,
    queue,
    ...(opts.voice ? { listener, recordings } : {}),
    ...(opts.notifications === false ? {} : { notifications }),
    now: () => new Date(clock),
    newId: () => `case-${++n}`,
    config: { leaseSec: 300, settleSec: 60, modelAttempts: 3, staffLocale: 'en', appBaseUrl: 'https://app.example', spend: parseSpendSettings({}) },
  };
  const advance = (sec: number) => {
    clock += sec * 1000;
  };
  return { store, reviewer, queue, notifications, listener, recordings, deps, advance };
}
