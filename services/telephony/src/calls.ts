import {
  callReservationMicros,
  callTaskId,
  claimCall,
  hasCallConsent,
  isDue,
  liveCallMicros,
  localDate,
  nextCallAt,
  reserve,
  settle,
  spendMonth,
} from '@hachi/core';
import type { CallRecord, CallStatus, Resident, Store } from '@hachi/store';
import type { TelephonyConfig } from './config.js';
import type { TaskQueue } from '@hachi/cloud';
import { buildCallTwiml, TelephonyError, type TelephonyProvider } from './twilio.js';

export interface CallDeps {
  store: Store;
  queue: TaskQueue;
  telephony: TelephonyProvider;
  config: Pick<
    TelephonyConfig,
    | 'publicBaseUrl'
    | 'voiceStreamUrl'
    | 'sayVoice'
    | 'ringTimeoutSec'
    | 'maxCallSec'
    | 'maxConversationSec'
    | 'maxAttempts'
    | 'retryDelaySec'
    | 'dispatchLookbackMin'
    | 'spend'
    | 'gateway'
  > & { twilio: Pick<TelephonyConfig['twilio'], 'voiceFrom'> };
  now: () => Date;
  newToken: () => string;
}

export const PLACE_CALL_PATH = '/tasks/place-call';
/** Cloud Tasks redeliveries of a retryable Twilio error before this attempt is marked failed. */
export const PLACEMENT_RETRIES = 3;
/** Long enough for Twilio's "initiated" callback to record the Call SID if our own write was lost. */
export const DIAL_LEASE_MS = 120_000;
const DISPATCH_CONCURRENCY = 25;

export interface PlaceCallInput {
  residentId: string;
  localDate: string;
  attempt: number;
}

export function callIdFor(localDate: string, attempt: number): string {
  return `${localDate}-${attempt}`;
}

export function parsePlaceCallInput(body: unknown, maxAttempts: number): PlaceCallInput | null {
  const b = body as Partial<PlaceCallInput> | null;
  if (!b || typeof b !== 'object') return null;
  if (typeof b.residentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(b.residentId)) return null;
  if (typeof b.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.localDate)) return null;
  if (!Number.isInteger(b.attempt) || b.attempt! < 0 || b.attempt! >= maxAttempts) return null;
  return { residentId: b.residentId, localDate: b.localDate, attempt: b.attempt! };
}

export interface DispatchResult {
  checked: number;
  enqueued: number;
  alreadyQueued: number;
  errors: { residentId: string; message: string }[];
}

/**
 * Runs every minute from Cloud Scheduler. Looks back several minutes so a missed tick or a
 * slow run never drops a call; deterministic task names make the overlap harmless.
 */
export async function dispatchDueCalls(deps: CallDeps): Promise<DispatchResult> {
  const now = deps.now();
  const windowStart = new Date(now.getTime() - deps.config.dispatchLookbackMin * 60_000);
  const residents = await deps.store.listActiveResidents();
  const result: DispatchResult = { checked: residents.length, enqueued: 0, alreadyQueued: 0, errors: [] };

  const handle = async (r: Resident) => {
    try {
      if (!hasCallConsent(r.callConsent)) return;
      if (!isDue(r.callTime, r.timeZone, windowStart, now)) return;
      const date = localDate(nextCallAt(r.callTime, r.timeZone, windowStart), r.timeZone);
      const outcome = await deps.queue.enqueue({
        name: callTaskId(r.id, date, 0),
        path: PLACE_CALL_PATH,
        body: { residentId: r.id, localDate: date, attempt: 0 } satisfies PlaceCallInput,
      });
      if (outcome === 'created') result.enqueued++;
      else result.alreadyQueued++;
    } catch (err) {
      result.errors.push({ residentId: r.id, message: (err as Error).message });
    }
  };
  for (let i = 0; i < residents.length; i += DISPATCH_CONCURRENCY) {
    await Promise.all(residents.slice(i, i + DISPATCH_CONCURRENCY).map(handle));
  }
  return result;
}

export type PlaceCallOutcome =
  | { outcome: 'placed'; providerCallId: string }
  | { outcome: 'skipped'; reason: 'inactive' | 'consent_required' | 'already_handled' | 'budget_exhausted' | 'gateway_unavailable' }
  | { outcome: 'retry_later'; reason: 'dial_in_progress' | 'provider_unavailable' }
  | { outcome: 'failed'; retryScheduled: boolean; code?: string };

/** Identifies one call's reservation, so a redelivered task settles the same one it reserved. */
export const spendLeaseId = (residentId: string, callId: string) => `call:${residentId}/${callId}`;

/**
 * Holds this call's worst-case cost against the month before the phone rings, and refuses the call
 * if the month cannot afford it. The check and the reservation are the same transaction, so two
 * workers dialing at once cannot both take the last of the budget.
 *
 * Only the daily check-in goes through here. Reaching family and staff about an emergency does not:
 * a ceiling that stops somebody being told their mother has collapsed is not a ceiling worth having.
 */
