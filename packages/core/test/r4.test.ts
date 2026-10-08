import { describe, expect, it } from 'vitest';
import { assessNoResponse } from '../src/r4.js';

describe('assessNoResponse (R4)', () => {
  it('asks for a check today when the resident answered and never spoke', () => {
    const a = assessNoResponse('silent_after_greeting');
    expect(a.urgency).toBe('urgent');
    expect(a.summary).toContain('never spoke');
  });

  // Reaching the phone and not being able to talk is serious, but it has ordinary explanations too,
  // so it is not put through as an emergency, which would ring family and staff immediately.
  it('does not treat silence as an emergency', () => {
    expect(assessNoResponse('silent_after_greeting', 3).urgency).toBe('urgent');
  });

  it('lets a single call that trails off pass without a case', () => {
    expect(assessNoResponse('stopped_responding').urgency).toBeNull();
    expect(assessNoResponse('stopped_responding', 0).urgency).toBeNull();
  });

  it('raises a case once trailing off becomes the pattern', () => {
    const a = assessNoResponse('stopped_responding', 2);
    expect(a.urgency).toBe('watch');
    expect(a.summary).toContain('2 recent calls');
  });

  it('tells staff how often it has happened, and stays quiet about a one-off', () => {
    expect(assessNoResponse('silent_after_greeting', 1).summary).not.toMatch(/recent calls/);
    expect(assessNoResponse('silent_after_greeting', 3).summary).toContain('3 recent calls');
  });
});
