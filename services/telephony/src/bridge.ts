import type { EmergencyLeg, Resident } from '@hachi/store';
import { scheduleRetry, type CallDeps } from './calls.js';
import { escapeXml, streamTwiml, TelephonyError } from './twilio.js';

/** Media streams per call: the first one plus reconnects after the gateway drops. */
export const MAX_STREAMS = 3;
export const ALERT_RING_TIMEOUT_SEC = 45;
export const EMERGENCY_TRANSFER_PATH = '/tasks/emergency-transfer';

export interface CallIds {
  residentId: string;
  callId: string;
}

const HANGUP = '<Response><Hangup/></Response>';

export function conferenceName(ids: CallIds): string {
  return `hachi-${ids.residentId}-${ids.callId}`;
}

function query(ids: CallIds): string {
  return `residentId=${encodeURIComponent(ids.residentId)}&callId=${encodeURIComponent(ids.callId)}`;
}

function say(deps: CallDeps, text: string): string {
  return `<Say voice="${escapeXml(deps.config.sayVoice)}" language="en-US">${escapeXml(text)}</Say>`;
}

/**
 * Twilio requests this when the Voice Gateway closes the media stream. The gateway records why
 * the conversation ended before closing, so this decides the next step:
 * emergency → bridge the resident into a conference with family and staff;
 * normal end → hang up; dropped stream → reconnect (a few times), then apologize and retry later.
 */
export async function afterStream(deps: CallDeps, ids: CallIds): Promise<string> {
  const call = await deps.store.getCall(ids.residentId, ids.callId);
  if (!call) return HANGUP;
  if (call.emergency) {
    return (
      '<Response><Dial><Conference startConferenceOnEnter="false" endConferenceOnExit="true" beep="false" ' +
      `waitUrl="${escapeXml(`${deps.config.publicBaseUrl}/twilio/hold`)}" waitMethod="POST">` +
      `${escapeXml(conferenceName(ids))}</Conference></Dial></Response>`
    );
  }
  const ended = call.conversation?.endedBy;
  if (ended && ended !== 'gateway_error') return HANGUP;

  if (deps.config.voiceStreamUrl && call.streamToken && (call.streams ?? 0) < MAX_STREAMS) {
    return streamTwiml({
      ...ids,
      streamUrl: deps.config.voiceStreamUrl,
      streamToken: call.streamToken,
      afterStreamUrl: `${deps.config.publicBaseUrl}/twilio/after-stream?${query(ids)}`,
    });
  }

  await deps.store.updateCall(ids.residentId, ids.callId, (c) => ({
    ...c,
    failure: { message: 'The conversation could not be continued (Voice Gateway unavailable)', retryable: true },
  }));
  if (call.attempt !== undefined && call.localDate) {
    await scheduleRetry(deps, { residentId: ids.residentId, localDate: call.localDate, attempt: call.attempt });
  }
  return `<Response>${say(deps, "I'm sorry, we're having a technical problem. We will call you back in a few minutes. Goodbye.")}<Hangup/></Response>`;
}

/** Played to the resident while family or staff are being reached. */
export function holdTwiml(deps: CallDeps): string {
  return (
    '<Response>' +
    say(deps, 'We are contacting your family and care staff right now. Please stay on the line. If you can, call one one nine for an ambulance.') +
    '<Pause length="15"/>' +
    `<Redirect method="POST">${escapeXml(`${deps.config.publicBaseUrl}/twilio/hold`)}</Redirect></Response>`
  );
}

export function emergencyTargets(r: Resident): Omit<EmergencyLeg, 'providerCallId' | 'error'>[] {
  const out: Omit<EmergencyLeg, 'providerCallId' | 'error'>[] = [];
  const add = (recipient: 'staff' | 'family', to: string | undefined) => {
    if (to && /^\+[1-9]\d{7,14}$/.test(to) && to !== r.phone && !out.some((t) => t.to === to)) out.push({ recipient, to });
  };
  add('family', r.family?.voice ?? r.family?.sms);
  add('staff', r.staff.voice ?? r.staff.phone);
  return out;
}

