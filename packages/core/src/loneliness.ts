/**
 * Whether a resident is becoming lonely, and whether that is something to tell their family.
 *
 * Loneliness is measured with the three-item UCLA scale (Hughes, Waite, Hawkley & Cacioppo 2004),
 * asked in its own words across one rotation, and nothing else moves that score: a cutoff means
 * what it means because of how the questions were asked. What the resident says in ordinary
 * conversation is reported next to it, and stands on its own only while the scale is incomplete,
 * which is most of a resident's first fortnight.
 *
 * None of this is a diagnosis. A three-item screen says "worth a proper look", and that is all
 * this says.
 */

import { fitSms, type OutboxMessage } from './notifications.js';
import { CYCLE_DAYS, scoreInstrument, type InstrumentScore, type ItemAnswer } from './screening.js';

/** Tags that say the resident is on their own, as against low in mood, which is a separate thing. */
export const LONELINESS_TAGS: readonly string[] = ['mood.lonely', 'social.no_contact', 'social.missed_group'];

export interface CallSignal {
  /** Resident-local date of the call. */
  date: string;
  tagIds: readonly string[];
  /** The resident asked Hachi to tell someone they would like a phone call. */
  askedForContact?: boolean;
}

export type LonelinessStatus =
  /** Too few answers to say anything with the scale. */
  | 'incomplete'
  | 'settled'
  | 'lonely'
  /** Not lonely by the scale a rotation ago, and lonely now. */
  | 'worsening';

export interface LonelinessAssessment {
  status: LonelinessStatus;
  /** The scale as it stands, and as it stood one rotation ago. */
  current: InstrumentScore;
  previous: InstrumentScore;
  /** Calls looked at, and how many carried a sign of being on their own. */
  calls: number;
  callsWithSignal: number;
  /** Times in the window the resident asked for someone to ring them. */
  contactRequests: number;
  /**
   * Loneliness in the resident's own conversation, which is the only thing there is to go on until
   * the scale has been round once.
   */
  heardInCalls: boolean;
  /** For staff, in plain words and without a score, because a score invites being read as a result. */
  summary: string;
}

/** Calls read for signs of being alone. One rotation, so it lines up with the scale. */
export const SIGNAL_WINDOW_DAYS = CYCLE_DAYS;

/** One mention is a bad evening. Two in a fortnight is a pattern worth someone knowing about. */
export const MIN_SIGNAL_CALLS = 2;

/** A climb this far inside one rotation is a change, not the wobble of a three-point scale. */
export const RISE_IS_WORSE = 2;

const DAY_MS = 86_400_000;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function summarize(a: Omit<LonelinessAssessment, 'summary'>): string {
  const heard = a.callsWithSignal
    ? ` Said they were on their own in ${a.callsWithSignal} of the last ${a.calls} calls.`
    : '';
  const asked = a.contactRequests ? ` Asked for someone to ring them ${a.contactRequests > 1 ? `${a.contactRequests} times` : 'once'}.` : '';
  const scale = {
    incomplete: `Loneliness screen answered ${a.current.answered} of ${a.current.of}, so it cannot be read yet.`,
    settled: 'Loneliness screen is below its cutoff.',
    lonely: 'Loneliness screen is at or above its cutoff; worth a proper assessment.',
    worsening: 'Loneliness screen has crossed its cutoff since the last rotation; worth a proper assessment.',
  }[a.status];
  return `${scale}${heard}${asked}`;
}

export function assessLoneliness(answers: readonly ItemAnswer[], calls: readonly CallSignal[], asOf: string): LonelinessAssessment {
  const current = scoreInstrument('ULS-3', answers, asOf);
  const previous = scoreInstrument('ULS-3', answers, shiftDate(asOf, -CYCLE_DAYS));
  const since = shiftDate(asOf, -SIGNAL_WINDOW_DAYS);
  const window = calls.filter((c) => c.date > since && c.date <= asOf);
  const callsWithSignal = window.filter((c) => c.tagIds.some((t) => LONELINESS_TAGS.includes(t))).length;
  const contactRequests = window.filter((c) => c.askedForContact).length;
  const heardInCalls = callsWithSignal >= MIN_SIGNAL_CALLS || contactRequests > 0;

  let status: LonelinessStatus;
  if (current.positive === null) status = 'incomplete';
  else if (!current.positive) status = 'settled';
  else if (previous.positive === false || (previous.positive !== null && current.score - previous.score >= RISE_IS_WORSE)) status = 'worsening';
  else status = 'lonely';

  const without = { status, current, previous, calls: window.length, callsWithSignal, contactRequests, heardInCalls };
  return { ...without, summary: summarize(without) };
}

/**
 * Whether this is news. A family told every rotation that their mother is still lonely stops
 * reading the messages, so they hear it when it changes: the first time the scale can be read,
 * and again whenever it crosses the cutoff.
 */
export function isNewsForFamily(a: LonelinessAssessment): boolean {
  return a.status === 'worsening' || (a.status === 'lonely' && a.previous.positive === null);
}

export interface LonelinessNoticeContext {
  residentId: string;
  preferredName: string;
  /** Rotation the notice belongs to, so one rotation can only produce one message. */
  cycleStart: string;
  dashboardUrl: string;
}

export function lonelinessKey(residentId: string, cycleStart: string): string {
  return `lonely:${residentId}:${cycleStart}`;
}

/**
 * What family is told: that more company would be welcome, and nothing else. No score, no
 * instrument, no quotes from the call. A family member is not being asked to assess anyone; they
 * are being told that a phone call would land well.
 */
export function lonelinessNotice(name: string, dashboardUrl: string, channel: 'sms' | 'email'): { subject: string; body: string } {
  const subject = `${name} would welcome more company`;
  if (channel === 'sms') {
    return {
      subject,
      body: fitSms('[Hachi] ', `${name} would welcome more company just now. A phone call from you would mean a lot.`, ' Hachi is the daily check-in service.', false),
    };
  }
  return {
    subject: `[Hachi] ${subject}`,
    body:
      `Over the last couple of weeks ${name} has been saying, in the daily check-in calls, that more company would be welcome.\n\n` +
      `Nothing is wrong and this is not a medical alert. A phone call or a visit from you would mean a lot.\n\n` +
      `What ${name} has been up to: ${dashboardUrl}`,
  };
}

/** The messages that tell family, on every channel we hold for them. */
export function planLonelinessNotice(
  ctx: LonelinessNoticeContext,
  family: { sms?: string; email?: string },
): OutboxMessage[] {
  const channels: ('sms' | 'email')[] = [];
  if (family.sms) channels.push('sms');
  if (family.email) channels.push('email');
  return channels.map((channel) => ({
    idempotencyKey: `${lonelinessKey(ctx.residentId, ctx.cycleStart)}:${channel}`,
    caseId: lonelinessKey(ctx.residentId, ctx.cycleStart),
    kind: 'loneliness' as const,
    urgency: 'watch' as const,
    recipient: 'family' as const,
    channel,
    address: (channel === 'sms' ? family.sms : family.email)!,
    ...lonelinessNotice(ctx.preferredName, ctx.dashboardUrl, channel),
    priority: 'normal' as const,
  }));
}
