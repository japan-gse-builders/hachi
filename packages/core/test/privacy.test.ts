import { describe, expect, it } from 'vitest';
import { hasCallConsent, PRIVACY_NOTICE, type CallConsent } from '../src/privacy.js';

const approval: CallConsent = {
  accepted: true,
  noticeVersion: PRIVACY_NOTICE.version,
  recordedAt: '2026-10-09T01:00:00.000Z',
  recordedBy: 'staff-1',
};

describe('first-use call approval', () => {
  it.each([
    undefined,
    null,
    { ...approval, accepted: false },
    { ...approval, noticeVersion: '' },
    { ...approval, recordedBy: ' ' },
    { ...approval, recordedAt: 'invalid' },
  ])('requires a recorded affirmative answer: %j', (consent) => {
    expect(hasCallConsent(consent)).toBe(false);
  });

  it('keeps an initial approval valid when the notice is updated', () => {
    expect(hasCallConsent(approval)).toBe(true);
    expect(hasCallConsent({ ...approval, noticeVersion: '2026-10-01' })).toBe(true);
  });
});
