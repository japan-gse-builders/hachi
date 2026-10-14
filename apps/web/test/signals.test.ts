import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorBar, LastReachedChip, SeverityChip, SignalsLegend } from '../src/components/Signals';
import {
  buildIndicators,
  caseSignals,
  checkedLevel,
  compactIndicators,
  domainLevel,
  INDICATORS,
  reachLevel,
  SEVERITIES,
  SEVERITY,
  speechLevel,
  uncheckedFor,
  urgencySeverity,
  worstSeverity,
} from '../src/signals';
import type { CaseDetail, DomainStates, ResidentSignals } from '../src/types';

const now = new Date('2026-10-13T05:00:00.000Z');
const quiet: DomainStates = { body: 'unmentioned', food: 'unmentioned', sleep: 'unmentioned', mood: 'unmentioned', social: 'unmentioned', activity: 'unmentioned' };
const allGood: DomainStates = { body: 'good', food: 'good', sleep: 'good', mood: 'good', social: 'good', activity: 'good' };
const reach = (missedDays: number, o: { ourFault?: boolean; lastReachedAt?: string | null } = {}) => ({
  lastReachedAt: '2026-10-13T01:02:00.000Z',
  missedDays,
  ourFault: false,
  ...o,
});
const fine: ResidentSignals = { latestCallAt: '2026-10-13T01:02:00.000Z', domains: allGood, speech: 'usual', reach: reach(0), unchecked: 0 };

describe('severities', () => {
  it('gives every severity its own symbol and a word', () => {
    expect(SEVERITIES).toEqual(['emergency', 'today', 'soon', 'monitor', 'good', 'system', 'none']);
    for (const s of SEVERITIES) {
      expect(SEVERITY[s].symbol).not.toBe('');
      expect(SEVERITY[s].label).not.toBe('');
    }
    expect(new Set(SEVERITIES.map((s) => SEVERITY[s].symbol)).size).toBe(SEVERITIES.length);
  });

  it('maps case urgency, treating anything unknown as no data', () => {
    expect(['emergency', 'urgent', 'action', 'watch'].map(urgencySeverity)).toEqual(['emergency', 'today', 'soon', 'monitor']);
    expect(urgencySeverity('constructor')).toBe('none');
    expect(urgencySeverity(undefined)).toBe('none');
  });

  it('ranks unknowns above good when picking the worst', () => {
    expect(worstSeverity(['good', 'monitor', 'today'])).toBe('today');
    expect(worstSeverity(['good', 'none'])).toBe('none');
    expect(worstSeverity(['monitor', 'system'])).toBe('system');
    expect(worstSeverity(['good'])).toBe('good');
    expect(worstSeverity([])).toBe('none');
  });

  it('maps domains, speech and unchecked calls', () => {
    expect(['good', 'mixed', 'concern', 'unmentioned', undefined].map((s) => domainLevel(s as never).severity)).toEqual(['good', 'soon', 'today', 'none', 'none']);
    expect(domainLevel('concern').word).toBe('Worth a call');
    expect(['usual', 'slight_change', 'clear_change', 'no_baseline', 'insufficient_recent', undefined].map((s) => speechLevel(s as never).severity))
      .toEqual(['good', 'monitor', 'soon', 'none', 'none', 'none']);
    expect(checkedLevel(undefined)).toMatchObject({ severity: 'none', word: 'Not known' });
    expect(checkedLevel(0)).toMatchObject({ severity: 'good', word: 'All checked' });
    expect(checkedLevel(2)).toMatchObject({ severity: 'system', word: '2 not checked' });
    expect(checkedLevel(1).detail).toContain('1 recent call not fully checked');
  });
});

