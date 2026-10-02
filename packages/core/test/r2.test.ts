import { describe, expect, it } from 'vitest';
import { assessR2, countPoorIntakeDays, type IntakeObservation } from '../src/r2.js';

const poor = (date: string, reportedPoorDays?: number): IntakeObservation => ({ date, status: 'poor', reportedPoorDays });
const normal = (date: string): IntakeObservation => ({ date, status: 'normal' });
const unknown = (date: string): IntakeObservation => ({ date, status: 'unknown' });

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
    expect(assessR2([normal('2026-10-02')])).toEqual({ poorIntakeDays: 0, urgency: null, followUpNextCall: false });
  });

  it('one day of poor intake is watch and asks again next call', () => {
    expect(assessR2([poor('2026-10-02')])).toEqual({ poorIntakeDays: 1, urgency: 'watch', followUpNextCall: true });
  });

  it('two or more days is urgent (PRI-05 escalation case)', () => {
    expect(assessR2([poor('2026-10-01'), poor('2026-10-02')]).urgency).toBe('urgent');
    expect(assessR2([poor('2026-10-02', 4)]).urgency).toBe('urgent');
  });
});
