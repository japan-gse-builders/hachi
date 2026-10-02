import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import type { Turn } from '@hachi/core';
import { MemoryStore, type CallRecord, type Resident } from '@hachi/store';
import { ReviewError, type CallReviewer, type ModelReview, type ReviewInput } from '../src/model.js';
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
    intake: { status: 'normal', reportedPoorDays: 0, evidenceTurns: [] },
    staffSummary: { health: '少し疲れている', meals: '朝食は食べていない', topics: ['孫の訪問'] },
    familySummary: { health: 'A little tired', meals: 'Ate very little', topics: ['Grandson visiting'] },
    memory: { topics: ['grandson Ken'], plans: ['Ken visits on Sunday'], likes: ['grandson Ken'] },
    topicCoherence: 0.9,
    temporaryCondition: false,
    noisy: false,
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

export const unavailable = () => new ReviewError('Gemini request failed: 503', true);
export const rejected = () => new ReviewError('Gemini request failed: 400', false);

export async function setup(opts: { calls?: CallRecord[]; resident?: Resident | null; notifications?: boolean } = {}) {
  const store = new MemoryStore();
  if (opts.resident !== null) await store.createResident(opts.resident ?? resident());
  await store.addCalls(opts.calls ?? [call()]);
  const reviewer = new FakeReviewer();
  const queue = new FakeQueue();
  const notifications = new FakeQueue();
  let clock = NOW.getTime();
  let n = 0;
  const deps: WorkerDeps = {
    store,
    reviewer,
    queue,
    ...(opts.notifications === false ? {} : { notifications }),
    now: () => new Date(clock),
    newId: () => `case-${++n}`,
    config: { leaseSec: 300, settleSec: 60, modelAttempts: 3, staffLocale: 'ja', appBaseUrl: 'https://app.example' },
  };
  const advance = (sec: number) => {
    clock += sec * 1000;
  };
  return { store, reviewer, queue, notifications, deps, advance };
}