describe('no-call ladder', () => {
  it.each([
    [0, 'good', 'Reached today'],
    [1, 'soon', 'No call for 1 day'],
    [2, 'today', 'No call for 2 days'],
    [3, 'emergency', 'No call for 3 days'],
    [9, 'emergency', 'No call for 9 days'],
  ])('%i missed days reads %s', (days, severity, word) => {
    expect(reachLevel(reach(days), now)).toMatchObject({ severity, word });
  });

  it('is blue whenever the latest miss was ours, and green once reached again', () => {
    for (const days of [1, 2, 5]) expect(reachLevel(reach(days, { ourFault: true }), now)).toMatchObject({ severity: 'system', word: 'Call failed (our side)' });
    expect(reachLevel(reach(0, { ourFault: true }), now).severity).toBe('good');
    expect(reachLevel(reach(1, { ourFault: true }), now).detail).toMatch(/nothing is known about them\. Last reached today at 10:02\./);
  });

  it('never reads missing data as reached', () => {
    expect(reachLevel(undefined, now)).toMatchObject({ severity: 'none', word: 'No call data' });
    expect(reachLevel(reach(0, { lastReachedAt: null }), now)).toMatchObject({ severity: 'none', word: 'No calls yet' });
    expect(reachLevel({ lastReachedAt: null, ourFault: false }, now)).toMatchObject({ severity: 'none', word: 'Not reached' });
    expect(reachLevel(reach(2, { lastReachedAt: null }), now)).toMatchObject({ severity: 'today', detail: 'No call has connected recently.' });
  });

  it('says when they were reached, in Japan time', () => {
    expect(reachLevel(reach(0, { lastReachedAt: '2026-10-12T01:02:00.000Z' }), now)).toMatchObject({ word: 'Reached yesterday', detail: 'Last reached yesterday at 10:02.' });
    expect(reachLevel(reach(3, { lastReachedAt: '2026-10-09T23:30:00.000Z' }), now).detail).toBe('Last reached Oct 10 at 08:30.');
  });

  it('counts days since last reached when an older server leaves out missedDays', () => {
    const at = (lastReachedAt: string) => reachLevel({ lastReachedAt, ourFault: false }, now).severity;
    expect(at('2026-10-13T00:00:00.000Z')).toBe('good');
    expect(at('2026-10-12T14:59:00.000Z')).toBe('soon');
    expect(at('2026-10-12T15:00:00.000Z')).toBe('good');
    expect(at('2026-10-11T01:00:00.000Z')).toBe('today');
    expect(at('2026-10-01T01:00:00.000Z')).toBe('emergency');
  });
});

describe('indicators', () => {
  const keys = ['body', 'food', 'sleep', 'mood', 'social', 'activity', 'speech', 'calls', 'checked'];

  it('are the nine, in one fixed order, each with a description', () => {
    expect(INDICATORS.map((i) => i.key)).toEqual(keys);
    expect(INDICATORS.map((i) => i.label)).toEqual(['Body', 'Food', 'Sleep', 'Mood', 'Social', 'Activity', 'Speech', 'Calls', 'Checked']);
    for (const i of INDICATORS) expect(i.what).not.toBe('');
  });

  it('build from signals, with the call each domain came from', () => {
    const list = buildIndicators({ ...fine, domains: { ...allGood, food: 'concern', sleep: 'mixed' }, speech: 'clear_change', reach: reach(2), unchecked: 1 }, now);
    expect(list.map((i) => i.key)).toEqual(keys);
    expect(list.map((i) => i.severity)).toEqual(['good', 'today', 'soon', 'good', 'good', 'good', 'soon', 'today', 'system']);
    expect(list[1]).toMatchObject({ label: 'Food', word: 'Worth a call', detail: "Today's call, 10:02." });
  });

  it('read every missing input as no data, never good', () => {
    for (const s of [undefined, {}]) {
      const list = buildIndicators(s, now);
      expect(list).toHaveLength(9);
      expect(list.every((i) => i.severity === 'none')).toBe(true);
    }
    const noCall = buildIndicators({ latestCallAt: null, domains: null }, now);
    expect(noCall[0]).toMatchObject({ severity: 'none', word: 'No call' });
    const untagged = buildIndicators({ latestCallAt: '2026-10-13T01:02:00.000Z', domains: null }, now);
    expect(untagged[0]).toMatchObject({ severity: 'none', word: 'No details' });
    expect(buildIndicators({ domains: quiet }, now)[0]).toMatchObject({ severity: 'none', word: 'Not talked about' });
  });

  it('keep the mood slot but hide its state without agreement', () => {
    const list = buildIndicators({ ...fine, domains: { ...allGood, mood: 'concern' } }, now, { shareMood: false });
    expect(list[3]).toMatchObject({ key: 'mood', severity: 'none', word: 'Not shared' });
  });

  it('compact to what is worth a look plus one line for the rest', () => {
    const { attention, summary } = compactIndicators(buildIndicators({ ...fine, domains: { ...allGood, food: 'concern', sleep: 'unmentioned' } }, now));
    expect(attention.map((i) => i.key)).toEqual(['food']);
    expect(summary).toEqual({ text: '7 fine · 1 no data', detail: 'Fine: Body, Mood, Social, Activity, Speech, Calls, Checked. No data: Sleep.' });
    expect(compactIndicators(buildIndicators(fine, now)).summary?.text).toBe('9 fine');
    expect(compactIndicators(buildIndicators(undefined, now)).summary?.text).toBe('9 no data');
  });

  it('count unchecked calls per resident from the incomplete-analyses list', () => {
    const item = (residentId: string) => ({ residentId, residentName: '', callId: '', startedAt: '', localDate: '', parts: [], reasons: [], notChecked: '', checked: '', reanalysisRequested: false });
    const incomplete = { items: [item('res-1'), item('res-2'), item('res-1')], note: null };
    expect(uncheckedFor(incomplete, 'res-1')).toBe(2);
    expect(uncheckedFor(incomplete, 'res-3')).toBe(0);
    expect(uncheckedFor(undefined, 'res-1')).toBeUndefined();
  });
});

