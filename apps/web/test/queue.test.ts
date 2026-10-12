import { describe, expect, it } from 'vitest';
import { avatarDetails, filterQueue, queueFilters } from '../src/queue';
import type { QueueItem } from '../src/types';

const items = [
  { caseId: '1', residentName: 'Margaret Smith', summary: 'Very little breakfast', urgency: 'emergency', status: 'open' },
  { caseId: '2', residentName: 'Dorothy Jones', summary: 'More hesitations', urgency: 'watch', status: 'in_progress' },
  { caseId: '3', residentName: 'Margaret Smith', summary: 'Improved appetite', urgency: 'urgent', status: 'closed' },
] as QueueItem[];
const filters = (query: string) => queueFilters(new URLSearchParams(query));

describe('shared queue filters', () => {
  it('defaults to open cases and ignores unrecognized urgency/closed values', () => {
    expect(filters('urgency=no&includeClosed=no')).toEqual({ urgency: '', query: '', includeClosed: false });
    expect(filterQueue(items, filters('')).map((i) => i.caseId)).toEqual(['1', '2']);
  });
  it('combines urgency, resident names and summaries without reordering', () => {
    expect(filterQueue(items, filters('q=BREAKFAST&urgency=emergency'))).toEqual([items[0]]);
    expect(filterQueue(items, filters('q=dorothy&urgency=emergency'))).toEqual([]);
    expect(filterQueue(items, filters('q=margaret&includeClosed=true'))).toEqual([items[0], items[2]]);
    expect(filterQueue(items, filters('q=%20%20'))).toEqual(items.slice(0, 2));
  });
  it('uses literal text and normalizes full-width input', () => {
    expect(filterQueue(items, filters('q=ＭＡＲＧＡＲＥＴ'))).toEqual([items[0]]);
    expect(filterQueue(items, filters('q=.*'))).toEqual([]);
  });
  it('keeps URL-encoded searches portable', () => {
    const p = new URLSearchParams(); p.set('q', 'tea & toast'); p.set('urgency', 'urgent'); p.set('includeClosed', 'true');
    expect(filters(p.toString())).toEqual({ query: 'tea & toast', urgency: 'urgent', includeClosed: true });
  });
});

describe('resident initials', () => {
  it('keeps a resident colour stable and supports non-Latin names', () => {
    expect(avatarDetails('one', 'Margaret Smith').initials).toBe('MS');
    expect(avatarDetails('one', 'Margaret (synthetic demo)').initials).toBe('MA');
    expect(avatarDetails('one', '鈴木 太郎').initials).toBe('鈴太');
    expect(avatarDetails('one', '').initials).toBe('?');
    expect(avatarDetails('one', 'Different Name').color).toBe(avatarDetails('one', 'Margaret Smith').color);
    expect(avatarDetails('one', 'Margaret Smith').color).toBeGreaterThanOrEqual(0);
    expect(avatarDetails('one', 'Margaret Smith').color).toBeLessThan(4);
  });
});
