/**
 * Passing on a resident's request for someone to ring them.
 *
 * The daily call is short on purpose. Keeping an older adult company costs real money per minute,
 * and an AI is the wrong thing to be keeping them company with: the people who would miss them are
 * the point. So when the resident wants more of a conversation than a check-in, Hachi does not try
 * to become the conversation. It offers to tell someone, and then gets out of the way.
 */

import { addressDigest, fitSms, type OutboxMessage } from './notifications.js';

/** What the resident asked for, in their own words. */
export interface ContactRequest {
  /** How they referred to the person: "my daughter", "Mary next door". */
  who: string;
  /** E.164, only when they read a number out and it was heard in their own words. */
  number?: string;
  /** Whether Hachi read the number back to them and they agreed it was right. */
  confirmed: boolean;
  /** Index of the resident turn it was heard in. */
  turn: number;
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/**
 * A multiplier is one word standing for a number of digits, and mishearing it shifts the whole
 * number. There is no safe reading, so a number spoken with one is not read at all.
 */
const MULTIPLIER = /\b(double|triple)\b/i;

interface DigitRun {
  digits: string;
  /** The resident said the number in international form. */
  international: boolean;
}

/**
 * The runs of digits in an utterance. A speech model writes a dictated phone number partly as
 * figures and partly as words, in one breath, so both count; any other word ends the run.
 */
export function digitRuns(text: string): DigitRun[] {
  const runs: DigitRun[] = [];
  let current: DigitRun | null = null;
  for (const [token] of text.toLowerCase().matchAll(/\+?\d+|[a-z]+/g)) {
    const figures = /\d/.test(token);
    const digits = figures ? token.replace(/\D/g, '') : DIGIT_WORDS[token];
    if (digits === undefined) {
      current = null;
      continue;
    }
    if (current) current.digits += digits;
    else runs.push((current = { digits, international: token.startsWith('+') }));
  }
  return runs;
}

/**
 * 11 digits for a mobile (070, 080, 090), 10 for a landline. A landline cannot carry a mobile
 * prefix, so a ten-digit 090 is a dropped digit and not a number to dial.
 */
const JP_DOMESTIC = /^0(?:[789]0\d{8}|(?![789]0)[1-9]\d{8})$/;

export function toE164(run: DigitRun): string | null {
  if (run.international) return /^[1-9]\d{7,14}$/.test(run.digits) ? `+${run.digits}` : null;
  return JP_DOMESTIC.test(run.digits) ? `+81${run.digits.slice(1)}` : null;
}

/**
 * The one number in what the resident said, or null. Two different numbers in one utterance is a
 * transcript we cannot read, and a number is not something to pick the likeliest reading of.
 */
export function parseSpokenNumber(text: string): string | null {
  if (MULTIPLIER.test(text)) return null;
  const found = [...new Set(digitRuns(text).flatMap((r) => toE164(r) ?? []))];
  return found.length === 1 ? found[0]! : null;
}

export interface ContactRecord {
  name: string;
  relationship?: string;
  sms?: string;
}

/** Whether the person the resident named is the contact we already hold. */
export function matchesContact(contact: ContactRecord, who: string): boolean {
  const said = who.toLowerCase();
  // Short words match too much: a "Jo" in "my neighbour" is not a name.
  const parts = contact.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  if (parts.some((w) => said.includes(w))) return true;
  const rel = contact.relationship?.toLowerCase();
  return Boolean(rel && rel.length > 2 && said.includes(rel));
}

export interface ContactRequestContext {
  callId: string;
  /** How the resident is addressed. A message to someone outside the service carries no more than that. */
  preferredName: string;
  family?: ContactRecord;
}

export interface ContactRequestPlan {
  message: OutboxMessage;
  /**
   * One misheard digit sends the resident's name and the fact that they are alone to a stranger,
   * so a number that did not come from the contacts we hold waits for a person to agree to it.
   */
  needsApproval: boolean;
}

export function contactRequestKey(callId: string, address: string): string {
  return `contact:${callId}:${addressDigest(address)}`;
}

/**
 * Japanese carriers drop an overseas SMS that contains a link or a phone number, so this carries
 * neither, and it says nothing about the resident's health: it is an invitation to ring, not a
 * report. The recipient may never have heard of Hachi, so the message says what Hachi is.
 */
export function contactRequestSms(preferredName: string): string {
  return fitSms(
    '[Hachi] ',
    `${preferredName} would like a phone call from you when you have a moment.`,
    ' Hachi is their daily check-in service. This is not an emergency.',
    false,
  );
}

/**
 * Who to text, and whether a person has to agree first. Returns null when there is no one to
 * text, which leaves the request on the call for staff to see and act on themselves.
 */
export function planContactRequest(req: ContactRequest, ctx: ContactRequestContext): ContactRequestPlan | null {
  const known = ctx.family?.sms && matchesContact(ctx.family, req.who) ? ctx.family.sms : undefined;
  // A number they read out is only used once they have heard it back and agreed.
  const spoken = req.confirmed ? req.number : undefined;
  const address = known ?? spoken;
  if (!address) return null;
  const registered = address === ctx.family?.sms;
  const body = contactRequestSms(ctx.preferredName);
  return {
    needsApproval: !registered,
    message: {
      idempotencyKey: contactRequestKey(ctx.callId, address),
      caseId: ctx.callId,
      kind: 'contact_request',
      urgency: 'watch',
      recipient: registered ? 'family' : 'contact',
      channel: 'sms',
      address,
      subject: `${ctx.preferredName} would like a phone call`,
      body,
      priority: 'normal',
    },
  };
}
