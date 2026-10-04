import { describe, expect, it } from 'vitest';
import type { CaseChange } from '../src/cases.js';
import { addressDigest, mergeDelivery, notificationKey, planNotifications, type NotificationContext } from '../src/notifications.js';
import type { DeliveryReport } from '../src/types.js';
import { detection } from './fixtures.js';

const ctx: NotificationContext = {
  residentName: 'Margaret Smith',
  staff: { name: 'Tanaka', sms: '+810000000001', email: 'staff@example.org', pushTokens: ['staff-token'], voice: '+810000000001' },
  family: { name: 'Alice', sms: '+810000000002', email: 'alice@example.org', pushTokens: ['fam-a', 'fam-b'], voice: '+810000000002' },
  caseUrl: 'https://hachi.example/cases/case-1',
  dashboardUrl: 'https://hachi.example/family',
  staffPhone: '+81-3-0000-0000',
  locale: 'ja',
};

const QUOTE = 'Oh my chest, it really hurts';

function change(overrides: Partial<CaseChange> = {}): CaseChange {
  return {
    type: 'created',
    caseId: 'case-1',
    from: null,
    to: 'emergency',
    detection: detection({
      rule: 'R1',
      urgency: 'emergency',
      summary: 'Chest pain since this morning',
      evidence: [{ callId: 'call-1', quote: QUOTE }],
    }),
    ...overrides,
  };
}

