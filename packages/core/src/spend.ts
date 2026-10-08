/**
 * The monthly ceiling on AI spend, and what happens at it.
 *
 * Every resident costs money every day: a Live session billed by the second and a post-call review
 * billed by the token. Nothing about that is self-limiting, so a misconfiguration or a run of calls
 * that nobody answers bills until somebody notices the invoice. This is the part that notices.
 *
 * Amounts are integer micro-dollars throughout. Money in floating point accumulates error exactly
 * where it must not, and the comparison that decides whether to place a call is one of those places.
 */

/** A reservation held by work that has started and not yet been accounted for. */
export interface SpendLease {
  /** The work holding it, so settling the same work twice does not double-count. */
  id: string;
  micros: number;
  /** ISO timestamp. A lease whose work never reported back is written off from here. */
  at: string;
}

/** One calendar month. Written to one document, so every change to it is a single transaction. */
export interface SpendLedger {
  /** YYYY-MM in UTC. The month boundary is arbitrary either way; UTC at least never moves. */
  month: string;
  /** Work that has finished and been accounted for. */
  spentMicros: number;
  leases: SpendLease[];
  updatedAt: string;
}

export interface SpendPolicy {
  capMicros: number;
  /**
   * Where new calls stop, as a fraction of the cap. Not 1.0: calls already in progress are only
   * estimated, and what Google bills is not what we computed, so the last slice is the room for
   * being wrong.
   */
  stopAtFraction: number;
  /** A lease older than this is treated as spent, since its work is not coming back to settle it. */
  leaseMaxAgeMs: number;
}

export interface SpendPrices {
  /**
   * One minute of a Live call. Conservative on purpose: both directions are counted for the whole
   * duration at the audio rate, although the model is not speaking the whole time and some of what
   * it sends is cheaper. Under-reporting here would defeat the point of having a ceiling.
   */
  liveMicrosPerMin: number;
  /** Post-call review, per million tokens, matching the names the eval scripts already use. */
  analysisInMicrosPerMillion: number;
  analysisOutMicrosPerMillion: number;
}

export const DEFAULT_SPEND_POLICY: Omit<SpendPolicy, 'capMicros'> = {
  stopAtFraction: 0.9,
  leaseMaxAgeMs: 6 * 3_600_000,
};

export const USD = 1_000_000;

/** The ledger a month starts with. */
export function emptyLedger(month: string, at: string): SpendLedger {
  return { month, spentMicros: 0, leases: [], updatedAt: at };
}

/** The month a moment belongs to, in UTC. */
export function spendMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function liveCallMicros(durationSec: number, p: SpendPrices): number {
  return Math.ceil((Math.max(0, durationSec) / 60) * p.liveMicrosPerMin);
}

export function analysisMicros(inTokens: number, outTokens: number, p: SpendPrices): number {
  const inCost = (Math.max(0, inTokens) / 1_000_000) * p.analysisInMicrosPerMillion;
  const outCost = (Math.max(0, outTokens) / 1_000_000) * p.analysisOutMicrosPerMillion;
  return Math.ceil(inCost + outCost);
}

/**
 * What one call is allowed to cost before it starts. The call cannot be longer than the gateway
 * lets it be, and the review that follows is bounded by the transcript of a call that long, so the
 * worst case is knowable in advance. Reserving the worst case means a month can never go over
 * because several calls happened to run long at once.
 */
export function callReservationMicros(maxConversationSec: number, p: SpendPrices, estimatedAnalysisTokens = 20_000): number {
  return liveCallMicros(maxConversationSec, p) + analysisMicros(estimatedAnalysisTokens, 2_000, p);
}

/**
 * Leases whose work never came back. Their money was almost certainly spent, so it is moved to
 * `spent` rather than released: a ceiling that leaks upwards when a service crashes is not one.
 */
export function writeOffStaleLeases(l: SpendLedger, now: Date, policy: SpendPolicy): SpendLedger {
  const cutoff = now.getTime() - policy.leaseMaxAgeMs;
  const stale = l.leases.filter((x) => Date.parse(x.at) < cutoff);
  if (!stale.length) return l;
  return {
    ...l,
    spentMicros: l.spentMicros + stale.reduce((a, x) => a + x.micros, 0),
    leases: l.leases.filter((x) => Date.parse(x.at) >= cutoff),
    updatedAt: now.toISOString(),
  };
}

/** Everything the month is on the hook for: settled spend plus every reservation in flight. */
export function committedMicros(l: SpendLedger): number {
  return l.spentMicros + l.leases.reduce((a, x) => a + x.micros, 0);
}

