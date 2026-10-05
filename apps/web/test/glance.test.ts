import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyDashboardView } from '../src/components/FamilyDashboardView';
import {
  cellState,
  dayLabel,
  dayOfMonth,
  domainState,
  glanceHeadline,
  isOneOff,
  latestCallLabel,
  LEGEND,
  staffTagLine,
  STATES,
  trendChange,
  trendCount,
  worthAsking,
} from '../src/glance';
import type { DomainStates, FamilyDashboard, TagTrend } from '../src/types';

const quiet: DomainStates = { body: 'unmentioned', food: 'unmentioned', sleep: 'unmentioned', mood: 'unmentioned', social: 'unmentioned', activity: 'unmentioned' };
const today: DomainStates = { ...quiet, body: 'mixed', food: 'concern', sleep: 'good' };
const trend = (o: Partial<TagTrend> = {}): TagTrend => ({
  id: 'food.ate_little',
  label: 'Ate little',
  domain: 'food',
  polarity: 'concern',
  last: 4,
  previous: 1,
  lastCalls: 7,
  previousCalls: 7,
  direction: 'more',
  ...o,
});

describe('glance helpers', () => {
  it('gives every state a symbol and a word, and never shows silence as good', () => {
    for (const s of Object.values(STATES)) {
      expect(s.symbol).not.toBe('');
      expect(s.word).not.toBe('');
    }
    expect(new Set(LEGEND.map((s) => STATES[s].symbol)).size).toBe(LEGEND.length);
    expect(STATES.unmentioned.tone).not.toBe(STATES.good.tone);
    expect(STATES.nodata.tone).toBe('unmentioned');
  });

  it('reads cell states from days, treating calls without tags as no details', () => {
    expect(cellState({ date: '2026-10-01', tagged: true, domains: today }, 'food')).toBe('concern');
    expect(cellState({ date: '2026-10-01', tagged: false, domains: quiet }, 'food')).toBe('nodata');
    expect(cellState({ date: '2026-10-01', tagged: false, domains: null }, 'food')).toBe('nocall');
    expect(domainState(today, 'sleep')).toBe('good');
    expect(domainState(null, 'sleep')).toBe('nodata');
    expect(domainState({} as DomainStates, 'sleep')).toBe('unmentioned');
  });

  it('labels days and the latest call in Japan time', () => {
    expect(dayLabel('2026-10-01')).toBe('1 Oct');
    expect(dayOfMonth('2026-09-07')).toBe('7');
    const now = new Date('2026-10-05T05:00:00.000Z');
    expect(latestCallLabel('2026-10-05T01:02:00.000Z', now)).toBe("Today's call, 10:02");
    expect(latestCallLabel('2026-10-04T01:02:00.000Z', now)).toBe("Yesterday's call, 10:02");
    expect(latestCallLabel('2026-10-01T01:02:00.000Z', now)).toBe('Latest call, 1 Oct, 10:02');
  });

  it('falls back to a neutral headline and suggests asking only when there is a concern', () => {
    expect(glanceHeadline(null)).toMatch(/No calls have connected/);
    expect(glanceHeadline({ startedAt: '', headline: 'Maggie enjoyed her walk.', domains: quiet })).toBe('Maggie enjoyed her walk.');
    expect(glanceHeadline({ startedAt: '', headline: null, domains: quiet })).toBe('Here is what came up in the latest call.');
    expect(glanceHeadline({ startedAt: '', headline: null, domains: null })).toBe('There are no details for the latest call yet.');
    expect(worthAsking({ startedAt: '', headline: null, domains: today })).toBe(true);
    expect(worthAsking({ startedAt: '', headline: null, domains: { ...today, food: 'mixed' } })).toBe(false);
    expect(worthAsking(null)).toBe(false);
  });

  it('describes tag trends in words', () => {
    expect(trendCount(trend())).toBe('4 of last 7 calls');
    expect(trendCount(trend({ last: 1, lastCalls: 1 }))).toBe('1 of last 1 call');
    expect(trendChange(trend())).toBe('more often (was 1 of 7)');
    expect(trendChange(trend({ direction: 'less', previous: 5 }))).toBe('less often (was 5 of 7)');
    expect(trendChange(trend({ direction: 'same' }))).toBe('about the same as before');
    expect(trendChange(trend({ direction: null }))).toBe('');
    expect(isOneOff(trend({ last: 1 }))).toBe(true);
    expect(isOneOff(trend())).toBe(false);
  });

  it('shows staff the basis, confidence, turn and who may see a tag', () => {
    const t = { id: 'mood.lonely', label: 'Lonely', domain: 'mood', polarity: 'concern' as const, turn: 7, basis: 'inferred' as const, confidence: 0.784, quote: 'x' };
    expect(staffTagLine({ ...t, audience: 'family_with_consent' })).toBe('Lonely · inferred 78% · turn 7 · family only with consent');
    expect(staffTagLine({ ...t, audience: 'staff' })).toContain('staff only');
    expect(staffTagLine({ ...t, audience: 'family' })).toBe('Lonely · inferred 78% · turn 7');
  });
});

