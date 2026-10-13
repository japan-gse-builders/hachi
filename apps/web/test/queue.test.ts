import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  avatarDetails,
  filterQueue,
  knownSignals,
  needsAttention,
  notifiedSummary,
  openCounts,
  queueFilters,
  queueLanes,
  residentChips,
  sortUnreached,
} from '../src/queue';
import { PRIVACY_NOTICE } from '../src/privacy';
import { bySeverity, SEVERITY_RANK, type Severity } from '../src/signals';
import type { QueueItem, Resident, UnreachedResident } from '../src/types';

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

const now = new Date('2026-10-13T05:00:00.000Z');
const item = (o: Partial<QueueItem>) => ({ caseId: 'c', residentId: 'r', residentName: 'R', urgency: 'watch', urgencyLabel: 'Monitor', status: 'open', summary: '', notifications: [], ...o }) as QueueItem;
const miss = (o: Partial<UnreachedResident>) => ({ residentId: 'r', residentName: 'R', localDate: '2026-10-13', reason: 'no_answer', reasonLabel: 'No answer', meaning: '', attempts: 2, at: now.toISOString(), ourFault: false, lastReachedAt: '2026-10-12T01:00:00.000Z', tried: '', ...o }) as UnreachedResident;
const consent = { accepted: true, noticeVersion: PRIVACY_NOTICE.version, recordedAt: '2026-09-01T00:00:00.000Z', recordedBy: 'staff' };
const resident = (o: Partial<Resident> = {}) => ({ id: 'r', name: 'R', preferredName: 'R', phone: '+819000000001', callTime: '10:00', timeZone: 'Asia/Tokyo', active: true, callConsent: consent, ...o }) as Resident;

describe('urgency lanes', () => {
  it('groups by urgency, most urgent first, keeping the order within a lane and closed cases last', () => {
    const lanes = queueLanes([
      item({ caseId: 'w1', residentId: 'r1' }),
      item({ caseId: 'x', residentId: 'r2', status: 'closed', urgency: 'emergency' }),
      item({ caseId: 'e', residentId: 'r3', urgency: 'emergency' }),
      item({ caseId: 'w2', residentId: 'r4' }),
      item({ caseId: 'odd', residentId: 'r5', urgency: 'later' }),
    ]);
    expect(lanes.map((l) => [l.key, l.severity, l.items.map((i) => i.caseId)])).toEqual([
      ['emergency', 'emergency', ['e']],
      ['watch', 'monitor', ['w1', 'w2']],
      ['later', 'none', ['odd']],
      ['closed', 'good', ['x']],
    ]);
  });
  it('shows a patient with several open cases once, in the lane of the most urgent, listing the rest', () => {
    const all = [
      item({ caseId: 'e', residentId: 'thomas', urgency: 'emergency' }),
      item({ caseId: 'w-other', residentId: 'grace' }),
      item({ caseId: 'w', residentId: 'thomas' }),
      item({ caseId: 'w2', residentId: 'thomas' }),
      item({ caseId: 'done', residentId: 'thomas', status: 'closed' }),
    ];
    const lanes = queueLanes(all);
    expect(lanes.map((l) => [l.key, l.items.map((i) => [i.caseId, i.alsoOpen.map((o) => o.caseId)])])).toEqual([
      ['emergency', [['e', ['w', 'w2']]]],
      ['watch', [['w-other', []]]],
      ['closed', [['done', []]]],
    ]);
    // Filtered to Monitor, Thomas's first case there carries the card, and the emergency is still named on it.
    const watchOnly = queueLanes(all.filter((i) => i.urgency === 'watch' && i.status !== 'closed'), all);
    expect(watchOnly.map((l) => l.items.map((i) => [i.caseId, i.alsoOpen.map((o) => o.caseId)]))).toEqual([
      [['w-other', []], ['w', ['e', 'w2']]],
    ]);
  });
  it('counts open cases at all four levels, zeros included', () => {
    expect(openCounts([item({}), item({ urgency: 'urgent' }), item({ urgency: 'urgent', status: 'closed' })]).map((c) => c.count)).toEqual([0, 1, 0, 1]);
  });
  it('says how long a case has waited', () => {
    expect(ageLabel('2026-10-13T04:59:40.000Z', now)).toBe('just now');
    expect(ageLabel('2026-10-13T06:00:00.000Z', now)).toBe('just now');
    expect(ageLabel('2026-10-13T04:35:00.000Z', now)).toBe('25 min ago');
    expect(ageLabel('2026-10-13T02:00:00.000Z', now)).toBe('3 h ago');
    expect(ageLabel('2026-10-12T04:00:00.000Z', now)).toBe('1 day ago');
    expect(ageLabel('2026-10-10T04:00:00.000Z', now)).toBe('3 days ago');
    expect(ageLabel('not a date', now)).toBe('');
  });
  it('marks a recipient as not delivered when any message to them failed', () => {
    const sent = { channel: 'email', sentAt: now.toISOString() };
    expect(notifiedSummary([
      { ...sent, recipient: 'staff' },
      { ...sent, recipient: 'family', delivery: { status: 'delivered', at: '' } },
      { ...sent, recipient: 'family', channel: 'sms', delivery: { status: 'undelivered', at: '' } },
    ]).map((n) => [n.recipient, n.delivered, n.items.length])).toEqual([['staff', true, 1], ['family', false, 2]]);
  });
});