function alertTwiml(deps: CallDeps, r: Resident, ids: CallIds): string {
  const action = escapeXml(`${deps.config.publicBaseUrl}/twilio/alert-response?${query(ids)}`);
  const gather = (text: string) => `<Gather numDigits="1" timeout="8" action="${action}" method="POST">${say(deps, text)}</Gather>`;
  return (
    '<Response>' +
    gather(
      `This is an urgent call from Hachi, the daily check-in service for ${r.name}. ` +
        `During today's call, ${r.name} said something that suggests they may need help right now. ` +
        `Press 1 to be connected to ${r.name} now.`,
    ) +
    gather(`Press 1 to be connected to ${r.name}.`) +
    say(deps, `We could not connect you. Please call ${r.name} or emergency services as soon as possible. Goodbye.`) +
    '</Response>'
  );
}

export type TransferOutcome =
  | { outcome: 'skipped'; reason: 'no_emergency' | 'no_contacts' }
  | { outcome: 'placed'; legs: EmergencyLeg[] }
  | { outcome: 'retry_later'; legs: EmergencyLeg[] };

/**
 * Phones family and staff at the same time; whoever presses 1 joins the resident's conference.
 * Legs already placed are never dialed again when the task is retried.
 */
export async function emergencyTransfer(deps: CallDeps, ids: CallIds): Promise<TransferOutcome> {
  const [resident, call] = await Promise.all([deps.store.getResident(ids.residentId), deps.store.getCall(ids.residentId, ids.callId)]);
  if (!resident || !call?.emergency) return { outcome: 'skipped', reason: 'no_emergency' };
  const targets = emergencyTargets(resident);
  if (!targets.length) return { outcome: 'skipped', reason: 'no_contacts' };

  const placed = new Set((call.emergency.legs ?? []).filter((l) => l.providerCallId).map((l) => l.to));
  let retry = false;
  const results = await Promise.all(
    targets
      .filter((t) => !placed.has(t.to))
      .map(async (t): Promise<EmergencyLeg> => {
        try {
          const { providerCallId } = await deps.telephony.placeCall({
            to: t.to,
            from: deps.config.twilio.voiceFrom,
            twiml: alertTwiml(deps, resident, ids),
            ringTimeoutSec: ALERT_RING_TIMEOUT_SEC,
            maxCallSec: deps.config.maxCallSec,
          });
          return { ...t, providerCallId };
        } catch (err) {
          if (!(err instanceof TelephonyError) || err.retryable) retry = true;
          return { ...t, error: (err as Error).message };
        }
      }),
  );
  const updated = await deps.store.updateCall(ids.residentId, ids.callId, (c) => {
    const legs = [...(c.emergency!.legs ?? []).filter((l) => !results.some((r) => r.to === l.to)), ...results];
    return { ...c, emergency: { ...c.emergency!, legs } };
  });
  const legs = updated.emergency!.legs!;
  return retry ? { outcome: 'retry_later', legs } : { outcome: 'placed', legs };
}

/** Family or staff answered the alert call. */
export async function alertResponse(deps: CallDeps, ids: CallIds, digits: string | undefined): Promise<string> {
  const [resident, call] = await Promise.all([deps.store.getResident(ids.residentId), deps.store.getCall(ids.residentId, ids.callId)]);
  const name = resident?.name ?? 'the resident';
  if (digits !== '1') return `<Response>${say(deps, `Please call ${name} or emergency services as soon as possible. Goodbye.`)}<Hangup/></Response>`;
  if (!call || call.status !== 'in_progress') {
    return `<Response>${say(deps, `${name}'s call has already ended. Please call ${name} directly or call emergency services. Goodbye.`)}<Hangup/></Response>`;
  }
  return (
    `<Response>${say(deps, `Connecting you to ${name} now.`)}` +
    '<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">' +
    `${escapeXml(conferenceName(ids))}</Conference></Dial></Response>`
  );
}