async function reserveForCall(deps: CallDeps, residentId: string, callId: string): Promise<boolean> {
  const now = deps.now();
  const { prices, policy } = deps.config.spend;
  const micros = callReservationMicros(deps.config.maxConversationSec, prices);
  const lease = { id: spendLeaseId(residentId, callId), micros, at: now.toISOString() };
  const after = await deps.store.mutateSpendLedger(spendMonth(now), (l) => reserve(l, lease, policy, now));
  return after !== null;
}

/** Replaces the reservation with what the call actually cost, once Twilio says how long it ran. */
export async function settleCallSpend(deps: CallDeps, residentId: string, callId: string, durationSec: number | undefined): Promise<void> {
  const now = deps.now();
  const actual = durationSec === undefined ? undefined : liveCallMicros(durationSec, deps.config.spend.prices);
  await deps.store.mutateSpendLedger(spendMonth(now), (l) => settle(l, spendLeaseId(residentId, callId), actual, now));
}

/**
 * Refuses the call when the last calls told us the conversation cannot happen, and otherwise takes
 * the one trial call a cooldown allows. One transaction, for the same reason the budget's is: two
 * workers that both read an expired cooldown would otherwise both ring somebody.
 *
 * Only the daily check-in comes through here. Reaching family and staff about an emergency goes
 * straight to the provider and is not gated on anything, because the thing that is broken is the
 * conversation, and an alert call does not need one.
 */
async function claimGatewayForCall(deps: CallDeps): Promise<boolean> {
  const now = deps.now();
  const after = await deps.store.mutateGatewayBreaker((b) => claimCall(b, now, deps.config.gateway));
  return after !== null;
}

export async function scheduleRetry(deps: CallDeps, input: PlaceCallInput): Promise<boolean> {
  const next = input.attempt + 1;
  if (next >= deps.config.maxAttempts) return false;
  await deps.queue.enqueue({
    name: callTaskId(input.residentId, input.localDate, next),
    path: PLACE_CALL_PATH,
    body: { ...input, attempt: next } satisfies PlaceCallInput,
    scheduleAt: new Date(deps.now().getTime() + deps.config.retryDelaySec * 1000),
  });
  return true;
}

function withoutLease(c: CallRecord): CallRecord {
  const { dialLease: _lease, ...rest } = c;
  return rest;
}

/**
 * Places one call attempt. Safe under Cloud Tasks at-least-once delivery: the call document is
 * created once, and a short lease ensures only one worker dials it.
 */
export async function placeCall(deps: CallDeps, input: PlaceCallInput, taskRetryCount: number): Promise<PlaceCallOutcome> {
  const r = await deps.store.getResident(input.residentId);
  if (!r || !r.active) return { outcome: 'skipped', reason: 'inactive' };
  if (!hasCallConsent(r.callConsent)) return { outcome: 'skipped', reason: 'consent_required' };

  const callId = callIdFor(input.localDate, input.attempt);
  const at = deps.now().toISOString();
  const token = deps.newToken();
  let streamToken = deps.newToken();
  const created = await deps.store.createCallIfAbsent({
    id: callId,
    residentId: r.id,
    source: 'live',
    status: 'scheduled',
    channel: r.channel,
    startedAt: at,
    analysisPending: false,
    createdAt: at,
    attempt: input.attempt,
    localDate: input.localDate,
    dialLease: { token, at },
    streamToken,
  });

  if (!created) {
    const current = await deps.store.updateCall(r.id, callId, (c) => {
      if (c.providerCallId || c.status !== 'scheduled') return null;
      if (c.dialLease && deps.now().getTime() - Date.parse(c.dialLease.at) < DIAL_LEASE_MS) return null;
      return { ...c, dialLease: { token, at }, streamToken: c.streamToken ?? streamToken };
    });
    if (current.providerCallId || current.status !== 'scheduled') return { outcome: 'skipped', reason: 'already_handled' };
    if (current.dialLease?.token !== token) return { outcome: 'retry_later', reason: 'dial_in_progress' };
    streamToken = current.streamToken!;
  }

  // Before the budget, because money reserved for a call that will not work is money the month
  // cannot spend on a call that would. `retryable` is false on purpose: nothing is scheduled to
  // try this attempt again, and the honest record is that today's check-in did not happen. What
  // brings calls back is the breaker's own cooldown, not this document.
  if (!(await claimGatewayForCall(deps))) {
    await deps.store.updateCall(r.id, callId, (c) => ({
      ...withoutLease(c),
      status: 'failed',
      endedAt: deps.now().toISOString(),
      failure: {
        code: 'gateway_unavailable',
        message: 'The Voice Gateway could not hold a conversation on the last calls, so this one was not placed',
        retryable: false,
      },
    }));
    return { outcome: 'skipped', reason: 'gateway_unavailable' };
  }

  // After the lease, so a refused call is recorded against this attempt rather than retried forever.
  if (!(await reserveForCall(deps, r.id, callId))) {
    await deps.store.updateCall(r.id, callId, (c) => ({
      ...withoutLease(c),
      status: 'failed',
      endedAt: deps.now().toISOString(),
      failure: { code: 'budget_exhausted', message: 'The monthly AI budget is used up; no new calls are being placed', retryable: false },
    }));
    return { outcome: 'skipped', reason: 'budget_exhausted' };
  }

  const query = `residentId=${encodeURIComponent(r.id)}&callId=${encodeURIComponent(callId)}`;

  try {
    const { providerCallId } = await deps.telephony.placeCall({
      to: r.phone,
      from: deps.config.twilio.voiceFrom,
      twiml: buildCallTwiml({
        residentId: r.id,
        callId,
        preferredName: r.preferredName,
        streamUrl: deps.config.voiceStreamUrl,
        streamToken,
        afterStreamUrl: `${deps.config.publicBaseUrl}/twilio/after-stream?${query}`,
        sayVoice: deps.config.sayVoice,
      }),
      statusCallbackUrl: `${deps.config.publicBaseUrl}/twilio/status?${query}`,
      ringTimeoutSec: deps.config.ringTimeoutSec,
      maxCallSec: deps.config.maxCallSec,
    });
    await deps.store.updateCall(r.id, callId, (c) => ({ ...withoutLease(c), providerCallId: c.providerCallId ?? providerCallId }));
    return { outcome: 'placed', providerCallId };
  } catch (err) {
    const e = err instanceof TelephonyError ? err : new TelephonyError((err as Error).message, true);
    // No call was made, so the reservation is released rather than written off; the next attempt
    // takes its own.
    await settleCallSpend(deps, r.id, callId, 0);
    if (e.retryable && taskRetryCount < PLACEMENT_RETRIES) {
      await deps.store.updateCall(r.id, callId, (c) => (c.dialLease?.token === token ? withoutLease(c) : null));
      return { outcome: 'retry_later', reason: 'provider_unavailable' };
    }
    await deps.store.updateCall(r.id, callId, (c) => ({
      ...withoutLease(c),
      status: 'failed',
      endedAt: deps.now().toISOString(),
      failure: { ...(e.code ? { code: e.code } : {}), message: e.message, retryable: e.retryable },
    }));
    const retryScheduled = e.retryable ? await scheduleRetry(deps, input) : false;
    return { outcome: 'failed', retryScheduled, ...(e.code ? { code: e.code } : {}) };
  }
}

