import { describe, expect, it } from 'vitest';
import type { CaseChange } from '../src/cases.js';
import { planNotifications, type NotificationContext } from '../src/notifications.js';
import { detection } from './fixtures.js';

const ctx: NotificationContext = {
  residentName: 'Margaret Smith',
  preferredName: 'Maggie',
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
    const m = planNotifications(change(), ctx).find((x) => x.recipient === 'staff')!;
    expect(m.body).toContain('Margaret Smith');
    expect(m.body).toContain('緊急');
    expect(m.body).toContain('Chest pain since this morning');
    expect(m.body).toContain(ctx.caseUrl);
    expect(m.subject).toContain('急な体調の異変');
  });

  it('family message asks to contact the resident, links the dashboard, and never quotes the transcript (NTF-03, FAM-03)', () => {
    for (const locale of ['ja', 'en'] as const) {
      for (const m of planNotifications(change(), { ...ctx, locale }).filter((x) => x.recipient === 'family')) {
        expect(m.body).toContain('Maggie');
        expect(m.body).toContain(ctx.dashboardUrl);
        expect(m.body).not.toContain(QUOTE);
        expect(m.body).not.toContain(ctx.caseUrl);
      }
    }
    const ja = planNotifications(change(), ctx).find((x) => x.recipient === 'family')!;
    expect(ja.body).toContain('すぐにMaggieさんへご連絡ください');
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
    const m = planNotifications(change(), { ...ctx, locale: 'en' }).find((x) => x.recipient === 'staff')!;
    expect(m.subject).toBe('[Hachi Emergency] Margaret Smith: Acute symptoms');
    expect(m.body).toContain('Case: https://hachi.example/cases/case-1');
  });

  it('uses unique, deterministic idempotency keys', () => {
    const a = planNotifications(change(), ctx);
    const b = planNotifications(change(), ctx);
    expect(a.map((m) => m.idempotencyKey)).toEqual(b.map((m) => m.idempotencyKey));
    expect(new Set(a.map((m) => m.idempotencyKey)).size).toBe(a.length);
  });

  it('skips channels the contact does not have', () => {
    const msgs = planNotifications(change({ to: 'urgent' }), { ...ctx, staff: { name: 'Tanaka', email: 'staff@example.org' } });
    expect(msgs.map((m) => m.channel)).toEqual(['email']);
  });
});
