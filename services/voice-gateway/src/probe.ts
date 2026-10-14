/**
 * Finding out whether the Live API will hold a conversation again, without phoning anybody to ask.
 *
 * The breaker next door stops the daily calls the moment Vertex AI refuses us, and something has
 * to decide when they start again. A health check cannot: `/health` answered `ok` throughout the
 * spend-cap outage, because the container was fine and it was Vertex AI refusing the project. The
 * only thing that settles it is opening a session on the path that failed — and a session is the
 * one half of a call that does not need a phone on the other end of it.
 *
 * So the test is a Live connection with no call attached, closed as soon as the server says it is
 * ready. It runs here rather than in telephony because only this service may call Vertex AI at
 * all, and it writes the breaker this service already writes. The alternative — telephony asking
 * for a test over HTTP when a resident is due — would have put a second authenticated endpoint on
 * a public service and a cross-region round trip inside the dial path, to learn the same fact
 * later and no more reliably.
 *
 * What it proves and what it does not:
 *
 * - **Proves** the API accepts a session for this project, model and region. That is exactly what
 *   a spend cap, an exhausted quota, a revoked permission or a withdrawn model refuses, and those
 *   are the faults the breaker classifies as systemic. For the outage this was written for — the
 *   server closing with `1008 Spend cap breached` — it is a true test.
 * - **Does not prove** that a conversation would go well. A fault that only appears once audio
 *   flows, a model that connects and then never speaks, a voice that is missing, a transcription
 *   that never arrives: the probe sends nothing and hears nothing, so it would clear the breaker
 *   on all of them. Those faults are classified transient and would stop the calls again after
 *   three of them, which is the same handful of rings as before the breaker existed.
 */
import { claimProbe, recordGatewayFailure, recordGatewaySuccess, type GatewayBreaker, type GatewayPolicy } from '@hachi/core';
import type { Store } from '@hachi/store';
import type { EmergencyPresence } from './emergency.js';
import type { LiveConnector, LiveHandlers, LiveSession } from './live.js';
import type { Logger } from './session.js';

/**
 * What the probe asks the model to be. Short, and about nobody: this is not a check-in, so there
 * is no reason for a resident's name, their history or today's questions to travel into a session
 * opened to test an API. It is also the cheapest thing the setup can carry, and the only tokens a
 * probe spends are the ones in this line.
 */
const PROBE_INSTRUCTION = 'Connection test. Do not speak.';

/**
 * Long enough for a cold websocket to Vertex AI, short enough that an attempt is finished well
 * inside the cooldown that permitted it.
 */
const PROBE_TIMEOUT_MS = 15_000;

/** Everything a conversation would carry. A probe has none of it and listens for none of it. */
const IGNORED: LiveHandlers = {
  audio: () => {},
  inputTranscript: () => {},
  outputTranscript: () => {},
  interrupted: () => {},
  turnComplete: () => {},
  toolCalls: () => {},
  resumable: () => {},
  notResumable: () => {},
  usage: () => {},
  goingAway: () => {},
  closed: () => {},
};

export type ProbeOutcome =
  | { outcome: 'skipped'; reason: 'not_due' | 'emergency' | 'in_flight' }
  | { outcome: 'recovered' }
  | { outcome: 'still_down'; reason: string }
  /** The server neither accepted the session nor refused it, which says nothing either way. */
  | { outcome: 'inconclusive' };

export interface ProbeDeps {
  store: Store;
  /**
   * The same connector a real call uses, so the probe is the same model in the same region as the
   * thing that broke. A second client configured separately would drift, and a probe that proves
   * something about a different code path is worse than none.
   */
  live: LiveConnector;
  emergencies: EmergencyPresence;
  policy: GatewayPolicy;
  log: Logger;
  now?: () => Date;
  timeoutMs?: number;
}

type Attempt = { kind: 'ready' } | { kind: 'refused'; reason: string } | { kind: 'silent' };

export class GatewayProbe {
  private inFlight = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: ProbeDeps) {}

  /**
   * Starts looking. The tick is not the budget — `claimProbe` is, and it allows one session per
   * cooldown across every instance — so this only decides how late a test is, never how many.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.run().catch((err: Error) => this.deps.log.error({ err: err.message }, 'gateway probe failed'));
    }, Math.min(60_000, this.deps.policy.cooldownMs));
    // Nothing here should keep the process alive on its own; a shutdown is Cloud Run's to decide.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async run(): Promise<ProbeOutcome> {
    const now = this.deps.now ?? (() => new Date());
    if (this.deps.emergencies.active) return { outcome: 'skipped', reason: 'emergency' };
    if (this.inFlight) return { outcome: 'skipped', reason: 'in_flight' };
    // Claimed before the socket is opened rather than after, so an instance that is slow to
    // connect does not leave the cooldown looking unspent to the instance that checks next.
    const claimed = await this.deps.store.mutateGatewayBreaker((b) => claimProbe(b, now(), this.deps.policy));
    if (!claimed) return { outcome: 'skipped', reason: 'not_due' };
    this.inFlight = true;
    try {
      const attempt = await this.attempt();
      if (attempt.kind === 'ready') {
        await this.deps.store.mutateGatewayBreaker((b) => recordGatewaySuccess(b, now()));
        this.deps.log.warn({ down: downFor(claimed, now()) }, 'Gemini Live accepted a probe session; check-in calls can go out again');
        return { outcome: 'recovered' };
      }
      if (attempt.kind === 'refused') {
        await this.deps.store.mutateGatewayBreaker((b) => recordGatewayFailure(b, attempt.reason, now()));
        this.deps.log.warn({ reason: attempt.reason }, 'Gemini Live refused a probe session; check-in calls stay stopped');
        return { outcome: 'still_down', reason: attempt.reason };
      }
      // Nothing is written. The claim already moved the cooldown on, and replacing Vertex AI's own
      // words for the fault with ours would cost staff the one line they can act on.
      this.deps.log.warn({ timeoutMs: this.timeout() }, 'Gemini Live neither accepted nor refused a probe session');
      return { outcome: 'inconclusive' };
    } finally {
      this.inFlight = false;
    }
  }

  private timeout(): number {
    return this.deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  private async attempt(): Promise<Attempt> {
    let settle!: (a: Attempt) => void;
    const answer = new Promise<Attempt>((resolve) => {
      settle = resolve;
    });
    const clock = setTimeout(() => settle({ kind: 'silent' }), this.timeout());
    let session: LiveSession | undefined;
    let finished = false;
    // Deliberately not awaited. A connect that neither opens nor fails would hold the probe past
    // the cooldown that bounds it, so the clock above is what ends every attempt; the session is
    // closed whenever it arrives, including after the clock has already run out.
    void this.deps.live
      .connect(
        { systemInstruction: PROBE_INSTRUCTION },
        { ...IGNORED, ready: () => settle({ kind: 'ready' }), closed: (reason) => settle({ kind: 'refused', reason }) },
      )
      .then(
        (s) => {
          if (finished) s.close();
          else session = s;
        },
        (err: Error) => settle({ kind: 'refused', reason: err.message }),
      );
    try {
      return await answer;
    } finally {
      finished = true;
      clearTimeout(clock);
      session?.close();
    }
  }
}

/** Seconds the breaker has been tripped, for the one line that says the service is back. */
function downFor(b: GatewayBreaker, now: Date): number {
  return Math.round((now.getTime() - Date.parse(b.since ?? b.updatedAt)) / 1000);
}
