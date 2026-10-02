import type { Urgency } from './urgency.js';

export type IntakeStatus = 'normal' | 'poor' | 'unknown';

export interface IntakeObservation {
  /** Local calendar date of the call, YYYY-MM-DD. */
  date: string;
  status: IntakeStatus;
  /** Days without eating that the resident reported in that call ("haven't eaten for 3 days"). */
  reportedPoorDays?: number;
}

export interface R2Assessment {
  poorIntakeDays: number;
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

function severity(o: IntakeObservation): number {
  return o.status === 'poor' ? 1 + (o.reportedPoorDays ?? 1) : 0;
}

/**
 * Counts consecutive days of poor intake ending at the latest observation (DET-04).
 * A single day without an observation (missed call) does not break the streak, so a
 * missed call between two poor days still escalates (PRI-04).
 */
export function countPoorIntakeDays(observations: IntakeObservation[]): number {
  const byDay = new Map<number, IntakeObservation>();
  for (const o of observations) {
    if (o.status === 'unknown') continue;
    const d = dayIndex(o.date);
    const prev = byDay.get(d);
    if (!prev || severity(o) > severity(prev)) byDay.set(d, o);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const latestDay = days[0];
  if (latestDay === undefined) return 0;

  let streak = 0;
  let best = 0;
  let expected = latestDay;
  for (const d of days) {
    const o = byDay.get(d)!;
    if (o.status !== 'poor' || expected - d > 1) break;
    streak += 1;
    best = Math.max(best, streak - 1 + Math.max(1, o.reportedPoorDays ?? 1));
    expected = d - 1;
  }
  return best;
}

export function assessR2(observations: IntakeObservation[]): R2Assessment {
  const poorIntakeDays = countPoorIntakeDays(observations);
  let urgency: Urgency | null = null;
  if (poorIntakeDays >= 2) urgency = 'urgent';
  else if (poorIntakeDays === 1) urgency = 'watch';
  return { poorIntakeDays, urgency, followUpNextCall: poorIntakeDays > 0 };
}
