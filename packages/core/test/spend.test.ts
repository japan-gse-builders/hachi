import { describe, expect, it } from 'vitest';
import {
  analysisMicros,
  callReservationMicros,
  charge,
  committedMicros,
  emptyLedger,
  formatUsd,
  liveCallMicros,
  parseSpendSettings,
  reserve,
  settle,
  spendMonth,
  spendStatus,
  USD,
  writeOffStaleLeases,
  type SpendLedger,
  type SpendPolicy,
} from '../src/spend.js';

const NOW = new Date('2026-10-08T05:00:00.000Z');
const policy: SpendPolicy = { capMicros: 100 * USD, stopAtFraction: 0.9, leaseMaxAgeMs: 6 * 3_600_000 };
const prices = parseSpendSettings({}).prices;
const ledger = (over: Partial<SpendLedger> = {}): SpendLedger => ({ ...emptyLedger('2026-10', NOW.toISOString()), ...over });
const lease = (id: string, micros: number, at = NOW.toISOString()) => ({ id, micros, at });

describe('spend arithmetic', () => {
  it('bills a call by the minute and a review by the token', () => {
    expect(liveCallMicros(60, prices)).toBe(prices.liveMicrosPerMin);
    expect(liveCallMicros(30, prices)).toBe(prices.liveMicrosPerMin / 2);
    expect(liveCallMicros(-5, prices)).toBe(0);
    expect(analysisMicros(1_000_000, 0, prices)).toBe(prices.analysisInMicrosPerMillion);
    expect(analysisMicros(0, 1_000_000, prices)).toBe(prices.analysisOutMicrosPerMillion);
  });

  it('rounds every charge up, so the month is never understated', () => {
    expect(liveCallMicros(1, prices)).toBeGreaterThanOrEqual(prices.liveMicrosPerMin / 60);
    expect(Number.isInteger(liveCallMicros(37, prices))).toBe(true);
    // A fraction of a micro-dollar still costs something, so it is never rounded away.
    expect(analysisMicros(1, 1, prices)).toBe(4);
    expect(analysisMicros(0, 0, prices)).toBe(0);
  });

  it('reserves a whole call up front, not what it is likely to use', () => {
    // A call cannot outlast the gateway's limit, so the worst case is knowable before dialing.
    expect(callReservationMicros(480, prices)).toBeGreaterThan(liveCallMicros(480, prices));
    expect(callReservationMicros(480, prices)).toBeGreaterThan(callReservationMicros(240, prices));
  });

  it('reads prices and the cap from the environment, keeping the eval script defaults', () => {
    const d = parseSpendSettings({});
    expect(d.prices.analysisInMicrosPerMillion).toBe(0.5 * USD);
    expect(d.prices.analysisOutMicrosPerMillion).toBe(3 * USD);
    expect(d.policy).toEqual({ capMicros: 200 * USD, stopAtFraction: 0.9, leaseMaxAgeMs: 6 * 3_600_000 });
    const custom = parseSpendSettings({ AI_MONTHLY_CAP_USD: '12.5', GEMINI_PRICE_IN_PER_M: '1', AI_SPEND_STOP_FRACTION: '0.5' });
    expect(custom.policy.capMicros).toBe(12_500_000);
    expect(custom.prices.analysisInMicrosPerMillion).toBe(USD);
    expect(custom.policy.stopAtFraction).toBe(0.5);
    expect(() => parseSpendSettings({ AI_MONTHLY_CAP_USD: '-1' })).toThrow(/non-negative/);
    expect(() => parseSpendSettings({ AI_SPEND_STOP_FRACTION: '1.5' })).toThrow(/at most 1/);
  });

  it('names the month in UTC', () => {
    expect(spendMonth(new Date('2026-01-31T23:59:59.000Z'))).toBe('2026-01');
    expect(spendMonth(new Date('2026-02-01T00:00:00.000Z'))).toBe('2026-02');
  });

  it('writes dollars for people who do not think in micros', () => {
    expect(formatUsd(1_234_567)).toBe('$1.23');
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('the monthly ceiling', () => {
  it('counts reservations as spent for the purpose of deciding', () => {
    const l = ledger({ spentMicros: 10 * USD, leases: [lease('a', 5 * USD)] });
    expect(committedMicros(l)).toBe(15 * USD);
    expect(spendStatus(l, policy)).toMatchObject({ spentMicros: 10 * USD, reservedMicros: 5 * USD, paused: false });
  });

  it('stops ten percent short of the cap, leaving room for being wrong', () => {
    const near = ledger({ spentMicros: 89 * USD });
    expect(spendStatus(near, policy).paused).toBe(false);
    expect(spendStatus(ledger({ spentMicros: 90 * USD }), policy).paused).toBe(true);
    // The last ten dollars are not available to new calls even though the cap is not reached.
    expect(spendStatus(near, policy).availableMicros).toBe(1 * USD);
  });

  it('refuses a reservation that would cross the line, and takes one that fits', () => {
    const l = ledger({ spentMicros: 89 * USD });
    expect(reserve(l, lease('big', 2 * USD), policy, NOW)).toBeNull();
    const after = reserve(l, lease('small', 1 * USD), policy, NOW);
    expect(after?.leases.map((x) => x.id)).toEqual(['small']);
  });

  it('does not reserve twice for the same work', () => {
    const l = reserve(ledger(), lease('call:r1/c1', 5 * USD), policy, NOW)!;
    const again = reserve(l, lease('call:r1/c1', 5 * USD), policy, NOW)!;
    expect(again.leases).toHaveLength(1);
    expect(committedMicros(again)).toBe(5 * USD);
  });

  it('replaces the reservation with what the work really cost', () => {
    const l = reserve(ledger(), lease('c1', 5 * USD), policy, NOW)!;
    const done = settle(l, 'c1', 2 * USD, NOW);
    expect(done).toMatchObject({ spentMicros: 2 * USD, leases: [] });
  });

  it('charges the reservation when the work cannot say what it cost', () => {
    // An unknown cost is not a free one.
    const l = reserve(ledger(), lease('c1', 5 * USD), policy, NOW)!;
    expect(settle(l, 'c1', undefined, NOW).spentMicros).toBe(5 * USD);
  });

  it('ignores a second settlement, because status callbacks arrive more than once', () => {
    const l = settle(reserve(ledger(), lease('c1', 5 * USD), policy, NOW)!, 'c1', 2 * USD, NOW);
    expect(settle(l, 'c1', 2 * USD, NOW)).toEqual(l);
  });

  it('writes off a reservation whose work never came back, rather than releasing it', () => {
    const old = new Date(NOW.getTime() - 7 * 3_600_000).toISOString();
    const l = ledger({ leases: [lease('stale', 3 * USD, old), lease('live', 1 * USD)] });
    const swept = writeOffStaleLeases(l, NOW, policy);
    // A ceiling that leaks upwards whenever a service crashes is not a ceiling.
    expect(swept.spentMicros).toBe(3 * USD);
    expect(swept.leases.map((x) => x.id)).toEqual(['live']);
  });

  it('sweeps stale reservations as part of deciding, so a crash cannot free up budget', () => {
    const old = new Date(NOW.getTime() - 7 * 3_600_000).toISOString();
    const l = ledger({ spentMicros: 88 * USD, leases: [lease('stale', 2 * USD, old)] });
    expect(reserve(l, lease('new', 1 * USD), policy, NOW)).toBeNull();
  });

  it('records work that could not have been refused without pretending to have reserved it', () => {
    const l = charge(ledger({ spentMicros: 95 * USD }), 2 * USD, NOW);
    expect(l.spentMicros).toBe(97 * USD);
    expect(charge(l, 0, NOW)).toBe(l);
  });
});
