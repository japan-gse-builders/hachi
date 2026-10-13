import { describe, expect, it } from 'vitest';
import { assessR2, countPoorFluidDays, countPoorIntakeDays, type IntakeObservation, type IntakeStatus } from '../src/r2.js';

const poor = (date: string, reportedPoorDays?: number): IntakeObservation => ({ date, status: 'poor', reportedPoorDays });
const normal = (date: string): IntakeObservation => ({ date, status: 'normal' });
const unknown = (date: string): IntakeObservation => ({ date, status: 'unknown' });

/**
 * Issue #11: a call the model could not review is recorded as `unknown`. It must never count as a
 * day on which the resident ate, or one outage would quietly reset a run of days without food.
 */
describe('a day the model could not review (unknown)', () => {
  it('is not the same as a day they ate: it does not end the run', () => {
    expect(countPoorIntakeDays([poor('2026-09-30'), unknown('2026-10-01'), poor('2026-10-02')])).toBe(2);
    expect(countPoorIntakeDays([poor('2026-09-30'), normal('2026-10-01'), poor('2026-10-02')])).toBe(1);
    expect(assessR2([poor('2026-09-30'), unknown('2026-10-01'), poor('2026-10-02')]).urgency).toBe('urgent');
  });

  it('as the latest call, leaves the earlier poor day standing rather than clearing it', () => {
    expect(countPoorIntakeDays([poor('2026-10-01'), unknown('2026-10-02')])).toBe(1);
    expect(assessR2([poor('2026-10-01'), unknown('2026-10-02')])).toMatchObject({ urgency: 'watch', followUpNextCall: true });
  });

  it('is not counted as a poor day either', () => {
    expect(countPoorIntakeDays([unknown('2026-10-01'), unknown('2026-10-02')])).toBe(0);
    expect(assessR2([unknown('2026-10-02')]).urgency).toBeNull();
  });

  // Two missing days in a row are a gap the rule cannot bridge. Staff see those calls as not fully
  // checked instead, which is the reason the gap is shown at all.
  it('breaks the run when two days in a row are unknown', () => {
    expect(countPoorIntakeDays([poor('2026-09-29'), unknown('2026-09-30'), unknown('2026-10-01'), poor('2026-10-02')])).toBe(1);
  });
});

describe('countPoorIntakeDays (DET-04)', () => {
  it('is 0 with no observations or when the latest day was normal', () => {
    expect(countPoorIntakeDays([])).toBe(0);
    expect(countPoorIntakeDays([poor('2026-10-01'), normal('2026-10-02')])).toBe(0);
  });

  it('counts consecutive poor days ending at the latest observation', () => {
    expect(countPoorIntakeDays([poor('2026-10-02')])).toBe(1);
    expect(countPoorIntakeDays([normal('2026-09-30'), poor('2026-10-01'), poor('2026-10-02')])).toBe(2);
    expect(countPoorIntakeDays([poor('2026-09-30'), poor('2026-10-01'), poor('2026-10-02')])).toBe(3);
  });

  it('is independent of input order', () => {
    expect(countPoorIntakeDays([poor('2026-10-02'), normal('2026-09-30'), poor('2026-10-01')])).toBe(2);
  });

  it('tolerates a single missed day between poor days but does not count it', () => {
    expect(countPoorIntakeDays([poor('2026-09-30'), poor('2026-10-02')])).toBe(2);
    expect(countPoorIntakeDays([poor('2026-09-30'), unknown('2026-10-01'), poor('2026-10-02')])).toBe(2);
  });

  it('breaks the streak on a gap of two or more days', () => {
    expect(countPoorIntakeDays([poor('2026-09-28'), poor('2026-10-02')])).toBe(1);
  });

  it('uses the number of days the resident reported in a single call', () => {
    expect(countPoorIntakeDays([poor('2026-10-02', 3)])).toBe(3);
    expect(countPoorIntakeDays([poor('2026-10-01', 2), poor('2026-10-02')])).toBe(3);
  });

  it('prefers the more severe observation when there are two calls on one day', () => {
    expect(countPoorIntakeDays([normal('2026-10-02'), poor('2026-10-02')])).toBe(1);
    expect(countPoorIntakeDays([poor('2026-10-02', 2), poor('2026-10-02')])).toBe(2);
    expect(countPoorIntakeDays([poor('2026-10-02'), normal('2026-10-02')])).toBe(1);
  });

  it('crosses month boundaries', () => {
    expect(countPoorIntakeDays([poor('2026-09-30'), poor('2026-10-01')])).toBe(2);
  });

  it('rejects malformed dates', () => {
    expect(() => countPoorIntakeDays([poor('2026/10/01')])).toThrow(/Invalid date/);
    expect(() => countPoorIntakeDays([poor('2026-13-45')])).toThrow(/Invalid date/);
  });
});

describe('assessR2 (rule table in section 2)', () => {
  it('no detection when eating normally', () => {
    expect(assessR2([normal('2026-10-02')])).toEqual({ poorIntakeDays: 0, poorFluidDays: 0, urgency: null, followUpNextCall: false });
  });

  it('one day of poor intake is watch and asks again next call', () => {
    expect(assessR2([poor('2026-10-02')])).toEqual({ poorIntakeDays: 1, poorFluidDays: 0, urgency: 'watch', followUpNextCall: true });
  });

  it('two or more days is urgent (PRI-05 escalation case)', () => {
    expect(assessR2([poor('2026-10-01'), poor('2026-10-02')]).urgency).toBe('urgent');
    expect(assessR2([poor('2026-10-02', 4)]).urgency).toBe('urgent');
  });
});

describe('assessR2: drinks are counted apart from food', () => {
  const dry = (date: string, status: IntakeStatus = 'unknown'): IntakeObservation => ({ date, status, fluids: 'poor' });
  const wet = (date: string, status: IntakeStatus = 'unknown'): IntakeObservation => ({ date, status, fluids: 'normal' });

  it('counts a run of dry days on its own', () => {
    expect(countPoorFluidDays([wet('2026-10-01'), dry('2026-10-02')])).toBe(1);
    expect(countPoorFluidDays([dry('2026-10-01'), dry('2026-10-02')])).toBe(2);
    expect(countPoorFluidDays([poor('2026-10-02', 4)])).toBe(0);
  });

  it('does not stretch a dry day by the days of eating the resident reported', () => {
    expect(countPoorFluidDays([{ date: '2026-10-02', status: 'poor', reportedPoorDays: 4, fluids: 'poor' }])).toBe(1);
  });

  it('asks for a review soon after one dry day, sooner than for one day of missed meals', () => {
    expect(assessR2([dry('2026-10-02', 'normal')])).toMatchObject({ poorFluidDays: 1, urgency: 'action' });
  });

  it('is urgent after two dry days', () => {
    expect(assessR2([dry('2026-10-01', 'normal'), dry('2026-10-02', 'normal')]).urgency).toBe('urgent');
  });

  it('is urgent on the first day when nothing at all has gone in', () => {
    expect(assessR2([dry('2026-10-02', 'poor')])).toMatchObject({ poorIntakeDays: 1, poorFluidDays: 1, urgency: 'urgent' });
  });

  it('asks again next call after a dry day, even when the meals were fine', () => {
    expect(assessR2([dry('2026-10-02', 'normal')]).followUpNextCall).toBe(true);
  });

  it('treats drinks that never came up as unknown rather than poor', () => {
    expect(assessR2([{ date: '2026-10-02', status: 'normal' }])).toMatchObject({ poorFluidDays: 0, urgency: null });
  });
});
