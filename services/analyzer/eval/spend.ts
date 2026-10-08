/**
 * The monthly AI spend ledger, as the evaluation scripts see it.
 *
 * An eval run is by far the most expensive thing in this repository. Two of them accounted for
 * roughly 94% of October's Gemini spend — about $9.72 across 10/04 and 10/05, against $0.1–0.3 on
 * an ordinary day of real check-in calls — and none of it was recorded. `eval/run.ts` called the
 * reviewer without `onUsage`, and `eval/r12-run.ts` charged a `MemoryStore` it then dropped. So the
 * total on the staff screen and the total the daily call consults before dialing were both wrong by
 * more than tenfold, and wrong in the direction that keeps dialing.
 *
 * Writing to Firestore rather than to whatever store the run already has is the entire point. A run
 * that measures its own cost into a store it throws away has told nobody.
 *
 * An eval is *not* refused the way a check-in call is. The ceiling exists because a scheduler
 * dialing four hundred residents cannot read a number and decide, so it has to fail closed; an eval
 * is run by a person at a terminal who can. Submission is 2026-10-18 and a run costs ¥500–1,000, so
 * several are needed and a wall in front of the last rehearsal before a deadline is the more
 * expensive mistake. The run therefore stops to show the number and goes ahead on
 * `--ignore-budget`, which records all the same.
 */
import { analysisMicros, charge, emptyLedger, formatUsd, parseSpendSettings, spendMonth, spendStatus, type SpendSettings, type SpendStatus } from '@hachi/core';
import { FirestoreStore, type Store } from '@hachi/store';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export class EvalSpend {
  /** Recorded by this run, so the report can say what it cost rather than only estimating it. */
  spentMicros = 0;
  /** Charges whose write failed. Reported rather than swallowed, since the month is now short. */
  lostMicros = 0;
  private pending = 0;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    readonly settings: SpendSettings,
    /** The month as it stood when the run started, for the line the script prints. */
    readonly before: SpendStatus,
  ) {}

  /**
   * Records tokens that have already been spent, so it never refuses and never throws: the request
   * is paid for by the time this is called, and a run that dies on a Firestore hiccup loses its
   * report as well as its money.
   *
   * Writes are coalesced onto one in-flight mutation rather than batched to the end of the run,
   * because an eval that crashes half way through has still spent half the money, and that half is
   * exactly the kind of invisible spend this exists to stop.
   */
  record(tokens: { in: number; out: number }): void {
    const micros = analysisMicros(tokens.in, tokens.out, this.settings.prices);
    if (micros <= 0) return;
    this.spentMicros += micros;
    this.pending += micros;
    this.writing ??= this.drain();
  }

  private async drain(): Promise<void> {
    while (this.pending > 0) {
      const micros = this.pending;
      this.pending = 0;
      const now = new Date();
      try {
        await this.store.mutateSpendLedger(spendMonth(now), (l) => charge(l, micros, now));
      } catch {
        this.lostMicros += micros;
      }
    }
    this.writing = null;
  }

  /** Settles up before the script exits, so the last few requests are not lost to the process end. */
  async flush(): Promise<void> {
    await this.writing;
    if (this.pending > 0) await this.drain();
  }

  /** One line for the run's closing output. */
  describe(): string {
    const lost = this.lostMicros > 0 ? `, ${formatUsd(this.lostMicros)} NOT recorded (ledger write failed)` : '';
    return `recorded ${formatUsd(this.spentMicros)} to the ${this.before.month} ledger${lost}`;
  }
}

/** Raised instead of running, so the caller prints it and exits rather than spending. */
export class BudgetRefused extends Error {}

/**
 * Why this run must not go ahead, or null.
 *
 * Only the month already being stopped refuses. Being merely close does not: the point of the stop
 * fraction is that the last tenth is the margin for our arithmetic being wrong, and an eval run is
 * the one thing large enough to spend that whole margin at once — after which Google's spend cap is
 * the next thing to fire, and it fires by cutting off a call that is already ringing.
 *
 * Separate from the Firestore wiring so that the decision can be tested, since the decision is the
 * part that can be wrong in a way that costs either money or a demo.
 */
export function budgetRefusal(status: SpendStatus, stopAtFraction: number, ignoreBudget: boolean): string | null {
  if (!status.paused || ignoreBudget) return null;
  return (
    `${status.month} AI spend is ${formatUsd(status.committedMicros)} of ${formatUsd(status.capMicros)} ` +
    `(${Math.round(status.usedFraction * 100)}%), past the ${Math.round(stopAtFraction * 100)}% stop. ` +
    "Check-in calls have already stopped, and what is left is the margin that keeps Google's own spend cap from " +
    'cutting off a call that is already ringing. Raise AI_MONTHLY_CAP_USD, or re-run with --ignore-budget if this ' +
    'eval matters more than that margin.'
  );
}

/**
 * Opens the real ledger and decides whether this run may proceed.
 *
 * An unreachable ledger refuses too. Going ahead would be precisely the blindness this exists to
 * fix, only now with code in place claiming to have fixed it, and `--ignore-budget` already means
 * "spend without the ledger's permission".
 */
export async function openEvalSpend(opts: { project: string; ignoreBudget: boolean }): Promise<EvalSpend> {
  const settings = parseSpendSettings(process.env);
  const db = getFirestore(initializeApp({ projectId: opts.project }, `eval-spend-${Date.now()}`));
  db.settings({ ignoreUndefinedProperties: true });
  const store = new FirestoreStore(db);
  const month = spendMonth(new Date());

  let status: SpendStatus;
  try {
    const ledger = (await store.getSpendLedger(month)) ?? emptyLedger(month, new Date().toISOString());
    status = spendStatus(ledger, settings.policy);
  } catch (err) {
    if (!opts.ignoreBudget) {
      throw new BudgetRefused(
        `Cannot read the ${month} spend ledger (${(err as Error).message}). An eval run costs ¥500-1,000 and none of it would be recorded. Re-run with --ignore-budget to spend anyway.`,
      );
    }
    status = spendStatus(emptyLedger(month, new Date().toISOString()), settings.policy);
  }

  const refusal = budgetRefusal(status, settings.policy.stopAtFraction, opts.ignoreBudget);
  if (refusal) throw new BudgetRefused(refusal);
  return new EvalSpend(store, settings, status);
}

/** The banner every eval prints before spending anything, so the month is on screen either way. */
export function spendBanner(s: EvalSpend): string {
  const b = s.before;
  return `month ${b.month}: ${formatUsd(b.committedMicros)} of ${formatUsd(b.capMicros)} committed (${Math.round(b.usedFraction * 100)}%), ${formatUsd(b.availableMicros)} left before calls stop`;
}