type Call = CaseDetail['calls'][number];
const call = (startedAt: string, status: string, o: Partial<Call> = {}): Call => ({ id: startedAt, startedAt, status, durationSec: null, summary: null, ...o });
const detail = (calls: Call[], o: Partial<CaseDetail> = {}): CaseDetail => ({
  case: {
    id: 'case-1', rule: 'R2', ruleName: '', urgency: 'urgent', urgencyLabel: '', urgencyMeaning: '', autoUrgency: 'urgent', staffUrgency: null,
    staffScoreOffset: 0, status: 'open', statusLabel: '', reason: '', score: 0, firstDetectedAt: '', updatedAt: '', notifications: [], outcome: null,
  },
  resident: {
    id: 'res-1', name: 'Margaret Ellis', preferredName: 'Margaret', phone: '', householdNotes: null, synthetic: true,
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
  },
  detections: [],
  calls,
  speechTrend: [],
  events: [],
  statusOptions: [],
  urgencyOptions: [],
  ...o,
});

describe('case page signals', () => {
  const wellbeing = { headline: null, domains: { ...quiet, food: 'concern' as const, sleep: 'good' as const }, tags: [] };

  it('read the latest connected call and reach from the calls on the page', () => {
    const s = caseSignals(detail([
      call('2026-10-11T01:00:00.000Z', 'completed', { wellbeing }),
      call('2026-10-12T01:00:00.000Z', 'no_answer'),
      call('2026-10-13T01:00:00.000Z', 'failed'),
      call('2026-10-13T02:00:00.000Z', 'failed', { trigger: 'staff' }),
    ]), now);
    expect(s.latestCallAt).toBe('2026-10-11T01:00:00.000Z');
    expect(s.domains).toEqual({ ...quiet, food: 'concern', sleep: 'good' });
    expect(s.reach).toEqual({ lastReachedAt: '2026-10-11T01:00:00.000Z', missedDays: 2, ourFault: true });
    expect(s.speech).toBeUndefined();
    expect(s.unchecked).toBeUndefined();
  });

  it('skip today until its call has happened, and stop at a day without attempts', () => {
    const pending = caseSignals(detail([call('2026-10-12T01:00:00.000Z', 'no_answer'), call('2026-10-13T01:00:00.000Z', 'scheduled')]), now);
    expect(pending.reach).toEqual({ lastReachedAt: null, missedDays: 1, ourFault: false });
    const gap = caseSignals(detail([call('2026-10-10T01:00:00.000Z', 'no_answer'), call('2026-10-12T01:00:00.000Z', 'no_answer')]), now);
    expect(gap.reach?.missedDays).toBe(1);
    const reached = caseSignals(detail([call('2026-10-13T01:00:00.000Z', 'no_answer'), call('2026-10-13T01:10:00.000Z', 'completed')]), now);
    expect(reached.reach).toMatchObject({ missedDays: 0 });
    expect(reached.domains).toBeNull();
  });

  it('take speech from an open R3 case, else from the speech chart', () => {
    const r3 = (autoUrgency: string, status = 'open') => detail([], { case: { ...detail([]).case, rule: 'R3', autoUrgency, status } });
    expect(caseSignals(r3('action'), now).speech).toBe('clear_change');
    expect(caseSignals(r3('watch'), now).speech).toBe('slight_change');
    expect(caseSignals(detail([], { speechBaseline: null }), now).speech).toBe('no_baseline');
    expect(caseSignals(r3('action', 'closed'), now).speech).toBeUndefined();
    const range = { mean: 1000, low: 800, high: 1200, n: 10 };
    const baseline = { from: '', to: '', callCount: 10, ranges: { responseLatencyMs: { transcript: range } } };
    const point = (v: number, usable = true) => ({ callId: 'c', at: '2026-10-12T01:00:00.000Z', features: { responseLatencyMs: v }, usable, measuredFrom: 'transcript' as const });
    expect(caseSignals(detail([], { speechBaseline: baseline, speechTrend: [point(1000)] }), now).speech).toBe('usual');
    expect(caseSignals(detail([], { speechBaseline: baseline, speechTrend: [point(1600)] }), now).speech).toBe('slight_change');
    expect(caseSignals(detail([], { speechBaseline: baseline, speechTrend: [point(1600, false)] }), now).speech).toBe('insufficient_recent');
  });

  it('prefer what the API sent', () => {
    const d = detail([call('2026-10-13T01:00:00.000Z', 'completed', { wellbeing })]);
    const s = caseSignals({ ...d, resident: { ...d.resident, signals: { reach: reach(3, { ourFault: true }), unchecked: 4 } } }, now);
    expect(s.reach).toEqual(reach(3, { ourFault: true }));
    expect(s.unchecked).toBe(4);
    expect(s.domains?.food).toBe('concern');
  });
});

