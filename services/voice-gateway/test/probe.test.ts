import { DEFAULT_GATEWAY_POLICY, gatewayVerdict, recordGatewayFailure } from '@hachi/core';
import { MemoryStore } from '@hachi/store';
import { describe, expect, it, vi } from 'vitest';
import { EmergencyPresence } from '../src/emergency.js';
import { GatewayProbe } from '../src/probe.js';
import type { LiveConnector, LiveHandlers, LiveSession, LiveSetup } from '../src/live.js';
import { recordingLog } from './fixtures.js';

const POLICY = DEFAULT_GATEWAY_POLICY;
const FAULT_AT = new Date('2026-10-08T09:21:00.000Z');
/** Verbatim from the production close the breaker and this probe both exist for. */
const SPEND_CAP =
  'closed: 1008 Spend cap breached for project: projects/871712096742 for service: aiplatform.googleapis.com. Correlation id: 8710404284673';

interface Opened {
  closed: boolean;
  audio: number;
  texts: number;
}

class ProbeLive implements LiveConnector {
  readonly setups: LiveSetup[] = [];
  readonly opened: Opened[] = [];
  /** What Vertex AI does with the session. `hang` is a connect that neither opens nor fails. */
  behaviour: 'ready' | 'refuse' | 'silent' | 'throw' | 'hang' = 'ready';

