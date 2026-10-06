import type { Urgency } from './urgency.js';

export type IntakeStatus = 'normal' | 'poor' | 'unknown';

export interface IntakeObservation {
  /** Local calendar date of the call, YYYY-MM-DD. */
  date: string;
  status: IntakeStatus;
  /** Days without eating that the resident reported in that call ("haven't eaten for 3 days"). */
  reportedPoorDays?: number;
  /**
   * Drinks, counted apart from food. INTERACT's Stop and Watch lists drinking less as a trigger of
   * its own, and in an older adult dehydration turns into delirium, a fall or a kidney injury
   * faster than missed meals turn into anything.
   */
  fluids?: IntakeStatus;
}

export interface R2Assessment {
  poorIntakeDays: number;
  poorFluidDays: number;
  urgency: Urgency | null;
  /** DET-04: ask about meals again on the next call. */
  followUpNextCall: boolean;
}

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${date}`);
  return Math.round(t / DAY_MS);
}

type Kind = 'food' | 'fluids';

function statusOf(o: IntakeObservation, kind: Kind): IntakeStatus {
  return kind === 'food' ? o.status : (o.fluids ?? 'unknown');
}

/** Only eating carries a reported run of days; nobody says "I haven't had a drink for three days". */
function reportedDays(o: IntakeObservation, kind: Kind): number {
  return kind === 'food' ? Math.max(1, o.reportedPoorDays ?? 1) : 1;
}

function severity(o: IntakeObservation, kind: Kind): number {
  return statusOf(o, kind) === 'poor' ? 1 + reportedDays(o, kind) : 0;
}

/**
 * Counts consecutive days of poor intake ending at the latest observation (DET-04).
 * A single day without an observation (missed call) does not break the streak, so a
 * missed call between two poor days still escalates (PRI-04).
 */
function countPoorDays(observations: IntakeObservation[], kind: Kind): number {
  const byDay = new Map<number, IntakeObservation>();
  for (const o of observations) {
    if (statusOf(o, kind) === 'unknown') continue;
    const d = dayIndex(o.date);
    const prev = byDay.get(d);
    if (!prev || severity(o, kind) > severity(prev, kind)) byDay.set(d, o);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const latestDay = days[0];
  if (latestDay === undefined) return 0;

  let streak = 0;
  let best = 0;
  let expected = latestDay;
  for (const d of days) {
    const o = byDay.get(d)!;
    if (statusOf(o, kind) !== 'poor' || expected - d > 1) break;
    streak += 1;
    best = Math.max(best, streak - 1 + reportedDays(o, kind));
    expected = d - 1;
  }
  return best;
}

export function countPoorIntakeDays(observations: IntakeObservation[]): number {
  return countPoorDays(observations, 'food');
}

export function countPoorFluidDays(observations: IntakeObservation[]): number {
  return countPoorDays(observations, 'fluids');
}

export function assessR2(observations: IntakeObservation[]): R2Assessment {
  const poorIntakeDays = countPoorIntakeDays(observations);
  const poorFluidDays = countPoorFluidDays(observations);
  let urgency: Urgency | null = null;
  // Nothing eaten and nothing drunk on the same day is someone taking nothing in at all, which
  // does not wait for a second day.
  if (poorIntakeDays >= 2 || poorFluidDays >= 2 || (poorIntakeDays >= 1 && poorFluidDays >= 1)) urgency = 'urgent';
  else if (poorFluidDays === 1) urgency = 'action';
  else if (poorIntakeDays === 1) urgency = 'watch';
  return { poorIntakeDays, poorFluidDays, urgency, followUpNextCall: poorIntakeDays > 0 || poorFluidDays > 0 };
}