describe('signal components', () => {
  const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it('draw nine indicators as a labelled list with one tab stop and a text label each', () => {
    const html = render(createElement(IndicatorBar, { signals: { ...fine, domains: { ...allGood, food: 'concern' } }, now }));
    expect(html).toContain('<ul class="sev-bar" aria-label="At a glance">');
    expect(html.match(/<li /g)).toHaveLength(9);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(8);
    expect(html).toContain('<span class="sr-only">Food: Worth a call</span>');
    expect(html).toContain('class="sev-ind sev-today"');
    expect(html).toContain('class="sev-tip"');
    expect(html).toContain('Today&#x27;s call, 10:02.');
    expect(html.indexOf('Body:')).toBeLessThan(html.indexOf('Checked:'));
  });

  it('compact to the indicators worth a look and a summary', () => {
    const html = render(createElement(IndicatorBar, { signals: { ...fine, reach: reach(1) }, now, compact: true }));
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('<span class="sr-only">Calls: No call for 1 day</span>');
    expect(html).toContain('sev-summary');
    expect(html).toContain('8 fine');
  });

  it('show chips with a decorative icon, a word and the severity for screen readers', () => {
    const today = render(createElement(SeverityChip, { severity: 'today' }));
    expect(today).toContain('class="sev-chip sev-today"');
    expect(today).toContain('class="sev-mark sev-today" aria-hidden="true"');
    expect(today).toContain('<span>Review today</span>');
    const chip = render(createElement(LastReachedChip, { reach: reach(3), now }));
    expect(chip).toContain('sev-emergency');
    expect(chip).toContain('<span class="sr-only">Act now: </span><span>No call for 3 days</span>');
    expect(chip).toContain('title="Last reached today at 10:02."');
    expect(render(createElement(LastReachedChip, { reach: reach(2, { ourFault: true }), now }))).toContain('sev-system');
  });

  it('let a chip whose word is a status or a fact say only that, or a prefix of its own', () => {
    const progress = render(createElement(SeverityChip, { severity: 'monitor', label: 'In progress', spoken: false }));
    expect(progress).toContain('<span>In progress</span>');
    expect(progress).not.toContain('sr-only');
    expect(render(createElement(SeverityChip, { severity: 'system', label: 'Approval needed', spoken: 'Waiting' }))).toContain(
      '<span class="sr-only">Waiting: </span><span>Approval needed</span>',
    );
    expect(render(createElement(SeverityChip, { severity: 'soon', label: 'No call for 1 day' }))).toContain('<span class="sr-only">Review soon: </span>');
  });

  it('give a legend of colors and indicators', () => {
    const html = render(createElement(SignalsLegend));
    for (const s of SEVERITIES) expect(html).toContain(`sev-chip sev-${s}`);
    for (const i of INDICATORS) expect(html).toContain(`<strong>${i.label}</strong>`);
  });
});
