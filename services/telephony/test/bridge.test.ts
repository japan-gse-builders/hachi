import { recordGatewayFailure } from '@hachi/core';
import type { CallRecord } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { afterStream, alertResponse, conferenceName, emergencyTargets, emergencyTransfer, holdTwiml } from '../src/bridge.js';
import { BASE_URL, makeDeps, NOW, resident, retryable, unverified } from './fixtures.js';

const IDS = { residentId: 'res-1', callId: '2026-10-02-0' };
const FAMILY = { name: 'Alice', sms: '+819000000002' };

function callDoc(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: IDS.callId,
    residentId: IDS.residentId,
    source: 'live',
    status: 'in_progress',
    channel: 'pstn',
    startedAt: NOW.toISOString(),
    analysisPending: false,
    createdAt: NOW.toISOString(),
    attempt: 0,
    localDate: '2026-10-02',
    providerCallId: 'CA1',
    streamToken: 'stream-secret',
    streams: 1,
    ...overrides,
  };
}

const EMERGENCY = { at: NOW.toISOString(), caseId: 'case-1', quote: 'My chest hurts' };

async function setup(call: Partial<CallRecord> = {}, opts: { stream?: boolean } = { stream: true }) {
  const ctx = makeDeps(opts.stream ? { voiceStreamUrl: 'wss://gw.example/twilio/stream' } : {});
  await ctx.store.createResident(resident('res-1', { family: FAMILY }));
  await ctx.store.createCallIfAbsent(callDoc(call));
  return ctx;
}

describe('afterStream', () => {
  it('hangs up for unknown calls and after a normal goodbye', async () => {
    const { deps } = await setup({ conversation: { endedBy: 'agent', at: NOW.toISOString() } });
    expect(await afterStream(deps, { residentId: 'res-1', callId: 'nope' })).toBe('<Response><Hangup/></Response>');
    expect(await afterStream(deps, IDS)).toBe('<Response><Hangup/></Response>');
  });

  it('bridges the resident into the emergency conference', async () => {
    const { deps } = await setup({ emergency: EMERGENCY, conversation: { endedBy: 'emergency', at: NOW.toISOString() } });
    const xml = await afterStream(deps, IDS);
    expect(xml).toContain(`<Conference startConferenceOnEnter="false" endConferenceOnExit="true"`);
    expect(xml).toContain(`waitUrl="${BASE_URL}/twilio/hold"`);
    expect(xml).toContain(`>${conferenceName(IDS)}</Conference>`);
  });

  it('reconnects the media stream when it dropped unexpectedly', async () => {
    const { deps } = await setup({ conversation: { endedBy: 'gateway_error', at: NOW.toISOString() } });
    const xml = await afterStream(deps, IDS);
    expect(xml).toContain('<Stream url="wss://gw.example/twilio/stream">');
    expect(xml).toContain('<Parameter name="streamToken" value="stream-secret"/>');
    expect(xml).toContain('/twilio/after-stream?residentId=res-1&amp;callId=2026-10-02-0');
  });

  it('apologizes and schedules a retry once reconnects are exhausted', async () => {
    const { deps, store, queue } = await setup({ streams: 3 });
    const xml = await afterStream(deps, IDS);
    expect(xml).toContain('technical problem');
    expect(xml).toContain('<Hangup/>');
    expect((await store.getCall('res-1', IDS.callId))!.failure).toMatchObject({ retryable: true });
    expect(queue.tasks.map((t) => t.name)).toEqual(['call-res-1-2026-10-02-1']);
  });

  it('apologizes without a gateway configured, and skips the retry for imported calls', async () => {
    const { deps, queue } = await setup({ attempt: undefined }, { stream: false });
    expect(await afterStream(deps, IDS)).toContain('technical problem');
    expect(queue.tasks).toHaveLength(0);
  });
});

describe('afterStream when the gateway is known to be broken', () => {
  const SPEND_CAP = 'closed: 1008 Spend cap breached for project: projects/871712096742 for service: aiplatform.googleapis.com';

  const broken = async (call: Partial<CallRecord> = {}) => {
    const ctx = await setup({ conversation: { endedBy: 'gateway_error', at: NOW.toISOString() }, ...call });
    await ctx.store.mutateGatewayBreaker((b) => recordGatewayFailure(b, SPEND_CAP, NOW));
    return ctx;
  };

  it('does not reopen the media stream into the same fault', async () => {
    const { deps } = await broken();
    const xml = await afterStream(deps, IDS);
    expect(xml).not.toContain('<Stream');
    expect(xml).toContain('<Hangup/>');
  });

  it('does not ring the resident back, and does not promise to', async () => {
    const { deps, store, queue } = await broken();
    const xml = await afterStream(deps, IDS);
    // Nothing is going to fix this in a few minutes, so nothing may say so. The resident cannot
    // tell a promise we will not keep from a real emergency callback.
    expect(xml).not.toContain('call you back');
    expect(xml).toContain('our system isn&apos;t working at the moment');
    expect(xml).toContain('care team can see');
    expect(queue.tasks).toHaveLength(0);
    expect((await store.getCall('res-1', IDS.callId))!.failure).toMatchObject({ code: 'gateway_unavailable', retryable: false });
  });

  it('still bridges an emergency into the conference', async () => {
    // Checked here as well as in placeCall, because this is the path a resident who is already on
    // the phone takes, and it is decided before the breaker is ever consulted.
    const { deps } = await broken({ emergency: EMERGENCY, conversation: { endedBy: 'emergency', at: NOW.toISOString() } });
    expect(await afterStream(deps, IDS)).toContain(`>${conferenceName(IDS)}</Conference>`);
  });

  it('reconnects again once the cooldown lets a call through', async () => {
    const { deps, clock } = await broken();
    clock.now = new Date(NOW.getTime() + deps.config.gateway.cooldownMs);
    expect(await afterStream(deps, IDS)).toContain('<Stream url="wss://gw.example/twilio/stream">');
  });
});

