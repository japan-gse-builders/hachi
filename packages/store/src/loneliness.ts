import { assessLoneliness, cycleStart, isNewsForFamily, planLonelinessNotice, type CallSignal, type LonelinessAssessment } from '@hachi/core';
import { outboxId } from './detections.js';
import type { CallRecord, OutboxEntry, Resident } from './model.js';
import type { Store } from './types.js';

/** What the resident's recent calls say about being on their own, newest first. */
export function lonelinessSignals(calls: readonly CallRecord[]): CallSignal[] {
  return calls.map((c) => ({
    date: c.localDate ?? c.startedAt.slice(0, 10),
    tagIds: c.wellbeing?.tags.map((t) => t.id) ?? [],
    askedForContact: Boolean(c.analysis?.contactRequest),
  }));
}

export function lonelinessFor(resident: Resident, calls: readonly CallRecord[], asOf: string): LonelinessAssessment {
  const answers = calls.flatMap((c) => c.analysis?.answers ?? []);
  return assessLoneliness(answers, lonelinessSignals(calls), asOf);
}

export interface LonelinessNoticeOptions {
  /** Resident-local date the assessment is made on. */
  asOf: string;
  now: Date;
  appBaseUrl: string;
}

/**
 * Tells the resident's family that more company would be welcome, if the resident agreed that
 * their family may be told how they are in themselves, and if this rotation's screen says
 * something the family has not already been told.
 *
 * Returns the queued messages, which is empty far more often than not; that is the point.
 */
export async function recordLonelinessNotice(
  store: Store,
  resident: Resident,
  calls: readonly CallRecord[],
  opts: LonelinessNoticeOptions,
): Promise<OutboxEntry[]> {
  // Without recorded consent the resident's family is told nothing about how they feel, however
  // kindly meant: this is the resident's own life, not a report about them.
  if (!resident.consent?.shareMood || !resident.family) return [];
  const assessment = lonelinessFor(resident, calls, opts.asOf);
  if (!isNewsForFamily(assessment)) return [];
  const messages = planLonelinessNotice(
    {
      residentId: resident.id,
      preferredName: resident.preferredName,
      cycleStart: cycleStart(resident.serviceStartedAt.slice(0, 10), opts.asOf),
      dashboardUrl: `${opts.appBaseUrl}/family`,
    },
    resident.family,
  );
  const createdAt = opts.now.toISOString();
  return store.enqueueOutbox(
    messages.map((m) => ({ ...m, id: outboxId(m.idempotencyKey), residentId: resident.id, status: 'pending' as const, attempts: 0, createdAt })),
  );
}
