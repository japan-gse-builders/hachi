import { effectiveUrgency } from '@hachi/core';
import type { CaseEvent, CaseMutation, StoredCase } from '@hachi/store';
import type { StaffPrincipal } from './auth.js';
import { HttpError } from './errors.js';
import type { CaseUpdate } from './schemas.js';

/** QUE-03 / PRI-06: applies a staff update and records every change as an event. */
export function applyStaffUpdate(
  current: StoredCase,
  update: CaseUpdate,
  actor: Pick<StaffPrincipal, 'uid' | 'name' | 'email'>,
  now: Date,
  newId: () => string,
): CaseMutation {
  const at = now.toISOString();
  const c: StoredCase = { ...current };
  const events: CaseEvent[] = [];
  const event = (e: Omit<CaseEvent, 'id' | 'caseId' | 'at' | 'actorUid' | 'autoUrgency'>) =>
    events.push({ id: newId(), caseId: c.id, at, actorUid: actor.uid, autoUrgency: c.autoUrgency, ...e });

  if (update.status === 'in_progress') {
    const active = c.status === 'in_progress' ? c.assignment : undefined;
    if (active && active.uid !== actor.uid) {
      throw new HttpError(409, `${active.name} has already taken this case.`, 'case_already_claimed');
    }
    if (!active) {
      c.assignment = { uid: actor.uid, name: actor.name?.trim() || actor.email, claimedAt: at };
      if (c.status === 'in_progress') event({ type: 'claimed', reason: update.reason });
    }
  }
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
      if (update.status === 'open') delete c.assignment;
    }
    c.status = update.status;
  }
  if (events.length) c.updatedAt = at;
  return { case: c, events };
}
