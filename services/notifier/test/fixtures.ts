import type { EnqueueRequest, TaskQueue } from '@hachi/cloud';
import { notificationKey } from '@hachi/core';
import { MemoryStore, outboxId, type Organization, type OutboxEntry, type StoredCase } from '@hachi/store';
import { DeliveryError, type ChannelSender, type Senders } from '../src/channels.js';
import type { WorkerDeps } from '../src/worker.js';

export const NOW = new Date('2026-10-02T03:00:00.000Z');

export function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  const key = overrides.idempotencyKey ?? notificationKey('case-1', 'emergency', 'family', overrides.channel ?? 'sms', overrides.address ?? '+819000000002');
  return {
    id: outboxId(key),
    idempotencyKey: key,
    caseId: 'case-1',
    residentId: 'res-1',
    orgId: 'org-1',
    urgency: 'emergency',
    recipient: 'family',
    channel: 'sms',
    address: '+819000000002',
    subject: '[Hachi Immediate action] About Maggie',
    body: '[Hachi Immediate action] Maggie reported sudden symptoms.\nPlease contact Maggie right away.\nDetails: https://app.example/family',
    priority: 'immediate',
    status: 'pending',
    attempts: 0,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

export function storedCase(overrides: Partial<StoredCase> = {}): StoredCase {
  return {
    id: 'case-1',
    residentId: 'res-1',
    orgId: 'org-1',
    rule: 'R1',
    autoUrgency: 'emergency',
    status: 'open',
    detections: [],
    firstDetectedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    notifications: [],
    ...overrides,
  };
}

/** Verified unless the test says otherwise, so messages go out as they do for a real care company. */
export function organization(id: string, overrides: Partial<Organization> = {}): Organization {
  return {
    id,
    name: 'Sakura Care',
    timeZone: 'Asia/Tokyo',
    status: 'active',
    verifiedAt: '2026-09-01T00:00:00.000Z',
    verifiedBy: 'migration',
    billing: { plan: 'internal', email: 'billing@example.org', limits: { residents: 50, members: 10 } },
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'migration',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export class FakeSender implements ChannelSender {
  readonly sent: OutboxEntry[] = [];
  readonly errors: unknown[] = [];

  async send(e: OutboxEntry): Promise<{ providerId?: string }> {
    const err = this.errors.shift();
    if (err) throw err;
    this.sent.push(e);
    return { providerId: `P${this.sent.length}` };
  }

  failWith(...errors: unknown[]): this {
    this.errors.push(...errors);
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

export const retryable = () => new DeliveryError('Twilio 503: unavailable', true, '20500');
export const permanent = () => new DeliveryError('Twilio 400: invalid To', false, '21211');

export async function setup(opts: { entries?: OutboxEntry[]; senders?: Senders; now?: () => Date; organization?: Partial<Organization> } = {}) {
  const store = new MemoryStore();
  store.seedAccounts({ organizations: [organization('org-1', opts.organization)] });
  await store.putCase(storedCase());
  await store.enqueueOutbox(opts.entries ?? [entry()]);
  const sms = new FakeSender();
  const queue = new FakeQueue();
  let clock = NOW.getTime();
  const deps: WorkerDeps = {
    store,
    senders: opts.senders ?? { sms },
    queue,
    now: opts.now ?? (() => new Date(clock)),
    config: { maxAttempts: 3, leaseSec: 60, sweepAgeSec: 120 },
  };
  const advance = (sec: number) => {
    clock += sec * 1000;
  };
  return { store, sms, queue, deps, advance };
}