describe('planNotifications', () => {
  it('emergency notifies staff and family immediately on every channel (NTF-01)', () => {
    const msgs = planNotifications(change(), ctx);
    const staff = msgs.filter((m) => m.recipient === 'staff').map((m) => m.channel);
    const family = msgs.filter((m) => m.recipient === 'family').map((m) => m.channel);
    expect(staff).toEqual(['sms', 'email', 'push', 'voice']);
    expect(family).toEqual(['sms', 'email', 'push', 'push', 'voice']);
    expect(msgs.every((m) => m.priority === 'immediate' && m.urgency === 'emergency')).toBe(true);
  });

  it('emergency without registered family notifies staff only', () => {
    const msgs = planNotifications(change(), { ...ctx, family: undefined });
    expect(msgs.every((m) => m.recipient === 'staff')).toBe(true);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('urgent notifies staff only, without a voice call (NTF-02)', () => {
    const msgs = planNotifications(change({ to: 'urgent', detection: detection({ urgency: 'urgent' }) }), ctx);
    expect(msgs.map((m) => `${m.recipient}:${m.channel}`)).toEqual(['staff:sms', 'staff:email', 'staff:push']);
    expect(msgs.every((m) => m.priority === 'normal')).toBe(true);
  });

  it('action and watch do not notify', () => {
    expect(planNotifications(change({ to: 'action' }), ctx)).toEqual([]);
    expect(planNotifications(change({ to: 'watch' }), ctx)).toEqual([]);
  });

  it('escalations notify but plain updates do not', () => {
    expect(planNotifications(change({ type: 'escalated', from: 'watch', to: 'urgent' }), ctx)).toHaveLength(3);
    expect(planNotifications(change({ type: 'updated', from: 'emergency' }), ctx)).toEqual([]);
  });

  it('staff message includes name, urgency, summary and case link (NTF-03)', () => {
    for (const m of planNotifications(change(), ctx).filter((x) => x.recipient === 'staff')) {
      expect(m.body).toContain('Margaret Smith');
      expect(m.body).toContain('緊急');
      expect(m.body).toContain('Chest pain since this morning');
      expect(m.subject).toContain('急な体調の異変');
      if (m.channel !== 'sms') expect(m.body).toContain(ctx.caseUrl);
    }
  });

  it('family message asks to contact the resident, links the dashboard, and never quotes the transcript (NTF-03, FAM-03)', () => {
    for (const locale of ['ja', 'en'] as const) {
      for (const m of planNotifications(change(), { ...ctx, locale }).filter((x) => x.recipient === 'family')) {
        expect(m.body).toContain('Margaret Smith');
        expect(m.body).not.toContain(QUOTE);
        expect(m.body).not.toContain(ctx.caseUrl);
        if (m.channel !== 'sms') expect(m.body).toContain(ctx.dashboardUrl);
      }
    }
    const email = planNotifications(change(), ctx).find((x) => x.recipient === 'family' && x.channel === 'email')!;
    expect(email.body).toContain('すぐにMargaret Smithさんへご連絡ください');
  });

  it('keeps SMS to one part with no link, which Japanese carriers drop from overseas senders', () => {
    const long = change({ detection: detection({ rule: 'R1', urgency: 'emergency', summary: `Said “I can’t breathe” — ${'and more '.repeat(30)}` }) });
    for (const locale of ['ja', 'en'] as const) {
      for (const m of planNotifications(long, { ...ctx, locale }).filter((x) => x.channel === 'sms')) {
        expect(m.body).not.toMatch(/https?:|www\./);
        if (locale === 'en') {
          expect(m.body.length).toBeLessThanOrEqual(160);
          expect(m.body).toMatch(/^[ -~]*$/);
        } else {
          expect(m.body.length).toBeLessThanOrEqual(70);
        }
      }
    }
    const en = planNotifications(long, { ...ctx, locale: 'en' }).find((x) => x.recipient === 'family' && x.channel === 'sms')!;
    expect(en.body).toMatch(/^\[Hachi Emergency\] Margaret Smith: Said "I can't breathe" - and more .*\.\.\.\. Please contact Margaret Smith right away\. Details are in your email\.$/);
  });

  it('keeps phone numbers out of family SMS, which Japanese carriers filter, but not other channels', () => {
    for (const locale of ['ja', 'en'] as const) {
      const family = planNotifications(change(), { ...ctx, locale }).filter((x) => x.recipient === 'family');
      const sms = family.find((m) => m.channel === 'sms')!;
      expect(sms.body).not.toContain(ctx.staffPhone);
      expect(sms.body).not.toMatch(/\+?\d[\d-]{7,}\d/);
      for (const m of family.filter((x) => x.channel !== 'sms')) expect(m.body).toContain(ctx.staffPhone);
    }
  });

  it('English staff messages', () => {
    const staff = planNotifications(change(), { ...ctx, locale: 'en' }).filter((x) => x.recipient === 'staff');
    const email = staff.find((x) => x.channel === 'email')!;
    expect(email.subject).toBe('[Hachi Emergency] Margaret Smith: Acute symptoms');
    expect(email.body).toContain('Case: https://hachi.example/cases/case-1');
    expect(staff.find((x) => x.channel === 'sms')!.body).toBe('[Hachi Emergency] Margaret Smith: Chest pain since this morning. Open the Hachi staff queue for details.');
  });

  it('family gets independent voice, email and push alerts alongside the SMS, so a filtered text is not the only channel', () => {
    const family = planNotifications(change(), ctx).filter((m) => m.recipient === 'family');
    expect(new Set(family.map((m) => m.channel))).toEqual(new Set(['sms', 'voice', 'email', 'push']));
    // Each channel is its own outbox entry with its own key, so one failing does not hold up the others.
    expect(new Set(family.map((m) => m.idempotencyKey)).size).toBe(family.length);
    expect(family.every((m) => m.priority === 'immediate')).toBe(true);
  });

  it('uses unique, deterministic idempotency keys', () => {
    const a = planNotifications(change(), ctx);
    const b = planNotifications(change(), ctx);
    expect(a.map((m) => m.idempotencyKey)).toEqual(b.map((m) => m.idempotencyKey));
    expect(new Set(a.map((m) => m.idempotencyKey)).size).toBe(a.length);
  });

  it('keeps phone numbers, emails and push tokens out of idempotency keys', () => {
    const msgs = planNotifications(change(), ctx);
    for (const m of msgs) {
      expect(m.idempotencyKey).not.toContain(m.address);
      expect(m.idempotencyKey).toBe(`case-1:emergency:${m.recipient}:${m.channel}:${addressDigest(m.address)}`);
    }
    expect(addressDigest('+810000000002')).toMatch(/^[a-f0-9]{32}$/);
    expect(addressDigest('+810000000002')).not.toBe(addressDigest('+810000000003'));
    expect(notificationKey('c', 'urgent', 'staff', 'sms', '+810000000001')).toBe(`c:urgent:staff:sms:${addressDigest('+810000000001')}`);
  });

  it('skips channels the contact does not have', () => {
    const msgs = planNotifications(change({ to: 'urgent' }), { ...ctx, staff: { name: 'Tanaka', email: 'staff@example.org' } });
    expect(msgs.map((m) => m.channel)).toEqual(['email']);
  });
});

describe('mergeDelivery', () => {
  const r = (status: DeliveryReport['status'], at = '2026-10-02T00:00:00.000Z'): DeliveryReport => ({ status, at });

  it('moves forward and ignores late or repeated reports', () => {
    expect(mergeDelivery(undefined, r('queued'))).toEqual(r('queued'));
    const sent = r('sent');
    expect(mergeDelivery(r('queued'), sent)).toBe(sent);
    const delivered = r('delivered', '2026-10-02T00:00:05.000Z');
    expect(mergeDelivery(sent, delivered)).toBe(delivered);
    expect(mergeDelivery(delivered, r('sent', '2026-10-02T00:00:09.000Z'))).toBe(delivered);
    expect(mergeDelivery(delivered, r('delivered', '2026-10-02T00:00:09.000Z'))).toBe(delivered);
  });

  it('keeps the first final outcome', () => {
    const undelivered: DeliveryReport = { status: 'undelivered', errorCode: '30007', at: '2026-10-02T00:00:05.000Z' };
    expect(mergeDelivery(r('sending'), undelivered)).toBe(undelivered);
    expect(mergeDelivery(undelivered, r('delivered'))).toBe(undelivered);
    expect(mergeDelivery(r('ringing'), r('answered')).status).toBe('answered');
    expect(mergeDelivery(r('answered'), r('no_answer')).status).toBe('answered');
  });
});
