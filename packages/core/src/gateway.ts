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
 * The cost of learning whether it is *over* is bounded differently. A Live session can be opened
 * with nothing on the other end of it, so finding out costs a websocket rather than a resident's
 * morning, and the voice gateway does exactly that while this is tripped. What is left here is the
 * case where nothing is testing at all — an older gateway, or one that is not running — because a
 * breaker with no way back is a check-in service that has quietly switched itself off.
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
  /**
   * ISO, when the fault was last tested — ordinarily by a Live session with no phone call attached
   * to it. Kept across a test that failed as well as one that passed, because what telephony reads
   * it for is whether anything is still testing, not what the last test found.
   */
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
   * How long a fault is believed before it is tested again. Short enough that a fault fixed in the
   * morning does not cost everybody their afternoon check-in, long enough that the test is not a
   * loop: it opens a billable session against the same API the fault is in.
   */
  cooldownMs: number;
  /**
   * How long a fault may go untested before a resident's call is spent testing it.
   *
   * The synthetic test runs in the voice gateway and is the only thing that moves `probedAt`, so a
   * `probedAt` that has stopped moving means no gateway is testing: an older revision, or one that
   * is not running. Ringing somebody to find out is the thing this file exists to avoid, and it is
   * still the lesser evil against a breaker that tripped once and never reopens.
   */
  probeStaleMs: number;
}

/** Cooldowns a fault may go untested before telephony stops assuming anything is testing it. */
const UNTESTED_COOLDOWNS = 4;

const DEFAULT_COOLDOWN_MS = 15 * 60_000;

export const DEFAULT_GATEWAY_POLICY: GatewayPolicy = {
  transientFailures: 3,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  probeStaleMs: UNTESTED_COOLDOWNS * DEFAULT_COOLDOWN_MS,
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
    // A test that found the fault still there is evidence that something is testing, which is a
    // separate question from whether it passed. Dropping it here would read, within the hour, as
    // nobody having looked, and would put a resident's phone back on the job.
    ...(b.probedAt ? { probedAt: b.probedAt } : {}),
    updatedAt: at,
  };
}

/**
 * A session the Live API accepted — a call that held a conversation, or a probe it answered. The
 * run of failures is dropped rather than decremented: one session that worked is proof the fault
 * is over, and counting down from it would keep calls stopped after the evidence for stopping
 * them had gone.
 */
export function recordGatewaySuccess(b: GatewayBreaker, now: Date): GatewayBreaker {
  if (b.failures === 0 && !b.probedAt) return b;
  return healthyGateway(now.toISOString());
}

/**
 * `working`: dial.
 * `probe`: dial, and this is the one call spent on finding out whether the fault is over. Reached
 * only when nothing has tested the fault for `probeStaleMs`, which during an outage the voice
 * gateway is doing every cooldown without anybody's phone.
 * `down`: do not dial. We already know how this call ends.
 */
export type GatewayVerdict = 'working' | 'probe' | 'down';

function tripped(b: GatewayBreaker, policy: GatewayPolicy): boolean {
  if (b.failures === 0) return false;
  return b.fault === 'systemic' || b.failures >= policy.transientFailures;
}

/**
 * How long since anything found out how this fault behaves — a call that met it, or a session
 * opened to see. The later of the two, so a test that also failed starts the wait again rather
 * than letting everything through on the strength of one expired cooldown.
 */
function untestedMs(b: GatewayBreaker, now: Date): number {
  const last = Math.max(Date.parse(b.lastFailedAt ?? b.updatedAt), b.probedAt ? Date.parse(b.probedAt) : 0);
  return now.getTime() - last;
}

export function gatewayVerdict(b: GatewayBreaker | null | undefined, now: Date, policy: GatewayPolicy): GatewayVerdict {
  if (!b || !tripped(b, policy)) return 'working';
  return untestedMs(b, now) >= policy.probeStaleMs ? 'probe' : 'down';
}

/**
 * Takes the one trial call an untested fault allows, or refuses. Pure, so the caller runs it
 * inside whatever transaction its store provides; two workers that both read "nothing has tested
 * this" would otherwise both ring somebody. Same reason `reserve` is shaped this way.
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

/**
 * Takes the one test a cooldown allows, for a caller that can open a Live session without a phone
 * call on the end of it. Pure for the same reason `claimCall` is: the voice gateway runs several
 * instances, each with its own clock, and a cooldown read outside the transaction that claims it
 * is not a cooldown.
 *
 * Returns the breaker to write, or null when there is nothing to find out — either the gateway is
 * not known to be broken, or the fault has already been tested within the cooldown.
 */
export function claimProbe(b: GatewayBreaker | null | undefined, now: Date, policy: GatewayPolicy): GatewayBreaker | null {
  if (!b || !tripped(b, policy) || untestedMs(b, now) < policy.cooldownMs) return null;
  return { ...b, probedAt: now.toISOString(), updatedAt: now.toISOString() };
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
  return { transientFailures: failures, cooldownMs: sec * 1000, probeStaleMs: sec * 1000 * UNTESTED_COOLDOWNS };
}
