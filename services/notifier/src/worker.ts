import { notificationTask, type TaskQueue } from '@hachi/cloud';
import { NotFoundError, orgMayContactPeople, recordNotificationOnCase, type DeliveryFailure, type OutboxEntry, type Store } from '@hachi/store';
import { DeliveryError, type Senders } from './channels.js';

export interface WorkerDeps {
  store: Store;
  senders: Senders;
  queue: TaskQueue;
  now: () => Date;
  config: { maxAttempts: number; leaseSec: number; sweepAgeSec: number };
}

export type DeliveryOutcome =
  | { outcome: 'sent'; providerId?: string }
  | { outcome: 'skipped' | 'failed'; error: DeliveryFailure }
  /** Retryable failure; the caller answers 503 so Cloud Tasks tries again with backoff. */
  | { outcome: 'retry'; error: DeliveryFailure }
  /** Another worker holds the lease. */
  | { outcome: 'busy' }
  /** Already finished earlier (a duplicate task). */
  | { outcome: 'done'; status: OutboxEntry['status'] }
  | { outcome: 'not_found' };

const OUTBOX_ID = /^[a-f0-9]{64}$/;

export function parseSendInput(body: unknown): string | null {
  const id = (body as { outboxId?: unknown } | null)?.outboxId;
  return typeof id === 'string' && OUTBOX_ID.test(id) ? id : null;
}

function failure(err: unknown): DeliveryFailure {
  if (err instanceof DeliveryError) return { ...(err.code ? { code: err.code } : {}), message: err.message, retryable: err.retryable };
  return { message: (err as Error)?.message ?? String(err), retryable: true };
}

/**
 * Sends one outbox entry at most once at a time: a lease guards against concurrent duplicate
 * tasks, and finished entries are never sent again. A crash between the provider accepting the
 * message and the status write can still repeat it (at-least-once).
 */
export async function deliver(deps: WorkerDeps, id: string): Promise<DeliveryOutcome> {
  const { store, config } = deps;
  const now = deps.now();
  const nowIso = now.toISOString();
  let claimed = false;
  let entry: OutboxEntry;
  try {
    entry = await store.updateOutbox(id, (e) => {
      if (e.status !== 'pending') return null;
      if (e.leaseUntil && e.leaseUntil > nowIso) return null;
      claimed = true;
      return { ...e, attempts: e.attempts + 1, leaseUntil: new Date(now.getTime() + config.leaseSec * 1000).toISOString(), updatedAt: nowIso };
    });
  } catch (err) {
    if (err instanceof NotFoundError) return { outcome: 'not_found' };
    throw err;
  }
  if (!claimed) {
    if (entry.status === 'pending') return { outcome: 'busy' };
    if (entry.status === 'sent') await recordNotificationOnCase(store, entry);
    return { outcome: 'done', status: entry.status };
  }

  const finish = (patch: Partial<OutboxEntry>) =>
    store.updateOutbox(id, (e) => {
      const { leaseUntil: _lease, ...rest } = e;
      return { ...rest, ...patch, updatedAt: deps.now().toISOString() };
    });

  // Not held for later: an alert sent days late, once the organization is verified, would mislead.
  // An entry written by a service from before organizations has none of its own; its resident's decides.
  const orgId = entry.orgId || (await store.getResident(entry.residentId))?.orgId;
  if (!(await orgMayContactPeople(store, orgId))) {
    const error = { code: 'organization_unverified', message: 'Hachi has not verified this organization yet, so it sends nothing for it', retryable: false };
    await finish({ status: 'skipped', lastError: error });
    return { outcome: 'skipped', error };
  }

  const sender = deps.senders[entry.channel];
  if (!sender) {
    const error = { code: 'channel_disabled', message: `${entry.channel} is not configured`, retryable: false };
    await finish({ status: 'skipped', lastError: error });
    return { outcome: 'skipped', error };
  }

  let providerId: string | undefined;
  try {
    ({ providerId } = await sender.send(entry));
  } catch (err) {
    const error = failure(err);
    if (error.code === 'destination_not_allowed') {
      await finish({ status: 'skipped', lastError: error });
      return { outcome: 'skipped', error };
    }
    if (error.retryable && entry.attempts < config.maxAttempts) {
      await finish({ lastError: error });
      return { outcome: 'retry', error };
    }
    await finish({ status: 'failed', lastError: error });
    return { outcome: 'failed', error };
  }

  const sent = await finish({ status: 'sent', sentAt: deps.now().toISOString(), ...(providerId ? { providerId } : {}) });
  await recordNotificationOnCase(store, sent);
  return { outcome: 'sent', ...(providerId ? { providerId } : {}) };
}

export interface SweepResult {
  queued: number;
  errors: string[];
}

/** Safety net (Cloud Scheduler, every minute): re-queues pending entries whose task was lost. */
export async function sweep(deps: WorkerDeps, limit = 200): Promise<SweepResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - deps.config.sweepAgeSec * 1000).toISOString();
  const due = (await deps.store.listPendingOutbox(limit)).filter(
    (e) => (e.updatedAt ?? e.createdAt) <= staleBefore && !(e.leaseUntil && e.leaseUntil > nowIso),
  );
  const results = await Promise.allSettled(due.map((e) => deps.queue.enqueue(notificationTask(e.id, e.attempts))));
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [`${due[i]!.id}: ${(r.reason as Error)?.message ?? r.reason}`] : []));
  return { queued: due.length - errors.length, errors };
}
