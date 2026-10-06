import { planContactRequest, type ContactRequest } from '@hachi/core';
import { outboxId } from './detections.js';
import type { OutboxApproval, OutboxEntry, Resident } from './model.js';
import { NotFoundError, type Store } from './types.js';

/**
 * Queues the text that passes a resident's request on. A message to the family contact we already
 * hold goes straight into the queue; a number the resident read out over the phone is held for a
 * person to agree to first, because one misheard digit sends a stranger the resident's name and
 * the fact that they are on their own.
 *
 * Returns the queued entry, or null when there was no one to text. The request itself is kept on
 * the call either way, so staff see that it was asked for even when nothing could be sent.
 */
export async function recordContactRequest(
  store: Store,
  resident: Resident,
  callId: string,
  request: ContactRequest,
  now: Date,
): Promise<OutboxEntry | null> {
  const plan = planContactRequest(request, {
    callId,
    preferredName: resident.preferredName,
    ...(resident.family ? { family: resident.family } : {}),
  });
  if (!plan) return null;
  const entry: OutboxEntry = {
    ...plan.message,
    id: outboxId(plan.message.idempotencyKey),
    residentId: resident.id,
    status: plan.needsApproval ? 'awaiting_approval' : 'pending',
    attempts: 0,
    createdAt: now.toISOString(),
    requestedFor: request.who.slice(0, 80),
  };
  const [created] = await store.enqueueOutbox([entry]);
  return created ?? null;
}

export type ApprovalOutcome = 'approved' | 'rejected' | 'already_decided';

export interface ApprovalResult {
  outcome: ApprovalOutcome;
  entry: OutboxEntry;
}

/**
 * Records a person's decision on a held message. Approving only moves it into the queue; the
 * delivery worker is what sends it, so the approval itself cannot fail halfway.
 */
export async function decideContactRequest(
  store: Store,
  id: string,
  approval: OutboxApproval,
): Promise<ApprovalResult> {
  let outcome: ApprovalOutcome = 'already_decided';
  const entry = await store.updateOutbox(id, (e) => {
    if (e.status !== 'awaiting_approval') return null;
    outcome = approval.decision;
    return {
      ...e,
      status: approval.decision === 'approved' ? ('pending' as const) : ('rejected' as const),
      approval,
      updatedAt: approval.at,
    };
  });
  if (entry.kind !== 'contact_request') throw new NotFoundError('Contact request');
  return { outcome, entry };
}