describe('family dashboard view', () => {
  const now = new Date('2026-10-05T05:00:00.000Z');
  const data: FamilyDashboard = {
    resident: { id: 'res-1', name: 'Margaret Smith' },
    nextCallAt: '2026-10-06T01:00:00.000Z',
    glance: {
      latest: { startedAt: '2026-10-05T01:02:00.000Z', headline: 'Margaret ate little today but enjoyed a chat.', domains: today },
      days: [
        { date: '2026-10-03', tagged: false, domains: null },
        { date: '2026-10-04', tagged: false, domains: quiet },
        { date: '2026-10-05', tagged: true, domains: today },
      ],
      trends: [trend(), trend({ id: 'activity.gardening', label: 'Gardening', domain: 'activity', polarity: 'positive', last: 1, previous: 5, direction: 'less' })],
    },
    calls: [
      {
        startedAt: '2026-10-05T01:02:00.000Z',
        connected: true,
        durationSec: 360,
        summary: { health: 'A little tired', meals: 'Ate very little', topics: ['grandson'] },
        headline: 'Margaret ate little today but enjoyed a chat.',
        domains: today,
        tags: [{ id: 'food.ate_little', label: 'Ate little', domain: 'food', polarity: 'concern' }],
      },
      { startedAt: '2026-10-03T01:00:00.000Z', connected: false, durationSec: null, summary: null },
    ],
    alerts: [],
    staff: { name: 'Tanaka', phone: '+81300000000', email: null },
  };
  const html = renderToStaticMarkup(createElement(FamilyDashboardView, { data, now }));

  it('leads with the headline and the six areas, each with a symbol and a word', () => {
    expect(html.indexOf('Margaret ate little today but enjoyed a chat.')).toBeLessThan(html.indexOf('The last two weeks at a glance'));
    expect(html).toContain("Today&#x27;s call, 10:02");
    for (const label of ['Body', 'Food', 'Sleep', 'Mood', 'Social', 'Activity']) expect(html).toContain(`<span class="glance-domain">${label}</span>`);
    expect(html).toContain('<span class="glance-word">Worth a call</span>');
    expect(html).toContain('<span class="glance-word">Some concern</span>');
    expect(html).toContain('<span class="glance-word">Not talked about</span>');
    expect(html).toContain('may be worth asking about');
  });

  it('draws a 14-day table with text alternatives and dashed days without a call', () => {
    expect(html).toContain('<th scope="row">Food</th>');
    expect(html).toContain('title="Food, 3 Oct: No call"');
    expect(html).toContain('title="Food, 4 Oct: No details"');
    expect(html).toContain('title="Food, 5 Oct: Worth a call"');
    expect(html).toContain('class="glance-cell state-nocall"');
    expect(html).toContain('<span class="sr-only">Worth a call</span>');
    expect(html).toContain('does not mean all is well');
  });

  it('lists what keeps coming up, muting one-offs', () => {
    expect(html).toContain('4 of last 7 calls · more often (was 1 of 7)');
    expect(html).toContain('Ate little<span class="sr-only"> (concern)</span>');
    expect(html).toContain('Gardening<span class="sr-only"> (good sign)</span>');
    expect(html).toContain('<li class="muted">');
    expect(html).toContain('less often (was 5 of 7)');
  });

  it('keeps the per-call notes, collapsed, with the family tags', () => {
    expect(html).toContain('<details><summary>Show the last two weeks (2 calls)</summary>');
    expect(html).toContain('<strong>Meals.</strong> Ate very little');
    expect(html).toContain('class="tag concern"');
  });

  it('works with servers older than tags', () => {
    const { glance: _g, ...old } = data;
    const plain = renderToStaticMarkup(createElement(FamilyDashboardView, { data: { ...old, calls: [{ ...data.calls[1]! }] }, now }));
    expect(plain).toContain('Daily calls with Margaret Smith');
    expect(plain).not.toContain('glance');
    expect(plain).not.toContain('tag-list');
  });
});
