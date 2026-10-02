import type { CaseChange } from './cases.js';
import { RULE_NAMES } from './priority.js';
import type { Contact, ContactChannel, Locale } from './types.js';
import { URGENCY_LABELS, type Urgency } from './urgency.js';

export interface NotificationContext {
  residentName: string;
  /** How the resident is addressed, used in messages to family. */
  preferredName: string;
  staff: Contact;
  family?: Contact;
  caseUrl: string;
  dashboardUrl: string;
  staffPhone: string;
  locale: Locale;
}

export interface OutboxMessage {
  /** Deterministic key so retries and duplicate triggers never send twice. */
  idempotencyKey: string;
  caseId: string;
  urgency: Urgency;
  recipient: 'staff' | 'family';
  channel: ContactChannel;
  /** Phone number, email address, or FCM token. */
  address: string;
  subject: string;
  body: string;
  /** Emergency messages are sent immediately rather than through the regular queue (NTF-01). */
  priority: 'immediate' | 'normal';
}

const NOTIFY_ON: Record<Urgency, { staff: boolean; family: boolean }> = {
  emergency: { staff: true, family: true },
  urgent: { staff: true, family: false },
  action: { staff: false, family: false },
  watch: { staff: false, family: false },
};

function addresses(contact: Contact, includeVoice: boolean): { channel: ContactChannel; address: string }[] {
  const out: { channel: ContactChannel; address: string }[] = [];
  if (contact.sms) out.push({ channel: 'sms', address: contact.sms });
  if (contact.email) out.push({ channel: 'email', address: contact.email });
  for (const token of contact.pushTokens ?? []) out.push({ channel: 'push', address: token });
  if (includeVoice && contact.voice) out.push({ channel: 'voice', address: contact.voice });
  return out;
}

function staffMessage(change: CaseChange, ctx: NotificationContext): { subject: string; body: string } {
  const label = URGENCY_LABELS[ctx.locale][change.to];
  const rule = RULE_NAMES[ctx.locale][change.detection.rule];
  if (ctx.locale === 'ja') {
    return {
      subject: `【Hachi ${label}】${ctx.residentName}さん：${rule}`,
      body: `【Hachi ${label}】${ctx.residentName}さん\n${rule}：${change.detection.summary}\nケース：${ctx.caseUrl}`,
    };
  }
  return {
    subject: `[Hachi ${label}] ${ctx.residentName}: ${rule}`,
    body: `[Hachi ${label}] ${ctx.residentName}\n${rule}: ${change.detection.summary}\nCase: ${ctx.caseUrl}`,
  };
}

/** FAM-03: family messages carry only the plain summary, never transcript quotes. */
function familyMessage(change: CaseChange, ctx: NotificationContext): { subject: string; body: string } {
  const summary = change.detection.summary;
  if (ctx.locale === 'ja') {
    return {
      subject: `【Hachi 緊急】${ctx.preferredName}さんの体調について`,
      body:
        `【Hachi 緊急】${ctx.preferredName}さんとの通話で、体調の急な異変の訴えがありました。\n` +
        `状況：${summary}\n` +
        `すぐに${ctx.preferredName}さんへご連絡ください。\n` +
        `担当職員：${ctx.staff.name}（${ctx.staffPhone}）\n` +
        `詳しくはこちら：${ctx.dashboardUrl}`,
    };
  }
  return {
    subject: `[Hachi Emergency] About ${ctx.preferredName}`,
    body:
      `[Hachi Emergency] During today's call, ${ctx.preferredName} reported sudden symptoms.\n` +
      `What we heard: ${summary}\n` +
      `Please contact ${ctx.preferredName} right away.\n` +
      `Care staff: ${ctx.staff.name} (${ctx.staffPhone})\n` +
      `Details: ${ctx.dashboardUrl}`,
  };
}

/**
 * NTF-01 / NTF-02 / NTF-03: decides who is notified on which channels for a case change.
 * Only new cases and escalations notify; plain updates do not.
 */
export function planNotifications(change: CaseChange, ctx: NotificationContext): OutboxMessage[] {
  if (change.type === 'updated') return [];
  const policy = NOTIFY_ON[change.to];
  const priority = change.to === 'emergency' ? 'immediate' : 'normal';
  const out: OutboxMessage[] = [];
  const push = (recipient: 'staff' | 'family', contact: Contact, msg: { subject: string; body: string }, voice: boolean) => {
    for (const { channel, address } of addresses(contact, voice)) {
      out.push({
        idempotencyKey: `${change.caseId}:${change.to}:${recipient}:${channel}:${address}`,
        caseId: change.caseId,
        urgency: change.to,
        recipient,
        channel,
        address,
        ...msg,
        priority,
      });
    }
  };
  if (policy.staff) push('staff', ctx.staff, staffMessage(change, ctx), change.to === 'emergency');
  if (policy.family && ctx.family) push('family', ctx.family, familyMessage(change, ctx), true);
  return out;
}
