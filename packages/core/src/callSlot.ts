/**
 * One phone line per resident. Whoever is about to ring them — the daily check-in or a member of
 * staff asking Hachi to call now — takes this slot first, so the resident's phone never rings twice
 * at once and a second call never lands in the middle of the first.
 *
 * The slot always carries a deadline. A status callback that never arrives must not leave a resident
 * uncallable, so a stale slot simply stops counting once `until` has passed.
 */
export interface CallSlot {
  callId: string;
  at: string;
  until: string;
}

/**
 * How long a staff request holds the line before the call is dialled. Long enough for Cloud Tasks
 * to deliver the task; the telephony service extends it to the length of the call when it dials.
 */
export const STAFF_REQUEST_HOLD_MS = 5 * 60_000;

/** True when the line is held by a call other than `callId`. */
export function slotBusy(slot: CallSlot | null | undefined, now: Date, callId?: string): boolean {
  return !!slot && slot.callId !== callId && Date.parse(slot.until) > now.getTime();
}

/**
 * Takes the line for `callId`, or extends it if this call already holds it. Pure, so the caller runs
 * it inside the transaction its store provides. Returns null while another call holds the line.
 */
export function claimSlot(slot: CallSlot | null | undefined, callId: string, now: Date, holdMs: number): CallSlot | null {
  if (slotBusy(slot, now, callId)) return null;
  const at = slot?.callId === callId ? slot.at : now.toISOString();
  return { callId, at, until: new Date(now.getTime() + holdMs).toISOString() };
}

/**
 * Staff-requested calls are numbered per resident-local day in a series of their own, so they never
 * use up the daily check-in's id (`${localDate}-${attempt}`) or its retries.
 */
export function staffCallId(localDate: string, seq: number): string {
  return `${localDate}-now-${seq}`;
}

/** The next number in the day's staff series, given the last staff call's id (from any day). */
export function nextStaffCallSeq(localDate: string, lastCallId: string | undefined): number {
  const m = lastCallId ? /^(\d{4}-\d{2}-\d{2})-now-(\d+)$/.exec(lastCallId) : null;
  return m && m[1] === localDate ? Number(m[2]) + 1 : 1;
}

/** Milliseconds until staff may ask again; 0 when they may. */
export function staffCallCooldownLeft(lastAt: string | undefined, now: Date, cooldownMs: number): number {
  if (!lastAt) return 0;
  return Math.max(0, Date.parse(lastAt) + cooldownMs - now.getTime());
}
