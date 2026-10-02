import { effectiveUrgency } from '@hachi/core';
import type { CaseEvent, CaseMutation, StoredCase } from '@hachi/store';
import type { CaseUpdate } from './schemas.js';

/** QUE-03 / PRI-06: applies a staff update and records every change as an event. */
export function applyStaffUpdate(
  current: StoredCase,
  update: CaseUpdate,
  actorUid: string,
  now: Date,
  newId: () => string,
): CaseMutation {
  const at = now.toISOString();
  const c: StoredCase = { ...current };
  const events: CaseEvent[] = [];
  const event = (e: Omit<CaseEvent, 'id' | 'caseId' | 'at' | 'actorUid' | 'autoUrgency'>) =>
    events.push({ id: newId(), caseId: c.id, at, actorUid, autoUrgency: c.autoUrgency, ...e });

  if (update.urgency && update.urgency !== effectiveUrgency(c)) {
    event({ type: 'urgency_changed', from: effectiveUrgency(c), to: update.urgency, reason: update.reason });
    c.staffUrgency = update.urgency;
  }
  if (update.scoreOffset !== undefined && update.scoreOffset !== (c.staffScoreOffset ?? 0)) {
    event({ type: 'rank_changed', from: c.staffScoreOffset ?? 0, to: update.scoreOffset, reason: update.reason });
    c.staffScoreOffset = update.scoreOffset;
  }
  if (update.status && update.status !== c.status) {
    if (update.status === 'closed') {
      event({ type: 'closed', from: c.status, to: 'closed', reason: update.reason, outcome: update.outcome });
      c.outcome = update.outcome;
      c.closedAt = at;
    } else {
      event({ type: 'status_changed', from: c.status, to: update.status, reason: update.reason });
      if (c.status === 'closed') {
        delete c.closedAt;
        delete c.outcome;
      }
    }
    c.status = update.status;
  }
  if (events.length) c.updatedAt = at;
  return { case: c, events };
}