export interface SpendStatus {
  month: string;
  capMicros: number;
  spentMicros: number;
  reservedMicros: number;
  committedMicros: number;
  /** What is still available for new calls, after the safety margin. Never negative. */
  availableMicros: number;
  /** 0..1 of the cap, for showing how close the month is. */
  usedFraction: number;
  /** True when new daily calls are no longer being placed. */
  paused: boolean;
}

export function spendStatus(l: SpendLedger, policy: SpendPolicy): SpendStatus {
  const committed = committedMicros(l);
  const budget = Math.floor(policy.capMicros * policy.stopAtFraction);
  return {
    month: l.month,
    capMicros: policy.capMicros,
    spentMicros: l.spentMicros,
    reservedMicros: committed - l.spentMicros,
    committedMicros: committed,
    availableMicros: Math.max(0, budget - committed),
    usedFraction: policy.capMicros > 0 ? committed / policy.capMicros : 1,
    paused: committed >= budget,
  };
}

/**
 * Takes a reservation, or refuses. Pure, so the caller runs it inside whatever transaction its
 * store provides; a check that is not in the same transaction as the write it guards is not a
 * ceiling, it is a race.
 *
 * Re-reserving under an id that already holds a lease returns the ledger unchanged, so a redelivered
 * task does not reserve twice.
 */
export function reserve(l: SpendLedger, lease: SpendLease, policy: SpendPolicy, now: Date): SpendLedger | null {
  const base = writeOffStaleLeases(l, now, policy);
  if (base.leases.some((x) => x.id === lease.id)) return base;
  if (spendStatus(base, policy).availableMicros < lease.micros) return null;
  return { ...base, leases: [...base.leases, lease], updatedAt: now.toISOString() };
}

/**
 * Accounts for work that has finished. `actualMicros` of undefined means the work could not say
 * what it cost, in which case the reservation stands: an unknown cost is not a free one.
 *
 * Settling a lease that is already gone is a no-op rather than a second charge, because the status
 * callbacks that trigger it arrive more than once.
 */
export function settle(l: SpendLedger, leaseId: string, actualMicros: number | undefined, now: Date): SpendLedger {
  const lease = l.leases.find((x) => x.id === leaseId);
  if (!lease) return l;
  return {
    ...l,
    spentMicros: l.spentMicros + (actualMicros ?? lease.micros),
    leases: l.leases.filter((x) => x.id !== leaseId),
    updatedAt: now.toISOString(),
  };
}

/**
 * Work that happened without a reservation and could not have been refused: the review of a call
 * that has already been made. It is recorded so the month's number is true, not so it can be
 * stopped.
 */
export function charge(l: SpendLedger, micros: number, now: Date): SpendLedger {
  if (micros <= 0) return l;
  return { ...l, spentMicros: l.spentMicros + micros, updatedAt: now.toISOString() };
}

/** For staff, who think in dollars. */
export function formatUsd(micros: number): string {
  return `$${(micros / USD).toFixed(2)}`;
}

export interface SpendSettings {
  prices: SpendPrices;
  policy: SpendPolicy;
}

function usd(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  const v = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be a non-negative number of US dollars`);
  return Math.round(v * USD);
}

/**
 * Prices and the ceiling, read from the environment so they can be changed without a deploy and so
 * that every service agrees on them. Three services charge the same ledger, and a price that
 * differs between them makes the month's total mean nothing, so the parsing lives here rather than
 * in each service's own config.
 *
 * The two token prices keep the names and defaults the evaluation scripts already use.
 */
export function parseSpendSettings(env: Record<string, string | undefined>): SpendSettings {
  const stopRaw = env.AI_SPEND_STOP_FRACTION;
  const stopAtFraction = stopRaw === undefined || stopRaw.trim() === '' ? DEFAULT_SPEND_POLICY.stopAtFraction : Number(stopRaw);
  if (!Number.isFinite(stopAtFraction) || stopAtFraction <= 0 || stopAtFraction > 1) {
    throw new Error('AI_SPEND_STOP_FRACTION must be greater than 0 and at most 1');
  }
  return {
    prices: {
      liveMicrosPerMin: usd(env, 'GEMINI_LIVE_PRICE_PER_MIN', 0.03),
      analysisInMicrosPerMillion: usd(env, 'GEMINI_PRICE_IN_PER_M', 0.5),
      analysisOutMicrosPerMillion: usd(env, 'GEMINI_PRICE_OUT_PER_M', 3),
    },
    policy: { ...DEFAULT_SPEND_POLICY, capMicros: usd(env, 'AI_MONTHLY_CAP_USD', 200), stopAtFraction },
  };
}
