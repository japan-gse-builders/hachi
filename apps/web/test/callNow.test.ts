import { describe, expect, it } from 'vitest';
import { callProgressLine, isUnderWay, type CallProgress } from '../src/callNow';

const p = (overrides: Partial<CallProgress>): CallProgress => ({
  id: '2026-10-01-now-1',
  status: 'requested',
  trigger: 'staff',
  requestedBy: 'staff-1',
  startedAt: '2026-10-01T03:00:00.000Z',
  endedAt: null,
  durationSec: null,
  endedBy: null,
  failureCode: null,
  ...overrides,
});

describe('following a call staff asked for (issue #13)', () => {
  it('keeps following until the call has ended', () => {
    expect(['requested', 'scheduled', 'in_progress'].every((s) => isUnderWay(s as CallProgress['status']))).toBe(true);
    expect(['completed', 'no_answer', 'failed'].some((s) => isUnderWay(s as CallProgress['status']))).toBe(false);
  });

  it('says where the call is', () => {
    expect(callProgressLine(p({ status: 'scheduled' }), 'Maggie')).toBe('Ringing Maggie…');
    expect(callProgressLine(p({ status: 'in_progress' }), 'Maggie')).toBe('Hachi is on the call with Maggie.');
    expect(callProgressLine(p({ status: 'no_answer' }), 'Maggie')).toBe('Maggie did not answer.');
    expect(callProgressLine(p({ status: 'completed', durationSec: 185, endedBy: 'agent' }), 'Maggie')).toContain('after 3:05');
  });

  it('says why a call was not made, and when it ended badly', () => {
    expect(callProgressLine(p({ status: 'failed', failureCode: 'budget_exhausted' }), 'Maggie')).toContain('budget');
    expect(callProgressLine(p({ status: 'failed', failureCode: '21219' }), 'Maggie')).toBe('The call could not be made.');
    expect(callProgressLine(p({ status: 'failed', failureCode: 'paused' }), 'Maggie')).toContain('paused');
    expect(callProgressLine(p({ status: 'failed', failureCode: 'not_placed' }), 'Maggie')).toContain('You can ask again');
    expect(callProgressLine(p({ status: 'completed', endedBy: 'silent_after_greeting' }), 'Maggie')).toContain('did not speak');
    expect(callProgressLine(p({ status: 'completed', endedBy: 'emergency' }), 'Maggie')).toContain('emergency');
  });
});
