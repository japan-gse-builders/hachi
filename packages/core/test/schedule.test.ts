import { describe, expect, it } from 'vitest';
import { callTaskId, isDue, isValidTimeZone, localDate, nextCallAt, zonedTimeToUtc } from '../src/schedule.js';

describe('zonedTimeToUtc', () => {
  it('converts Tokyo wall-clock time', () => {
    expect(zonedTimeToUtc('2026-10-01', '09:00', 'Asia/Tokyo').toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('handles DST in New York', () => {
    expect(zonedTimeToUtc('2026-07-01', '10:00', 'America/New_York').toISOString()).toBe('2026-07-01T14:00:00.000Z');
    expect(zonedTimeToUtc('2026-12-01', '10:00', 'America/New_York').toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });

  it('moves a time skipped by spring-forward to after the gap', () => {
    expect(zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('picks the first occurrence of a repeated fall-back time', () => {
    expect(zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rejects invalid times', () => {
    expect(() => zonedTimeToUtc('2026-10-01', '25:00', 'Asia/Tokyo')).toThrow(/Invalid time/);
  });
});

describe('nextCallAt (CNV-01, FAM-02)', () => {
  it('returns today when the call time is still ahead', () => {
    const now = new Date('2026-10-01T00:30:00.000Z'); // 09:30 JST
    expect(nextCallAt('10:00', 'Asia/Tokyo', now).toISOString()).toBe('2026-10-01T01:00:00.000Z');
  });

  it('returns tomorrow when the call time has passed or is exactly now', () => {
    const now = new Date('2026-10-01T01:00:00.000Z'); // 10:00 JST
    expect(nextCallAt('10:00', 'Asia/Tokyo', now).toISOString()).toBe('2026-10-02T01:00:00.000Z');
  });

  it('uses the local date, not the UTC date', () => {
    const now = new Date('2026-09-30T16:00:00.000Z'); // 2026-10-01 01:00 JST
    expect(nextCallAt('09:00', 'Asia/Tokyo', now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    const now = new Date('2026-12-31T05:00:00.000Z'); // 14:00 JST on Dec 31
    expect(nextCallAt('09:00', 'Asia/Tokyo', now).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('validates input', () => {
    expect(() => nextCallAt('9:00', 'Asia/Tokyo', new Date())).toThrow(/Invalid time/);
    expect(() => nextCallAt('09:00', 'Mars/Olympus', new Date())).toThrow(/Invalid time zone/);
  });
});

describe('dispatcher helpers', () => {
  it('validates time zones', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('formats the local date', () => {
    expect(localDate(new Date('2026-09-30T16:00:00.000Z'), 'Asia/Tokyo')).toBe('2026-10-01');
    expect(localDate(new Date('2026-09-30T16:00:00.000Z'), 'Europe/London')).toBe('2026-09-30');
  });

  it('isDue matches calls inside the dispatch window only', () => {
    const start = new Date('2026-10-01T00:59:00.000Z');
    const end = new Date('2026-10-01T01:00:00.000Z');
    expect(isDue('10:00', 'Asia/Tokyo', start, end)).toBe(true);
    expect(isDue('10:01', 'Asia/Tokyo', start, end)).toBe(false);
    expect(isDue('09:59', 'Asia/Tokyo', start, end)).toBe(false);
  });

  it('builds deterministic Cloud Tasks ids with only allowed characters', () => {
    expect(callTaskId('res/1@x', '2026-10-01')).toBe('call-res_1_x-2026-10-01-0');
    expect(callTaskId('res-1', '2026-10-01', 2)).toBe('call-res-1-2026-10-01-2');
    expect(callTaskId('res-1', '2026-10-01')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
