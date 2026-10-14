import { describe, expect, it } from 'vitest';
import { familyContacts, normalizeEmail, normalizePhone, toIdentity } from '../src/auth.js';
import { applyStaffUpdate } from '../src/caseUpdate.js';
import { addPushToken, patchResident } from '../src/residents.js';
import { staffContactSchema } from '../src/schemas.js';
import { idGen, makeResident, NOW, storedCase } from './helpers.js';

describe('auth helpers', () => {
  it('normalizes phones and emails', () => {
    expect(normalizePhone(' +81 90-0000-0002 ')).toBe('+819000000002');
    expect(normalizePhone('090 0000 0002')).toBe('09000000002');
    expect(normalizeEmail(' Alice@Example.ORG ')).toBe('alice@example.org');
  });

  it('accepts phone numbers as typed on Japanese keyboards and rejects ones without a country', () => {
    const sms = (v: string) => staffContactSchema.safeParse({ name: 'Tanaka', phone: v, sms: v });
    const fullWidth = (s: string) => s.replace(/[+0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    for (const typed of ['+81 90-0000-0002', fullWidth('+819000000002'), '090-0000-0002', fullWidth('090 0000 0002')]) {
      expect(sms(typed).data?.sms).toBe('+819000000002');
    }
    expect(sms('03-0000-0000').data?.phone).toBe('+81300000000');
    for (const bad of ['9000000002', '0000000002', '+81', 'abc']) expect(sms(bad).success).toBe(false);
  });

  it('maps tokens to identities, with sign-in time in milliseconds and the email normalized', () => {
    expect(toIdentity({ uid: 'a', email: ' A@X.org ', emailVerified: true, name: 'Ann', authTime: 1_790_000_000 })).toEqual({
      uid: 'a',
      email: 'a@x.org',
      emailVerified: true,
      name: 'Ann',
      authTime: 1_790_000_000_000,
    });
    expect(toIdentity({ uid: 'b' })).toEqual({ uid: 'b', emailVerified: false });
  });

  it('counts only a verified email, and any phone number, as a family contact', () => {
    expect(familyContacts(toIdentity({ uid: 'b', phoneNumber: '+819000000002', email: 'A@x.org', emailVerified: true }))).toEqual(['+819000000002', 'a@x.org']);
    expect(familyContacts(toIdentity({ uid: 'c', email: 'a@x.org', emailVerified: false }))).toEqual([]);
    expect(familyContacts(toIdentity({ uid: 'd' }))).toEqual([]);
  });
});

describe('applyStaffUpdate', () => {
  it('records nothing when values are unchanged', () => {
    const c = storedCase();
    const m = applyStaffUpdate(c, { status: 'open', urgency: 'watch', scoreOffset: 0, reason: 'same' }, 'u', NOW, idGen());
    expect(m.events).toEqual([]);
    expect(m.case.updatedAt).toBe(c.updatedAt);
  });

  it('lets staff lower an emergency, keeping the automatic value in the event', () => {
    const m = applyStaffUpdate(storedCase({ autoUrgency: 'emergency' }), { urgency: 'action', reason: 'Was a joke' }, 'u', NOW, idGen());
    expect(m.case.staffUrgency).toBe('action');
    expect(m.events[0]).toMatchObject({ type: 'urgency_changed', from: 'emergency', to: 'action', autoUrgency: 'emergency', reason: 'Was a joke' });
  });

  it('reopening a closed case clears the outcome', () => {
    const closed = storedCase({ status: 'closed', closedAt: NOW.toISOString(), outcome: { anomalyConfirmed: true } });
    const m = applyStaffUpdate(closed, { status: 'open' }, 'u', NOW, idGen());
    expect(m.case.status).toBe('open');
    expect(m.case.closedAt).toBeUndefined();
    expect(m.case.outcome).toBeUndefined();
    expect(m.events[0]).toMatchObject({ type: 'status_changed', from: 'closed', to: 'open' });
  });

  it('does not mutate the input', () => {
    const c = storedCase();
    applyStaffUpdate(c, { status: 'in_progress' }, 'u', NOW, idGen());
    expect(c.status).toBe('open');
  });
});

describe('resident helpers', () => {
  it('keeps push tokens when the family contact is unchanged, drops them when it changes', () => {
    const r = addPushToken(makeResident('r'), 'token-1');
    const family = { name: 'Alice', sms: '+819000000002', email: 'alice@example.org' };
    expect(patchResident(r, { family }, NOW).family?.pushTokens).toEqual(['token-1']);
    expect(patchResident(r, { family: { name: 'New', sms: '+819033333333' } }, NOW).family?.pushTokens).toEqual([]);
  });

  it('updates the staff voice number with the staff phone', () => {
    const r = patchResident(makeResident('r'), { staff: { name: 'Sato', phone: '+81311111111', sms: '+81311111111' } }, NOW);
    expect(r.staff.voice).toBe('+81311111111');
  });

  it('sets the portrait, keeps it when not sent, and clears it with null', () => {
    const set = patchResident(makeResident('r'), { portrait: 'grandmother-2' }, NOW);
    expect(set.portrait).toBe('grandmother-2');
    expect(patchResident(set, { preferredName: 'Mags' }, NOW).portrait).toBe('grandmother-2');
    expect('portrait' in patchResident(set, { portrait: null }, NOW)).toBe(false);
  });

  it('caps and de-duplicates push tokens; ignores residents without family', () => {
    let r = makeResident('r');
    for (let i = 0; i < 12; i++) r = addPushToken(r, `t${i}`);
    r = addPushToken(r, 't5');
    expect(r.family?.pushTokens).toHaveLength(10);
    expect(r.family?.pushTokens?.at(-1)).toBe('t5');
    const noFamily = makeResident('n', { family: undefined });
    expect(addPushToken(noFamily, 't')).toBe(noFamily);
  });
});
