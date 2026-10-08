/**
 * Whether the conversation half of a call is working, and what a resident's phone is allowed to do
 * about it.
 *
 * Dialing does not depend on Gemini. Twilio rings the phone whatever Vertex AI is doing, so when
 * the Live API refuses us the resident still answers, hears nothing, and is then apologized to by
 * Twilio's own voice. Ringing and apologizing is worse than not ringing: an eighty-five-year-old
 * cannot tell a broken service from a real emergency callback, and the retry ladder delivered that
 * three times a day.
 *
 * This is the same bargain as the spend ceiling next door — stop the routine thing, never the
 * urgent thing — but keyed on a fault rather than on money, and with one difference that matters:
 * the ledger knows its own number, whereas a gateway only ever learns it is broken by breaking. So
 * the state here is built from observed outcomes, and the cost of learning is bounded instead of
 * eliminated.
 *
 * It lives in the store rather than in each process because telephony and the voice gateway are
 * separate Cloud Run services, each of which scales to several instances: a fault one instance saw
 * is useless to the instance that dials next unless it is written down somewhere both can read.
 */

/**
 * Whether every call will fail this way, or only that one did.
 *
 * The Live API reports both as a websocket close, so the close reason is the only thing that tells
 * them apart, and the difference decides whether a retry is worth a phone ringing. A dropped
 * socket is worth one more try. A project whose billing has been cut off is not, and three more
 * tries will not change its mind.
 */
export type GatewayFault = 'systemic' | 'transient';

/** What is known about the gateway. One document, so a verdict and a trial claim are one write. */
export interface GatewayBreaker {
  /** Consecutive calls that reached the gateway and could not hold a conversation. */
  failures: number;
  /** The verdict on the latest failure; absent while nothing is wrong. */
  fault?: GatewayFault;
  /**
   * Vertex AI's own words for the latest failure. Kept because "the gateway is down" is not
   * something staff can act on, and "spend cap breached" is.
   */
  reason?: string;
  /** ISO, the start of the current run of failures. */
  since?: string;
  /** ISO. */
  lastFailedAt?: string;
  /** ISO, when a call was last let through to find out whether the fault is over. */
  probedAt?: string;
  updatedAt: string;
}

export interface GatewayPolicy {
  /**
   * Transient failures in a row before new calls stop. More than one, because a single dropped
   * socket is ordinary and a service whose whole purpose is to ring every day should not stop
   * itself over one. A systemic fault ignores this and stops on the first.
   */
  transientFailures: number;
  /**
   * How long a fault is believed before one call is allowed through to test it. Long enough that a
   * day's worth of residents are not each spent finding out the same thing, short enough that a
   * fault fixed in the morning does not cost everybody their afternoon check-in.
   */
  cooldownMs: number;
}

export const DEFAULT_GATEWAY_POLICY: GatewayPolicy = {
  transientFailures: 3,
  cooldownMs: 15 * 60_000,
};

/** The state a gateway nobody has had trouble with is in. */
export function healthyGateway(at: string): GatewayBreaker {
  return { failures: 0, updatedAt: at };
}

/**
 * Faults that will meet every call identically, matched on what Vertex AI actually says.
 *
 * Close code 1008 is listed as itself: it is the policy-violation close, which is how the Live API
 * delivered the spend cap that caused this, and no transient network fault produces it.
 *
 * Anything unrecognized is transient. Being wrong in that direction costs a handful of rings
 * before the transient threshold stops them anyway; being wrong in the other direction silently
 * stops a care service over a fault we had merely never seen before.
 */
const SYSTEMIC: readonly RegExp[] = [
  /^closed: 1008\b/,
  /spend[ _]cap/i,
  /billing/i,
  /quota/i,
  /resource[ _]exhausted/i,
  /permission[ _]denied/i,
  /unauthenticated/i,
  /api[ _]key/i,
  /does not have access/i,
  /not[ _]found/i,
  /not supported/i,
];