const TERMINAL: ReadonlySet<CallStatus> = new Set(['completed', 'no_answer', 'failed']);

export interface StatusUpdateResult {
  status: CallStatus;
  retryScheduled: boolean;
}

/**
 * Twilio status callbacks. Callbacks can arrive out of order or more than once, so terminal
 * states are never overwritten and a retry is scheduled only on the transition into "failed".
 * Busy / no-answer are recorded but not retried (non-answer handling is outside the MVP).
 */
export async function applyCallStatus(
  deps: CallDeps,
  ids: { residentId: string; callId: string },
  params: Record<string, string>,
): Promise<StatusUpdateResult> {
  const twilioStatus = params.CallStatus ?? '';
  const sid = params.CallSid;
  let becameFailed = false;
  const updated = await deps.store.updateCall(ids.residentId, ids.callId, (c) => {
    becameFailed = false;
    if (c.providerCallId && sid && c.providerCallId !== sid) return null;
    let next: CallRecord = c;
    if (!c.providerCallId && sid) next = { ...withoutLease(c), providerCallId: sid };
    if (TERMINAL.has(c.status)) return next === c ? null : next;
    const endedAt = deps.now().toISOString();
    switch (twilioStatus) {
      case 'in-progress':
        if (c.status === 'scheduled') next = { ...next, status: 'in_progress' };
        break;
      case 'completed': {
        const duration = Number.parseInt(params.CallDuration ?? '', 10);
        next = { ...next, status: 'completed', endedAt, ...(Number.isFinite(duration) ? { durationSec: duration } : {}) };
        break;
      }
      case 'busy':
      case 'no-answer':
        next = { ...next, status: 'no_answer', endedAt };
        break;
      case 'failed':
      case 'canceled':
        becameFailed = true;
        next = {
          ...next,
          status: 'failed',
          endedAt,
          failure: { ...(params.ErrorCode ? { code: params.ErrorCode } : {}), message: `Twilio reported ${twilioStatus}`, retryable: true },
        };
        break;
    }
    return next === c ? null : next;
  });
  // The call is over, so its reservation is replaced by what it really cost. A call that never
  // connected cost nothing; one that did is billed for the seconds Twilio reports. `settle` ignores
  // a reservation that is already gone, which is what makes a repeated callback harmless.
  if (TERMINAL.has(updated.status)) {
    await settleCallSpend(deps, ids.residentId, ids.callId, updated.status === 'completed' ? updated.durationSec : 0);
  }
  let retryScheduled = false;
  if (becameFailed && updated.status === 'failed' && updated.attempt !== undefined && updated.localDate) {
    retryScheduled = await scheduleRetry(deps, { residentId: ids.residentId, localDate: updated.localDate, attempt: updated.attempt });
  }
  return { status: updated.status, retryScheduled };
}