describe('holdTwiml', () => {
  it('reassures the resident and loops', () => {
    const { deps } = makeDeps();
    const xml = holdTwiml(deps);
    expect(xml).toContain('one one nine');
    expect(xml).toContain(`<Redirect method="POST">${BASE_URL}/twilio/hold</Redirect>`);
  });
});

describe('emergencyTargets', () => {
  it('prefers voice numbers, skips invalid, duplicate and the resident’s own number', () => {
    expect(emergencyTargets(resident('r', { family: { name: 'A', sms: '+819000000002', voice: '+819000000003' } }))).toEqual([
      { recipient: 'family', to: '+819000000003' },
      { recipient: 'staff', to: '+81300000000' },
    ]);
    expect(emergencyTargets(resident('r', { family: { name: 'A', sms: '+81300000000' } }))).toEqual([{ recipient: 'family', to: '+81300000000' }]);
    expect(emergencyTargets(resident('r', { family: { name: 'A', sms: '+819000000001' }, staff: { name: 'S', phone: 'n/a' } }))).toEqual([]);
  });
});

describe('emergencyTransfer', () => {
  it('skips calls without an emergency or without reachable contacts', async () => {
    const { deps, store } = await setup();
    expect(await emergencyTransfer(deps, IDS)).toEqual({ outcome: 'skipped', reason: 'no_emergency' });
    await store.updateResident('res-1', (r) => ({ ...r, family: undefined, staff: { ...r.staff, phone: r.phone } }));
    await store.updateCall('res-1', IDS.callId, (c) => ({ ...c, emergency: EMERGENCY }));
    expect(await emergencyTransfer(deps, IDS)).toEqual({ outcome: 'skipped', reason: 'no_contacts' });
  });

  it('phones family and staff at the same time with a press-1 prompt', async () => {
    const { deps, store, telephony } = await setup({ emergency: EMERGENCY });
    const r = await emergencyTransfer(deps, IDS);
    expect(r.outcome).toBe('placed');
    expect(telephony.calls.map((c) => c.to)).toEqual(['+819000000002', '+81300000000']);
    const alert = telephony.calls[0]!;
    expect(alert).toMatchObject({ from: '+15005550006', ringTimeoutSec: 45 });
    expect(alert.statusCallbackUrl).toBeUndefined();
    expect(alert.twiml).toContain(`action="${BASE_URL}/twilio/alert-response?residentId=res-1&amp;callId=2026-10-02-0"`);
    expect(alert.twiml).toContain('Press 1 to be connected to Margaret Smith now.');
    expect(alert.twiml).not.toContain('Maggie');
    expect(alert.twiml).not.toContain('chest');
    expect((await store.getCall('res-1', IDS.callId))!.emergency!.legs).toEqual([
      { recipient: 'family', to: '+819000000002', providerCallId: expect.stringMatching(/^CA/) },
      { recipient: 'staff', to: '+81300000000', providerCallId: expect.stringMatching(/^CA/) },
    ]);
  });

  it('retries only the legs that failed temporarily', async () => {
    const { deps, telephony } = await setup({ emergency: EMERGENCY });
    let n = 0;
    telephony.next = async () => (++n === 2 ? Promise.reject(retryable()) : { providerCallId: `CA${n}` });
    const first = await emergencyTransfer(deps, IDS);
    expect(first.outcome).toBe('retry_later');
    telephony.next = null;
    const second = await emergencyTransfer(deps, IDS);
    expect(second.outcome).toBe('placed');
    expect(telephony.calls.map((c) => c.to)).toEqual(['+819000000002', '+81300000000', '+81300000000']);
    expect(second.outcome === 'placed' && second.legs.every((l) => l.providerCallId && !l.error)).toBe(true);
  });

  it('records permanent failures without retrying', async () => {
    const { deps, telephony } = await setup({ emergency: EMERGENCY });
    telephony.failWith(unverified());
    const r = await emergencyTransfer(deps, IDS);
    expect(r.outcome).toBe('placed');
    expect(r.outcome === 'placed' && r.legs.every((l) => l.error?.includes('unverified'))).toBe(true);
  });
});

describe('alertResponse', () => {
  it('joins the conference when 1 is pressed during the call', async () => {
    const { deps } = await setup({ emergency: EMERGENCY });
    const xml = await alertResponse(deps, IDS, '1');
    expect(xml).toContain('Connecting you to Margaret Smith now.');
    expect(xml).toContain(`<Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${conferenceName(IDS)}</Conference>`);
  });

  it('explains when the resident already hung up', async () => {
    const { deps } = await setup({ emergency: EMERGENCY, status: 'completed' });
    expect(await alertResponse(deps, IDS, '1')).toContain('Margaret Smith&apos;s call has already ended');
    expect(await alertResponse(deps, { residentId: 'x', callId: 'y' }, '1')).toContain('the resident&apos;s call has already ended');
  });

  it('says goodbye for other keys', async () => {
    const { deps } = await setup({ emergency: EMERGENCY });
    expect(await alertResponse(deps, IDS, '5')).toContain('Please call Margaret Smith or emergency services');
    expect(await alertResponse(deps, IDS, undefined)).toContain('<Hangup/>');
  });
});