describe('severity order', () => {
  it('sorts the most worrying first and unknowns before good', () => {
    const list: Severity[] = ['good', 'none', 'monitor', 'system', 'soon', 'today', 'emergency'];
    expect([...list].sort(bySeverity)).toEqual(['emergency', 'today', 'soon', 'system', 'monitor', 'none', 'good']);
    expect([...list].sort(bySeverity)).toEqual(SEVERITY_RANK);
    expect(list.filter(needsAttention)).toEqual(['system', 'soon', 'today', 'emergency']);
  });
  it('puts three days without a call first, down to a call that failed on our side', () => {
    const sorted = sortUnreached([
      miss({ residentId: 'one', missedDays: 1 }),
      miss({ residentId: 'ours', missedDays: 1, ourFault: true }),
      miss({ residentId: 'three', missedDays: 3 }),
      miss({ residentId: 'two', missedDays: 2 }),
    ], now);
    expect(sorted.map((u) => u.residentId)).toEqual(['three', 'two', 'one', 'ours']);
  });
});

describe('known signals', () => {
  it('stays undefined without signals, so no bar of unknowns is drawn', () => {
    expect(knownSignals(undefined, { unchecked: 2, unreached: miss({ missedDays: 2 }) })).toBeUndefined();
  });
  it('fills only what the API left out, and reach only with a day count', () => {
    expect(knownSignals({ speech: 'usual' }, { unchecked: 2, unreached: miss({ missedDays: 2 }) })).toEqual({
      speech: 'usual', unchecked: 2, reach: { lastReachedAt: '2026-10-12T01:00:00.000Z', missedDays: 2, ourFault: false },
    });
    expect(knownSignals({ unchecked: 0 }, { unchecked: 2, unreached: miss({}) })).toEqual({ unchecked: 0 });
  });
});

describe('resident chips', () => {
  it('leads with the worst open case and links to it', () => {
    const cases = [item({ caseId: 'w' }), item({ caseId: 'u', urgency: 'urgent', urgencyLabel: 'Review today', summary: 'Ate little' }), item({ caseId: 'z', residentId: 'other', urgency: 'emergency' })];
    expect(residentChips(resident(), { cases }, now)).toEqual([
      { key: 'case', severity: 'today', word: 'Review today · 2 open cases', detail: 'Ate little', caseId: 'u' },
    ]);
  });
  it('says there is nothing open only when the queue loaded', () => {
    expect(residentChips(resident(), { cases: [] }, now).map((c) => [c.key, c.severity, c.word])).toEqual([['case', 'good', 'No open cases']]);
    expect(residentChips(resident(), {}, now)).toEqual([]);
  });
  it('adds missed calls, unchecked calls, a missing approval and paused calls', () => {
    const chips = residentChips(resident({ active: false, callConsent: undefined }), { cases: [], reach: miss({ missedDays: 3 }), unchecked: 1 }, now);
    expect(chips.map((c) => [c.key, c.severity])).toEqual([
      ['case', 'good'], ['reach', 'emergency'], ['checked', 'system'], ['approval', 'system'], ['paused', 'none'],
    ]);
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