export function classifyGatewayFailure(reason: string | undefined): GatewayFault {
  const r = reason?.trim();
  if (!r) return 'transient';
  return SYSTEMIC.some((p) => p.test(r)) ? 'systemic' : 'transient';
}

/**
 * A call that could not hold a conversation. `reason` is the gateway's close reason verbatim; it is
 * classified here rather than by the caller so that telephony and the gateway cannot disagree about
 * what counts as systemic.
 */
export function recordGatewayFailure(b: GatewayBreaker, reason: string | undefined, now: Date): GatewayBreaker {
  const at = now.toISOString();
  return {
    failures: b.failures + 1,
    fault: classifyGatewayFailure(reason),
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    since: b.failures === 0 || !b.since ? at : b.since,
    lastFailedAt: at,
    updatedAt: at,
  };
}

/**
 * A call that held a conversation. The run of failures is dropped rather than decremented: a call
 * that worked is proof the fault is over, and counting down from it would keep calls stopped after
 * the evidence for stopping them had gone.
 */
export function recordGatewaySuccess(b: GatewayBreaker, now: Date): GatewayBreaker {
  if (b.failures === 0 && !b.probedAt) return b;
  return healthyGateway(now.toISOString());
}

/**
 * `working`: dial.
 * `probe`: dial, and this is the one call spent on finding out whether the fault is over.
 * `down`: do not dial. We already know how this call ends.
 */
export type GatewayVerdict = 'working' | 'probe' | 'down';

function tripped(b: GatewayBreaker, policy: GatewayPolicy): boolean {
  if (b.failures === 0) return false;
  return b.fault === 'systemic' || b.failures >= policy.transientFailures;
}

export function gatewayVerdict(b: GatewayBreaker | null | undefined, now: Date, policy: GatewayPolicy): GatewayVerdict {
  if (!b || !tripped(b, policy)) return 'working';
  // Measured from the later of the two, so a probe that also failed starts the wait again rather
  // than letting every subsequent dial through on the strength of one expired cooldown.
  const last = Math.max(Date.parse(b.lastFailedAt ?? b.updatedAt), b.probedAt ? Date.parse(b.probedAt) : 0);
  return now.getTime() - last >= policy.cooldownMs ? 'probe' : 'down';
}

/**
 * Takes the one trial call a cooldown allows, or refuses. Pure, so the caller runs it inside
 * whatever transaction its store provides; two workers that both read "the cooldown is over" would
 * otherwise both ring somebody. Same reason `reserve` is shaped this way.
 *
 * Returns the breaker to write, or null when the call must not be placed.
 */
export function claimCall(b: GatewayBreaker | null | undefined, now: Date, policy: GatewayPolicy): GatewayBreaker | null {
  const current = b ?? healthyGateway(now.toISOString());
  switch (gatewayVerdict(current, now, policy)) {
    case 'working':
      return current;
    case 'probe':
      return { ...current, probedAt: now.toISOString(), updatedAt: now.toISOString() };
    case 'down':
      return null;
  }
}

export function parseGatewayPolicy(env: Record<string, string | undefined>): GatewayPolicy {
  const raw = env.GATEWAY_COOLDOWN_SEC;
  const sec = raw === undefined || raw.trim() === '' ? DEFAULT_GATEWAY_POLICY.cooldownMs / 1000 : Number(raw);
  if (!Number.isInteger(sec) || sec < 60 || sec > 86_400) {
    throw new Error('GATEWAY_COOLDOWN_SEC must be an integer number of seconds between 60 and 86400');
  }
  const failRaw = env.GATEWAY_TRANSIENT_FAILURES;
  const failures = failRaw === undefined || failRaw.trim() === '' ? DEFAULT_GATEWAY_POLICY.transientFailures : Number(failRaw);
  if (!Number.isInteger(failures) || failures < 1 || failures > 20) {
    throw new Error('GATEWAY_TRANSIENT_FAILURES must be an integer between 1 and 20');
  }
  return { transientFailures: failures, cooldownMs: sec * 1000 };
}
