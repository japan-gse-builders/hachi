/**
 * Today's check-in that did not happen, in the terms staff act on.
 *
 * Everything else on the staff screens is built from what a call found. A resident nobody spoke to
 * produces no detections, so they produce no case, so they fall off the queue entirely — and a
 * check-in service that quietly stops checking in is the exact failure this product exists to
 * prevent. The absence of a call has to be as visible as the content of one.
 *
 * Deliberately not routed through the detection rules. R4 is about a resident who answered and did
 * not speak, which is a fact about them; a spend cap is a fact about us, and filing ours as theirs
 * would put our outages in their clinical record.
 */
import type { Locale } from './types.js';

/**
 * Why nobody got through. Separated by who has to fix it and what it says about the resident:
 * `no_answer` is the only one that is about them, and it is also the only one that might be the
 * thing the daily call was for.
 */
export type MissedReason = 'service_fault' | 'budget' | 'provider_fault' | 'no_answer';

export const MISSED_REASONS = ['service_fault', 'budget', 'provider_fault', 'no_answer'] as const satisfies readonly MissedReason[];

export const MISSED_LABELS: Record<Locale, Record<MissedReason, string>> = {
  ja: { service_fault: 'システム障害', budget: 'AI 予算の上限', provider_fault: '発信できず', no_answer: '応答なし' },
  en: { service_fault: 'System fault', budget: 'AI budget cap', provider_fault: 'Could not dial', no_answer: 'No answer' },
};

/**
 * What the missing call asks of staff. Carried with the label for the same reason the urgency
 * levels carry theirs: the label ranks the problem but does not say what to do about it, and a
 * resident nobody has spoken to today needs somebody to decide whether that matters.
 */
export const MISSED_MEANINGS: Record<Locale, Record<MissedReason, string>> = {
  ja: {
    service_fault: 'Hachi 側の障害で話せていない。本人の状態は分かっていないので、電話で確かめる。',
    budget: '今月の AI 予算を使い切って発信を止めている。本人の状態は分かっていない。',
    provider_fault: '電話をかけること自体ができていない。番号と電話回線を確認する。',
    no_answer: 'かけたが出なかった。出られない理由そのものが見守りの対象なので、電話で確かめる。',
  },
  en: {
    service_fault: 'A fault on our side, not theirs. Nobody has heard from them today, so call them.',
    budget: "This month's AI budget is used up and calls have stopped. Nobody has heard from them today.",
    provider_fault: 'The phone call could not be placed at all. Check the number and the phone line.',
    no_answer: 'We rang and nobody picked up. Why they could not answer is the thing we watch for, so call them.',
  },
};

/** The three that are ours. Staff can act on all four, but only one of them is about the resident. */
export function isOurFault(reason: MissedReason): boolean {
  return reason !== 'no_answer';
}

/**
 * One dial attempt, in the few fields this decision needs. Structural rather than `CallRecord`
 * because `@hachi/store` is the layer above this one.
 */
export interface CheckInAttempt {
  /** `CallStatus`. */
  status: string;
  /** `ConversationEnd`, once the gateway has recorded one. */
  endedBy?: string;
  /** `CallRecord.failure.code`. */
  failureCode?: string;
}

/**
 * Why this attempt did not reach the resident, or null if it did.
 *
 * A call that connected and ran to any ending other than `gateway_error` counts as reached, silence
 * included: somebody picked the phone up, and what they did or did not say on it is R4's business,
 * not this one's.
 */
export function missedReason(a: CheckInAttempt): MissedReason | null {
  if (a.status === 'completed' && a.endedBy !== 'gateway_error') return null;
  if (a.status === 'scheduled' || a.status === 'in_progress') return null;
  if (a.status === 'no_answer') return 'no_answer';
  if (a.failureCode === 'budget_exhausted') return 'budget';
  if (a.failureCode === 'gateway_unavailable' || a.endedBy === 'gateway_error') return 'service_fault';
  return 'provider_fault';
}

export interface MissedCheckIn {
  reason: MissedReason;
  /** How many times we tried, so "no answer" once reads differently from "no answer" three times. */
  attempts: number;
  /** ISO of the last attempt. */
  at: string;
}

/**
 * The day's verdict for one resident, from every attempt made for that day, oldest first.
 *
 * The latest attempt's reason is the one reported. Earlier attempts can have failed differently —
 * a resident who did not answer at nine, then a gateway that broke at nine-three — and the most
 * recent fault is both the current state of the world and the one staff will find if they look.
 *
 * Returns null while nothing has been tried yet, so a resident whose call time has not come round
 * is never reported as unreached.
 */
export function missedCheckIn(attempts: readonly (CheckInAttempt & { at: string })[]): MissedCheckIn | null {
  const settled = attempts.filter((a) => missedReason(a) !== null || a.status === 'completed');
  if (!settled.length) return null;
  const last = settled[settled.length - 1]!;
  const reason = missedReason(last);
  if (!reason || settled.some((a) => missedReason(a) === null)) return null;
  return { reason, attempts: settled.length, at: last.at };
}
