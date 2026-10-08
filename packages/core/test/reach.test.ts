import { describe, expect, it } from 'vitest';
import { isOurFault, MISSED_LABELS, MISSED_MEANINGS, MISSED_REASONS, missedCheckIn, missedReason } from '../src/reach.js';

const at = (h: number) => `2026-10-08T0${h}:00:00.000Z`;

describe('missedReason', () => {
  it('counts a connected call as reached whatever was said on it', () => {
    expect(missedReason({ status: 'completed', endedBy: 'agent' })).toBeNull();
    expect(missedReason({ status: 'completed', endedBy: 'resident' })).toBeNull();
    expect(missedReason({ status: 'completed', endedBy: 'emergency' })).toBeNull();
    // Somebody picked the phone up. What they did not say on it is R4's business, not this one's.
    expect(missedReason({ status: 'completed', endedBy: 'silent_after_greeting' })).toBeNull();
    expect(missedReason({ status: 'completed', endedBy: 'stopped_responding' })).toBeNull();
  });

  it('says nothing about a call that has not finished', () => {
    expect(missedReason({ status: 'scheduled' })).toBeNull();
    expect(missedReason({ status: 'in_progress' })).toBeNull();
  });

  it('separates our faults from the resident not picking up', () => {
    expect(missedReason({ status: 'no_answer' })).toBe('no_answer');
    expect(missedReason({ status: 'failed', failureCode: 'gateway_unavailable' })).toBe('service_fault');
    expect(missedReason({ status: 'completed', endedBy: 'gateway_error' })).toBe('service_fault');
    expect(missedReason({ status: 'failed', failureCode: 'budget_exhausted' })).toBe('budget');
    expect(missedReason({ status: 'failed', failureCode: '21219' })).toBe('provider_fault');
    expect(missedReason({ status: 'failed' })).toBe('provider_fault');
  });

  it('knows which three are ours', () => {
    expect(MISSED_REASONS.filter(isOurFault)).toEqual(['service_fault', 'budget', 'provider_fault']);
    expect(isOurFault('no_answer')).toBe(false);
  });

  it('has a label and an instruction in both languages for every reason', () => {
    for (const locale of ['ja', 'en'] as const) {
      for (const reason of MISSED_REASONS) {
        expect(MISSED_LABELS[locale][reason].length).toBeGreaterThan(0);
        expect(MISSED_MEANINGS[locale][reason].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('missedCheckIn', () => {
  it('is null when nothing has been tried, so a call that is not due yet is not a failure', () => {
    expect(missedCheckIn([])).toBeNull();
    expect(missedCheckIn([{ status: 'scheduled', at: at(1) }])).toBeNull();
  });

  it('is null when any attempt reached them', () => {
    expect(
      missedCheckIn([
        { status: 'no_answer', at: at(1) },
        { status: 'completed', endedBy: 'agent', at: at(2) },
      ]),
    ).toBeNull();
  });

  it('reports the latest fault and how many times we rang', () => {
    expect(
      missedCheckIn([
        { status: 'completed', endedBy: 'gateway_error', at: at(1) },
        { status: 'failed', failureCode: 'gateway_unavailable', at: at(2) },
        { status: 'failed', failureCode: 'gateway_unavailable', at: at(3) },
      ]),
    ).toEqual({ reason: 'service_fault', attempts: 3, at: at(3) });
  });

  it('prefers the most recent fault when the attempts failed differently', () => {
    // Nine o'clock they did not answer; nine-oh-three the gateway broke. The second is both the
    // current state of the world and the one staff will find if they go looking.
    expect(
      missedCheckIn([
        { status: 'no_answer', at: at(1) },
        { status: 'failed', failureCode: 'gateway_unavailable', at: at(2) },
      ]),
    ).toMatchObject({ reason: 'service_fault', attempts: 2 });
  });

  it('ignores an attempt still in flight rather than calling the day lost', () => {
    expect(
      missedCheckIn([
        { status: 'no_answer', at: at(1) },
        { status: 'in_progress', at: at(2) },
      ]),
    ).toMatchObject({ reason: 'no_answer', attempts: 1 });
  });
});