  async connect(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveSession> {
    this.setups.push(setup);
    if (this.behaviour === 'throw') throw new Error(SPEND_CAP);
    if (this.behaviour === 'hang') return new Promise<LiveSession>(() => {});
    const o: Opened = { closed: false, audio: 0, texts: 0 };
    this.opened.push(o);
    // Both answers arrive after connect resolves, which is how the spend cap arrived in production:
    // the websocket opened perfectly and the server closed it a moment later.
    if (this.behaviour === 'ready') setTimeout(() => handlers.ready?.(), 0);
    if (this.behaviour === 'refuse') setTimeout(() => handlers.closed(SPEND_CAP), 0);
    return {
      sendAudio: () => o.audio++,
      sendText: () => o.texts++,
      respondToTool: () => {},
      close: () => {
        o.closed = true;
      },
      drop: () => {},
    };
  }
}

function make() {
  const store = new MemoryStore();
  const live = new ProbeLive();
  const emergencies = new EmergencyPresence();
  const logged = recordingLog();
  const clock = { now: new Date(FAULT_AT.getTime() + POLICY.cooldownMs) };
  const probe = new GatewayProbe({
    store,
    live,
    emergencies,
    policy: POLICY,
    log: logged.log,
    now: () => clock.now,
    timeoutMs: 20,
  });
  return { store, live, emergencies, probe, clock, logged: logged.lines };
}

const trip = (store: MemoryStore, reason = SPEND_CAP) => store.mutateGatewayBreaker((b) => recordGatewayFailure(b, reason, FAULT_AT));

describe('the gateway probe', () => {
  it('opens nothing while nothing is known to be wrong', async () => {
    const { probe, live, store } = make();
    expect(await probe.run()).toEqual({ outcome: 'skipped', reason: 'not_due' });
    // A service that is working must not be billed for asking whether it is working.
    expect(live.setups).toHaveLength(0);
    expect(await store.getGatewayBreaker()).toBeNull();
  });

  it('opens nothing for a single dropped socket, which has not stopped any calls', async () => {
    const { probe, live, store } = make();
    await trip(store, 'closed: 1006');
    expect(await probe.run()).toEqual({ outcome: 'skipped', reason: 'not_due' });
    expect(live.setups).toHaveLength(0);
  });

  it('never fires while somebody is being reached', async () => {
    const { probe, live, store, emergencies } = make();
    await trip(store);
    emergencies.enter();
    expect(await probe.run()).toEqual({ outcome: 'skipped', reason: 'emergency' });
    expect(live.setups).toHaveLength(0);
    // Nothing is claimed either, so the cooldown is not spent on an attempt that never happened
    // and the fault is tested the moment the emergency is over.
    expect((await store.getGatewayBreaker())!.probedAt).toBeUndefined();
    emergencies.leave();
    expect(await probe.run()).toEqual({ outcome: 'recovered' });
  });

  it('opens one session per cooldown however often it is asked', async () => {
    const { probe, live, store, clock } = make();
    await trip(store);
    live.behaviour = 'refuse';
    for (let i = 0; i < 10; i++) await probe.run();
    expect(live.setups).toHaveLength(1);
    clock.now = new Date(clock.now.getTime() + POLICY.cooldownMs);
    for (let i = 0; i < 10; i++) await probe.run();
    expect(live.setups).toHaveLength(2);
  });

  it('opens one session between every instance that shares the breaker', async () => {
    const store = new MemoryStore();
    await trip(store);
    const logged = recordingLog();
    const now = () => new Date(FAULT_AT.getTime() + POLICY.cooldownMs);
    const instances = [new ProbeLive(), new ProbeLive(), new ProbeLive()].map((live) => ({
      live,
      probe: new GatewayProbe({ store, live, emergencies: new EmergencyPresence(), policy: POLICY, log: logged.log, now, timeoutMs: 20 }),
    }));
    // Every instance's clock says the cooldown is over, because it is. The claim is in the same
    // transaction as the read, which is the only reason this is one session and not three.
    await Promise.all(instances.map((i) => i.probe.run()));
    expect(instances.reduce((n, i) => n + i.live.setups.length, 0)).toBe(1);
  });

  it('lets the check-in calls start again when the API accepts a session', async () => {
    const { probe, store, clock } = make();
    await trip(store);
    expect(await probe.run()).toEqual({ outcome: 'recovered' });
    const b = await store.getGatewayBreaker();
    expect(b).toMatchObject({ failures: 0 });
    expect(b!.fault).toBeUndefined();
    expect(gatewayVerdict(b, clock.now, POLICY)).toBe('working');
  });

  it('hangs up the moment the server is ready, and says nothing into it', async () => {
    const { probe, live, store } = make();
    await trip(store);
    await probe.run();
    expect(live.opened[0]).toEqual({ closed: true, audio: 0, texts: 0 });
  });

  it('carries nothing about a resident into a session opened to test an API', async () => {
    const { probe, live, store } = make();
    await trip(store);
    await probe.run();
    expect(live.setups[0]!.systemInstruction).toBe('Connection test. Do not speak.');
    expect(live.setups[0]!.resumeHandle).toBeUndefined();
  });
});

describe('the gateway probe when the fault is still there', () => {
  it('keeps the calls stopped and records what Vertex AI said', async () => {
    const { probe, live, store, clock } = make();
    await trip(store);
    live.behaviour = 'refuse';
    expect(await probe.run()).toEqual({ outcome: 'still_down', reason: SPEND_CAP });
    const b = (await store.getGatewayBreaker())!;
    expect(b).toMatchObject({ failures: 2, fault: 'systemic' });
    expect(b.reason).toContain('Spend cap breached');
    // Proof that something is still testing, which is what keeps telephony from spending a
    // resident's call on the same question.
    expect(b.probedAt).toBe(clock.now.toISOString());
    expect(gatewayVerdict(b, clock.now, POLICY)).toBe('down');
  });

  it('reads a connect that threw the same way as a close', async () => {
    const { probe, live, store } = make();
    await trip(store);
    live.behaviour = 'throw';
    expect(await probe.run()).toEqual({ outcome: 'still_down', reason: SPEND_CAP });
    expect((await store.getGatewayBreaker())!.failures).toBe(2);
  });

  it('writes nothing when the server neither accepts nor refuses', async () => {
    const { probe, live, store, clock } = make();
    await trip(store);
    live.behaviour = 'silent';
    expect(await probe.run()).toEqual({ outcome: 'inconclusive' });
    const b = (await store.getGatewayBreaker())!;
    // Replacing the close reason with ours would cost staff the one line they can act on, and a
    // probe that got no answer has not learned anything to replace it with.
    expect(b).toMatchObject({ failures: 1, reason: SPEND_CAP });
    expect(b.probedAt).toBe(clock.now.toISOString());
    expect(live.opened[0]!.closed).toBe(true);
  });

  it('does not hold the cooldown open on a connect that never answers at all', async () => {
    const { probe, live, store, clock } = make();
    await trip(store);
    live.behaviour = 'hang';
    expect(await probe.run()).toEqual({ outcome: 'inconclusive' });
    expect((await store.getGatewayBreaker())!.probedAt).toBe(clock.now.toISOString());
  });
});

describe('the gateway probe on its own timer', () => {
  it('looks without being asked, and stops when told', async () => {
    const { probe, live, store, clock } = make();
    await trip(store);
    live.behaviour = 'refuse';
    vi.useFakeTimers();
    try {
      probe.start();
      // The tick is a minute and the cooldown is fifteen, so the cooldown is what decides how many
      // of these turn into a session. The extra milliseconds let the refusal land before the next.
      const tick = async () => {
        clock.now = new Date(clock.now.getTime() + POLICY.cooldownMs);
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(10);
      };
      for (let n = 0; n < 3; n++) await tick();
      expect(live.setups).toHaveLength(3);
      probe.stop();
      await tick();
      expect(live.setups).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
