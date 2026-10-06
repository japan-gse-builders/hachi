import { describe, expect, it } from 'vitest';
import {
  contactRequestKey,
  contactRequestSms,
  digitRuns,
  matchesContact,
  parseSpokenNumber,
  planContactRequest,
  type ContactRequest,
} from '../src/contactRequest.js';

const request = (over: Partial<ContactRequest> = {}): ContactRequest => ({ who: 'my daughter', confirmed: false, turn: 4, ...over });

describe('parseSpokenNumber', () => {
  it('reads a number dictated as figures', () => {
    expect(parseSpokenNumber('my number is 090 1234 5678')).toBe('+819012345678');
    expect(parseSpokenNumber('09012345678')).toBe('+819012345678');
  });

  it('reads a number dictated as words, including "oh" for zero', () => {
    expect(parseSpokenNumber('oh nine oh, one two three four, five six seven eight')).toBe('+819012345678');
    expect(parseSpokenNumber('zero nine zero one two three four five six seven eight')).toBe('+819012345678');
  });

  it('reads a number a transcript wrote half in words and half in figures', () => {
    expect(parseSpokenNumber('it is zero nine zero 1234 five six seven eight')).toBe('+819012345678');
  });

  it('reads a ten-digit landline', () => {
    expect(parseSpokenNumber('ring her on 03 1234 5678')).toBe('+81312345678');
  });

  it('keeps an international number as it was given', () => {
    expect(parseSpokenNumber('she is in England, it is +44 7700 900123')).toBe('+447700900123');
  });

  it('ignores digits in the sentence that are not the number', () => {
    expect(parseSpokenNumber('I have told her twice in 2026, her number is 090 1234 5678')).toBe('+819012345678');
  });

  it('refuses a number spoken with a multiplier, because mishearing one shifts every digit after it', () => {
    expect(parseSpokenNumber('zero nine zero double one two three four five six')).toBeNull();
    expect(parseSpokenNumber('triple nine')).toBeNull();
  });

  it('refuses two different numbers in one breath rather than picking one', () => {
    expect(parseSpokenNumber('either 090 1234 5678 or 080 8765 4321')).toBeNull();
  });

  it('reads the same number said twice as one number', () => {
    expect(parseSpokenNumber('090 1234 5678, that is 09012345678')).toBe('+819012345678');
  });

  it('refuses anything that is not a number we can dial', () => {
    expect(parseSpokenNumber('her number is 1234')).toBeNull();
    expect(parseSpokenNumber('090 1234 56789')).toBeNull();
    // No trunk zero, so this is not a Japanese number however many digits it has.
    expect(parseSpokenNumber('90 1234 5678')).toBeNull();
    expect(parseSpokenNumber('please ask my daughter')).toBeNull();
  });

  it('refuses a mobile number with a digit missing, which a landline pattern would otherwise swallow', () => {
    expect(parseSpokenNumber('090 1234 567')).toBeNull();
    expect(parseSpokenNumber('080 1234 567')).toBeNull();
  });

  it('breaks a run at any other word, so a sentence is not read as one long number', () => {
    expect(digitRuns('090 and 1234').map((r) => r.digits)).toEqual(['090', '1234']);
  });
});

describe('matchesContact', () => {
  const family = { name: 'Mary Collins', relationship: 'daughter', sms: '+819000000002' };

  it('matches on a first or last name', () => {
    expect(matchesContact(family, 'my daughter Mary')).toBe(true);
    expect(matchesContact(family, 'Collins')).toBe(true);
    expect(matchesContact(family, 'MARY')).toBe(true);
  });

  it('matches on the relationship alone, which is how residents usually say it', () => {
    expect(matchesContact(family, 'my daughter')).toBe(true);
  });

  it('does not match someone else', () => {
    expect(matchesContact(family, 'my neighbour Susan')).toBe(false);
    expect(matchesContact(family, 'my son')).toBe(false);
  });

  it('ignores name fragments too short to identify anyone', () => {
    expect(matchesContact({ name: 'Jo', relationship: 'a friend' }, 'my neighbour')).toBe(false);
  });
});

describe('planContactRequest', () => {
  const ctx = {
    callId: 'call-1',
    preferredName: 'Edith',
    family: { name: 'Mary Collins', relationship: 'daughter', sms: '+819000000002' },
  };

  it('texts the family contact we hold without waiting for anyone', () => {
    const plan = planContactRequest(request({ who: 'my daughter Mary' }), ctx);
    expect(plan?.needsApproval).toBe(false);
    expect(plan?.message.address).toBe('+819000000002');
    expect(plan?.message.recipient).toBe('family');
    expect(plan?.message.kind).toBe('contact_request');
  });

  it('holds a number the resident read out for a person to agree to', () => {
    const plan = planContactRequest(request({ who: 'my neighbour', number: '+819011112222', confirmed: true }), ctx);
    expect(plan?.needsApproval).toBe(true);
    expect(plan?.message.address).toBe('+819011112222');
    expect(plan?.message.recipient).toBe('contact');
  });

  it('does not wait when the number they read out is the one we already hold', () => {
    const plan = planContactRequest(request({ who: 'Mary', number: '+819000000002', confirmed: true }), ctx);
    expect(plan?.needsApproval).toBe(false);
    expect(plan?.message.recipient).toBe('family');
  });

  it('sends nothing on a number that was never read back and agreed', () => {
    expect(planContactRequest(request({ who: 'my neighbour', number: '+819011112222', confirmed: false }), ctx)).toBeNull();
  });

  it('sends nothing when the person they named is no one we can reach', () => {
    expect(planContactRequest(request({ who: 'my neighbour' }), ctx)).toBeNull();
    expect(planContactRequest(request({ who: 'my daughter' }), { callId: 'c', preferredName: 'Edith' })).toBeNull();
  });

  it('sends nothing when the contact we hold has no number to text', () => {
    const emailOnly = { callId: 'c', preferredName: 'Edith', family: { name: 'Mary', email: 'mary@example.com' } };
    expect(planContactRequest(request({ who: 'Mary' }), emailOnly)).toBeNull();
  });

  it('keys the message by call and number, so a retried analysis cannot text twice', () => {
    const a = planContactRequest(request({ who: 'Mary' }), ctx)!;
    const b = planContactRequest(request({ who: 'my daughter', turn: 9 }), ctx)!;
    expect(a.message.idempotencyKey).toBe(b.message.idempotencyKey);
    expect(a.message.idempotencyKey).not.toContain('+819000000002');
  });

  it('keys a different call separately', () => {
    expect(contactRequestKey('call-1', '+819000000002')).not.toBe(contactRequestKey('call-2', '+819000000002'));
  });
});

describe('contactRequestSms', () => {
  const body = contactRequestSms('Edith');

  it('fits one plain-text message, which is all a Japanese carrier will carry from overseas', () => {
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toMatch(/^[ -~]+$/);
  });

  it('carries no link and no phone number, which a carrier would filter', () => {
    expect(body).not.toMatch(/https?:|\d{5,}/);
  });

  it('says what the resident asked for and nothing about their health', () => {
    expect(body).toContain('Edith would like a phone call from you');
    expect(body).toContain('Hachi');
    expect(body).not.toMatch(/\b(health|unwell|ill|eating|lonely|emergency alert)\b/i);
  });
});
