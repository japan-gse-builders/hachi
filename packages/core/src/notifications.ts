import { createHash } from 'node:crypto';
import type { CaseChange } from './cases.js';
import { RULE_NAMES } from './priority.js';
import type { Contact, ContactChannel, DeliveryReport, DeliveryStatus, Locale } from './types.js';
import { URGENCY_LABELS, type Urgency } from './urgency.js';

export interface NotificationContext {
  /** Not preferredName: that is how Hachi greets the resident and can be "there". */
  residentName: string;
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

/** Idempotency keys are stored and logged, so they carry a digest of the address, never the address. */
export function addressDigest(address: string): string {
  return createHash('sha256').update(address).digest('hex').slice(0, 32);
}

export function notificationKey(caseId: string, urgency: Urgency, recipient: 'staff' | 'family', channel: ContactChannel, address: string): string {
  return `${caseId}:${urgency}:${recipient}:${channel}:${addressDigest(address)}`;
}

/** Reports can arrive late or out of order; a status never moves back, and the first final one wins. */
const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  sending: 1,
  ringing: 1,
  sent: 2,
  delivered: 3,
  answered: 3,
  undelivered: 3,
  failed: 3,
  no_answer: 3,
  busy: 3,
  canceled: 3,
};

export function mergeDelivery(current: DeliveryReport | undefined, next: DeliveryReport): DeliveryReport {
  if (current && DELIVERY_RANK[next.status] <= DELIVERY_RANK[current.status]) return current;
  return next;
}

function addresses(contact: Contact, includeVoice: boolean): { channel: ContactChannel; address: string }[] {
  const out: { channel: ContactChannel; address: string }[] = [];
  if (contact.sms) out.push({ channel: 'sms', address: contact.sms });
  if (contact.email) out.push({ channel: 'email', address: contact.email });
  for (const token of contact.pushTokens ?? []) out.push({ channel: 'push', address: token });
  if (includeVoice && contact.voice) out.push({ channel: 'voice', address: contact.voice });
  return out;
}

/**
 * Japanese carriers silently drop SMS from overseas senders that contain a link or a phone number,
 * and long messages are split into parts that may not be reassembled. SMS therefore carries no
 * link or number and fits in one part: 160 plain characters, or 70 when it needs Unicode (Japanese).
 */
export function fitSms(head: string, middle: string, tail: string, unicode: boolean): string {
  const plain = (t: string) =>
    unicode
      ? t
      : t
          .normalize('NFKD')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2013\u2014]/g, '-')
          .replace(/[^ -~]/g, '');
  const [h, m, t] = [plain(head), plain(middle), plain(tail)];
  const room = (unicode ? 70 : 160) - h.length - t.length;
  const fitted = m.length <= room ? m : room > 3 ? `${m.slice(0, room - 3).trimEnd()}...` : '';
  return `${h}${fitted}${t}`;
}

function staffMessage(change: CaseChange, ctx: NotificationContext, channel: ContactChannel): { subject: string; body: string } {
  const label = URGENCY_LABELS[ctx.locale][change.to];
  const rule = RULE_NAMES[ctx.locale][change.detection.rule];
  const summary = change.detection.summary;
  if (ctx.locale === 'ja') {
    return {
      subject: `【Hachi ${label}】${ctx.residentName}さん：${rule}`,
      body:
        channel === 'sms'
          ? fitSms(`【Hachi ${label}】${ctx.residentName}さん：`, summary, '。詳細は職員画面で。', true)
          : `【Hachi ${label}】${ctx.residentName}さん\n${rule}：${summary}\nケース：${ctx.caseUrl}`,
    };
  }
  return {
    subject: `[Hachi ${label}] ${ctx.residentName}: ${rule}`,
    body:
      channel === 'sms'
        ? fitSms(`[Hachi ${label}] ${ctx.residentName}: `, summary, '. Open the Hachi staff queue for details.', false)
        : `[Hachi ${label}] ${ctx.residentName}\n${rule}: ${summary}\nCase: ${ctx.caseUrl}`,
  };
}

/** FAM-03: family messages carry only the plain summary, never transcript quotes. */
function familyMessage(change: CaseChange, ctx: NotificationContext, channel: ContactChannel): { subject: string; body: string } {
  const summary = change.detection.summary;
  const name = ctx.residentName;
  if (ctx.locale === 'ja') {
    return {
      subject: `【Hachi 緊急】${name}さんの体調について`,
      body:
        channel === 'sms'
          ? fitSms(`【Hachi 緊急】${name}さんが通話で体調の急な異変を訴えました。すぐにご連絡ください。`, '', '詳細はメールで。', true)
          : `【Hachi 緊急】${name}さんとの通話で、体調の急な異変の訴えがありました。\n` +
            `状況：${summary}\n` +
            `すぐに${name}さんへご連絡ください。\n` +
            `担当職員：${ctx.staff.name}（${ctx.staffPhone}）\n` +
            `詳しくはこちら：${ctx.dashboardUrl}`,
    };
  }
  return {
    subject: `[Hachi Emergency] About ${name}`,
    body:
      channel === 'sms'
        ? fitSms(`[Hachi Emergency] ${name}: `, summary, `. Please contact ${name} right away. Details are in your email.`, false)
        : `[Hachi Emergency] During today's call, ${name} reported sudden symptoms.\n` +
          `What we heard: ${summary}\n` +
          `Please contact ${name} right away.\n` +
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
  const push = (
    recipient: 'staff' | 'family',
    contact: Contact,
    message: (channel: ContactChannel) => { subject: string; body: string },
    voice: boolean,
  ) => {
    for (const { channel, address } of addresses(contact, voice)) {
      out.push({
        idempotencyKey: notificationKey(change.caseId, change.to, recipient, channel, address),
        caseId: change.caseId,
        urgency: change.to,
        recipient,
        channel,
        address,
        ...message(channel),
        priority,
      });
    }
  };
  if (policy.staff) push('staff', ctx.staff, (channel) => staffMessage(change, ctx, channel), change.to === 'emergency');
  if (policy.family && ctx.family) push('family', ctx.family, (channel) => familyMessage(change, ctx, channel), true);
  return out;
}
