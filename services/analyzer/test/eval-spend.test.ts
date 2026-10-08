import { charge, emptyLedger, formatUsd, parseSpendSettings, spendStatus, USD, type SpendSettings } from '@hachi/core';
import { MemoryStore } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { budgetRefusal, EvalSpend, spendBanner } from '../eval/spend.js';

const settings: SpendSettings = parseSpendSettings({ AI_MONTHLY_CAP_USD: '10' });
const MONTH = '2026-10';
const statusAt = (spentMicros: number) => spendStatus({ ...emptyLedger(MONTH, '2026-10-08T00:00:00.000Z'), spentMicros }, settings.policy);

/** `spendMonth(new Date())` decides which document is written, so the test reads the same way. */
const currentMonth = () => new Date().toISOString().slice(0, 7);

describe('whether an eval run is allowed to spend', () => {
  it('lets a run go ahead while the month still has room', () => {
    expect(budgetRefusal(statusAt(0), 0.9, false)).toBeNull();
    // Close is not the same as stopped: 89% of the cap still leaves room by design.
    expect(budgetRefusal(statusAt(8.9 * USD), 0.9, false)).toBeNull();
  });

  it('refuses once check-in calls have already stopped, and says what to do about it', () => {
    const reason = budgetRefusal(statusAt(9.5 * USD), 0.9, false);
    expect(reason).toMatch(/2026-10 AI spend is \$9\.50 of \$10\.00 \(95%\), past the 90% stop/);
    expect(reason).toMatch(/--ignore-budget/);
    expect(reason).toMatch(/AI_MONTHLY_CAP_USD/);
  });

  /**
   * The deadline is 2026-10-18 and a run costs ¥500-1,000, so a wall in front of the last rehearsal
   * is worse than the spend. A person at a terminal can read the number and decide; the scheduler
   * that dials residents cannot, which is why that one still fails closed.
   */
  it('goes ahead anyway when a person has said to, however spent the month is', () => {
    expect(budgetRefusal(statusAt(9.5 * USD), 0.9, true)).toBeNull();
    expect(budgetRefusal(statusAt(1_000 * USD), 0.9, true)).toBeNull();
  });
});

describe('what an eval run records', () => {
  const open = async (store = new MemoryStore()) => ({ store, spend: new EvalSpend(store, settings, statusAt(0)) });

  it('charges the real ledger at the configured prices, not a store it throws away', async () => {
    const { store, spend } = await open();
    spend.record({ in: 1_000_000, out: 1_000_000 });
    await spend.flush();
    const expected = settings.prices.analysisInMicrosPerMillion + settings.prices.analysisOutMicrosPerMillion;
    expect(spend.spentMicros).toBe(expected);
    expect((await store.getSpendLedger(currentMonth()))!.spentMicros).toBe(expected);
  });

  it('coalesces a whole run of requests without losing any of them', async () => {
    const { store, spend } = await open();
    for (let i = 0; i < 200; i++) spend.record({ in: 10_000, out: 5_000 });
    await spend.flush();
    const one = settings.prices.analysisInMicrosPerMillion / 100 + settings.prices.analysisOutMicrosPerMillion / 200;
    expect(spend.spentMicros).toBe(200 * Math.ceil(one));
    expect((await store.getSpendLedger(currentMonth()))!.spentMicros).toBe(spend.spentMicros);
    expect(spend.lostMicros).toBe(0);
  });

  it('ignores a request that reported no tokens', async () => {
    const { store, spend } = await open();
    spend.record({ in: 0, out: 0 });
    await spend.flush();
    expect(spend.spentMicros).toBe(0);
    expect(await store.getSpendLedger(currentMonth())).toBeNull();
  });

  /** The request is already paid for by the time it is recorded, so a failed write cannot fail the run. */
  it('finishes the run when the ledger cannot be written, and says the month is now short', async () => {
    const store = new MemoryStore();
    store.mutateSpendLedger = async () => {
      throw new Error('Firestore unavailable');
    };
    const spend = new EvalSpend(store, settings, statusAt(0));
    spend.record({ in: 1_000_000, out: 0 });
    await expect(spend.flush()).resolves.toBeUndefined();
    expect(spend.lostMicros).toBe(settings.prices.analysisInMicrosPerMillion);
    expect(spend.describe()).toMatch(/NOT recorded/);
  });

  it('puts the month on screen before anything is spent', () => {
    const spend = new EvalSpend(new MemoryStore(), settings, statusAt(5 * USD));
    expect(spendBanner(spend)).toBe(`month 2026-10: ${formatUsd(5 * USD)} of ${formatUsd(10 * USD)} committed (50%), ${formatUsd(4 * USD)} left before calls stop`);
  });

  it('reports what it charged, for the run summary', async () => {
    const { spend } = await open();
    spend.record({ in: 2_000_000, out: 0 });
    await spend.flush();
    expect(spend.describe()).toBe(`recorded ${formatUsd(2 * settings.prices.analysisInMicrosPerMillion)} to the 2026-10 ledger`);
  });
});

describe('the ledger an eval shares with the daily call', () => {
  /** Both write `charge`, so a month is the sum of both and neither can hide from the other. */
  it('adds eval spend to the same month the calls are charged to', async () => {
    const store = new MemoryStore();
    const now = new Date();
    await store.mutateSpendLedger(currentMonth(), (l) => charge(l, 3 * USD, now));
    const spend = new EvalSpend(store, settings, statusAt(3 * USD));
    spend.record({ in: 1_000_000, out: 0 });
    await spend.flush();
    const ledger = (await store.getSpendLedger(currentMonth()))!;
    expect(ledger.spentMicros).toBe(3 * USD + settings.prices.analysisInMicrosPerMillion);
  });
});
