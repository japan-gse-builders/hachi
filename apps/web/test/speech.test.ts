import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeechTrendCard } from '../src/components/SpeechTrendCard';
import {
  dateLabelIndexes,
  exclusionLabel,
  formatDay,
  niceTicks,
  plotChart,
  shortValue,
  speechCharts,
  speechOverall,
  speechProgress,
  USUAL_RANGE_CALLS,
} from '../src/speech';
import type { SpeechBaseline, SpeechPoint } from '../src/types';

const at = (day: number) => new Date(Date.parse('2026-09-01T01:00:00.000Z') + day * 86_400_000).toISOString();

function point(day: number, o: Partial<Record<string, number | null>> = {}, extra: Partial<SpeechPoint> = {}): SpeechPoint {
  return {
    callId: `c${day}`,
    at: at(day),
    features: { lexicalDiversity: 0.8, repairRate: 2, responseLatencyMs: 900, topicCoherence: 0.9, ...o },
    usable: true,
    exclusionReasons: [],
    measuredFrom: 'audio',
    ...extra,
  };
}

const range = (mean: number, low: number, high: number) => ({ mean, low, high, n: 8 });
const baseline: SpeechBaseline = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-29T00:00:00.000Z',
  callCount: 8,
  ranges: {
    responseLatencyMs: { audio: range(900, 600, 1200), transcript: range(3000, 2000, 4000) },
    repairRate: { audio: range(2, 0, 4) },
    lexicalDiversity: { audio: range(0.8, 0.7, 0.9), transcript: range(0.8, 0.7, 0.9) },
  },
};

const trend: SpeechPoint[] = [
  point(0),
  point(1, { responseLatencyMs: 3100 }, { measuredFrom: 'transcript' }),
  point(2, { responseLatencyMs: 2500 }),
  point(3, { responseLatencyMs: 9000 }, { usable: false, exclusionReasons: ['temporary_condition'] }),
  point(4, { responseLatencyMs: 4000 }),
  point(5, { responseLatencyMs: 5000, lexicalDiversity: 0.6 }),
];

describe('speech charts (R3)', () => {
  const charts = speechCharts(trend, baseline);
  const byKey = Object.fromEntries(charts.map((c) => [c.key, c]));

  it('shows which feature moved and since when, in words', () => {
    const latency = byKey.responseLatencyMs!;
    expect(latency.title).toBe('Time to answer');
    expect(latency.range).toEqual(range(900, 600, 1200));
    expect(latency.rangeText).toBe('0.6 to 1.2 s');
    expect(latency.outsideNow).toBe(true);
    expect(latency.points.map((p) => p.side)).toEqual([null, 'above', null, 'above', 'above']);
    expect(latency.summary).toBe(
      `Usual range 0.6 to 1.2 s. Latest 5.0 s on ${formatDay(at(5))}, slower than usual. ` +
        `Outside the usual range for the last 3 calls, since ${formatDay(at(2))}. ` +
        '1 call not counted (shown hollow). 1 call measured a different way not shown.',
    );
  });

  it('names each measure plainly and says how far it has moved', () => {
    expect(charts.map((c) => c.title)).toEqual(['Time to answer', 'Stops and restarts', 'Word variety', 'Staying on topic']);
    const latency = byKey.responseLatencyMs!;
    expect(latency.streak).toBe(3);
    expect(latency.status).toBe('clear_change');
    expect(latency.headline).toBe(`Slower than usual for the last 3 calls, since ${formatDay(at(2))}.`);
    const words = byKey.lexicalDiversity!;
    expect(words.status).toBe('slight_change');
    expect(words.headline).toBe('Less varied than usual in the latest call.');
    expect(words.rangeText).toBe('70% to 90% of words not repeated');
    expect(byKey.repairRate!.status).toBe('usual');
    expect(byKey.repairRate!.headline).toBe('Within the usual range in the latest call.');
    expect(byKey.topicCoherence!.status).toBe('no_baseline');
    expect(speechCharts([point(0, {}, { usable: false })], baseline)[0]!.status).toBe('insufficient_recent');
  });

  it('sums the measures up with the biggest change first', () => {
    expect(speechOverall(charts)).toBe('clear_change');
    expect(speechOverall(speechCharts([point(0, { lexicalDiversity: 0.6 })], baseline))).toBe('slight_change');
    expect(speechOverall(speechCharts([point(0)], baseline))).toBe('usual');
    expect(speechOverall(speechCharts([point(0)], null))).toBe('no_baseline');
    expect(speechOverall([])).toBe('no_baseline');
  });

  it('marks calls left out, e.g. for a cold, without counting them', () => {
    const excluded = byKey.responseLatencyMs!.points.find((p) => !p.counted)!;
    expect(excluded.side).toBeNull();
    expect(excluded.label).toBe(`${formatDay(at(3))}: 9.0 s, not counted: temporary condition such as a cold`);
    expect(excluded.note).toBe('not counted: temporary condition such as a cold');
    expect(exclusionLabel(['too_little_speech', 'poor_audio', 'background_noise', 'new_reason'])).toBe('too little speech, poor line, background noise, new reason');
    expect(exclusionLabel(undefined)).toBe('not usable');
  });

  it('describes a single outlier and a scattered pattern differently', () => {
    const lex = byKey.lexicalDiversity!;
    expect(lex.summary).toContain('less varied than usual');
    expect(lex.summary).not.toContain('Outside the usual range');
    const scattered = speechCharts([point(0, { lexicalDiversity: 0.6 }), point(1), point(2, { lexicalDiversity: 0.95 }), point(3)], baseline)[2]!;
    expect(scattered.outsideNow).toBe(false);
    expect(scattered.summary).toContain('within the usual range. Outside the usual range in 2 of the last 4 calls.');
    expect(scattered.points[2]!.label).toContain('more varied than usual');
    expect(speechCharts([point(0, { repairRate: 0 })], { ...baseline, ranges: { repairRate: { audio: range(2, 1, 4) } } })[1]!.summary).toContain('fewer than usual');
  });

  it('explains when there is no usual range or nothing to show', () => {
    const none = speechCharts(trend, null);
    expect(none[0]!.range).toBeNull();
    expect(none[0]!.summary).toMatch(/^No usual range yet/);
    expect(none[0]!.outsideNow).toBe(false);
    expect(byKey.topicCoherence!.range).toBeNull();
    const empty = speechCharts([point(0, {}, { usable: false })], baseline)[0]!;
    expect(empty.summary).toContain('No counted calls yet.');
    expect(speechCharts([point(0, { responseLatencyMs: null })], undefined)[0]!.points).toEqual([]);
  });

  it('uses transcript timings when recent calls were measured that way, and older servers without method or usable flags', () => {
    const old: SpeechPoint[] = [0, 1, 2].map((d) => ({ callId: `o${d}`, at: at(d), features: { responseLatencyMs: 3000 + d * 100 } }));
    const c = speechCharts(old, baseline)[0]!;
    expect(c.range).toEqual(range(3000, 2000, 4000));
    expect(c.points.every((p) => p.counted && p.side === null)).toBe(true);
  });

  it('writes values in the axis units for tables', () => {
    expect(shortValue('responseLatencyMs', 2440)).toBe('2.4 s');
    expect(shortValue('lexicalDiversity', 0.624)).toBe('62%');
    expect(shortValue('topicCoherence', 0.9)).toBe('90');
    expect(shortValue('repairRate', 2)).toBe('2.0');
    expect(shortValue('unknown', 3)).toBe('3');
  });
});

describe('thin data', () => {
  it('counts towards the usual range instead of drawing a few loose points', () => {
    expect(speechProgress(trend, baseline)).toBeNull();
    expect(speechProgress(trend, null)).toEqual({ collected: 5, needed: USUAL_RANGE_CALLS, stalled: false });
    expect(speechProgress([], undefined)).toEqual({ collected: 0, needed: 8, stalled: false });
  });

  it('says when enough calls came in but the range still could not be set', () => {
    const many = Array.from({ length: 10 }, (_, d) => point(d));
    expect(speechProgress(many, null)).toEqual({ collected: 8, needed: 8, stalled: true });
  });
});

describe('axis', () => {
  it('picks round steps of 1, 2, 2.5 or 5 and never more ticks than asked', () => {
    expect(niceTicks(0.6, 5, 5)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(1.25, 2.4, 4)).toEqual([1, 1.5, 2, 2.5]);
    expect(niceTicks(62, 95, 5)).toEqual([60, 70, 80, 90, 100]);
    expect(niceTicks(0.2, 0.9, 6)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    for (const [lo, hi, n] of [[0.6, 5, 5], [3, 3, 5], [0, 100, 1], [0.013, 0.071, 3], [1200, 9000, 4]] as const) {
      const t = niceTicks(lo, hi, n);
      expect(t.length).toBeLessThanOrEqual(Math.max(2, n));
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t.at(-1)).toBeGreaterThanOrEqual(hi);
    }
  });

  it('opens a flat line out around its value', () => {
    expect(niceTicks(3, 3, 5)).toEqual([2, 2.5, 3, 3.5, 4]);
    expect(niceTicks(0, 100, 1)).toEqual([0, 100]);
    expect(niceTicks(0, 0, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0.9, 0.9, 5)[0]).toBeGreaterThanOrEqual(0);
    expect(niceTicks(-3, -1, 3)).toEqual([-3, -2, -1]);
  });

  it('labels fewer dates as the chart narrows, always the first and the last, never closer than 80px', () => {
    const xs = (n: number, width: number) => Array.from({ length: n }, (_, i) => (i * width) / (n - 1));
    expect(dateLabelIndexes(xs(12, 300), 300)).toEqual([0, 4, 7, 11]);
    expect(dateLabelIndexes(xs(12, 160), 160)).toEqual([0, 11]);
    expect(dateLabelIndexes(xs(3, 600), 600)).toEqual([0, 1, 2]);
    expect(dateLabelIndexes([50], 300)).toEqual([0]);
    expect(dateLabelIndexes([], 300)).toEqual([]);
    const crowded = [0, 10, 20, 200, 210, 300];
    const picked = dateLabelIndexes(crowded, 300);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(5);
    for (let i = 1; i < picked.length; i++) expect(crowded[picked[i]!]! - crowded[picked[i - 1]!]!).toBeGreaterThanOrEqual(80);
  });
});

describe('plot', () => {
  const latency = speechCharts(trend, baseline)[0]!;

  it('lays points out over time on round ticks in seconds, with the usual band', () => {
    const p = plotChart(latency, 560, 236);
    expect(p.yTicks.map((t) => t.label)).toEqual(['0.0 s', '2.5 s', '5.0 s', '7.5 s', '10.0 s']);
    expect(p.yTicks[0]!.y).toBe(p.bottom);
    expect(p.yTicks.at(-1)!.y).toBe(p.top);
    expect(p.points[0]!.x).toBe(p.left + 10);
    expect(p.points.at(-1)!.x).toBe(p.right - 10);
    expect(p.band!.y).toBeLessThan(p.band!.mean);
    expect(p.band!.mean).toBeLessThan(p.band!.y + p.band!.height);
    expect(p.band!.y).toBeGreaterThan(p.points.at(-1)!.y);
    expect(p.line.split(' ')).toHaveLength(4);
  });

  it('gives every call a touch column, edge to edge without gaps', () => {
    const p = plotChart(latency, 560, 236);
    expect(p.points[0]!.hitX).toBe(p.left);
    const last = p.points.at(-1)!;
    expect(last.hitX + last.hitWidth).toBeCloseTo(p.right, 0);
    for (let i = 1; i < p.points.length; i++) {
      const prev = p.points[i - 1]!;
      expect(p.points[i]!.hitX).toBeCloseTo(prev.hitX + prev.hitWidth, 0);
    }
  });

  it('uses fewer value lines when shorter and fewer dates when narrower, rather than smaller text', () => {
    const many = Array.from({ length: 14 }, (_, d) => point(d, { responseLatencyMs: 800 + d * 30 }));
    const chart = speechCharts(many, baseline)[0]!;
    const wide = plotChart(chart, 640, 236);
    const narrow = plotChart(chart, 280, 120);
    expect(narrow.yTicks.length).toBeLessThan(wide.yTicks.length);
    expect(narrow.xTicks.length).toBeLessThan(wide.xTicks.length);
    expect(narrow.xTicks[0]!.anchor).toBe('start');
    expect(narrow.xTicks.at(-1)!.anchor).toBe('end');
  });

  it('centres a single call and leaves room for the longest value label', () => {
    const one = plotChart(speechCharts([point(0)], null)[0]!, 300, 200);
    expect(one.points[0]!.x).toBe((one.left + one.right) / 2);
    expect(one.band).toBeNull();
    expect(one.xTicks).toEqual([{ x: one.points[0]!.x, label: formatDay(at(0)), anchor: 'middle' }]);
    expect(one.yTicks.map((t) => t.label)).toEqual(['0.6 s', '0.8 s', '1.0 s', '1.2 s']);
    expect(plotChart(latency, 300, 200).left).toBeGreaterThan(one.left);
    const words = plotChart(speechCharts(trend, baseline)[2]!, 300, 200);
    expect(words.yTicks.every((t) => t.label.endsWith('%'))).toBe(true);
  });
});

describe('SpeechTrendCard', () => {
  const render = (props: Parameters<typeof SpeechTrendCard>[0]) => renderToStaticMarkup(createElement(SpeechTrendCard, props));

  it('leads with a chip per measure and opens the chart on the first that moved', () => {
    const html = render({ trend, baseline, name: 'Margaret' });
    expect(html).toContain('Changed in the latest call: Time to answer, Word variety.');
    expect(html).toContain(`Usual range from 8 calls, ${formatDay(baseline.from)} to ${formatDay(baseline.to)}.`);
    expect(html).toContain('Time to answer: clear change');
    expect(html).toContain('Stops and restarts: as usual');
    expect(html).toContain('Staying on topic: no usual range yet');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/<svg class="speech-svg"/g)).toHaveLength(1);
    expect(html).toContain('Usual for Margaret');
    expect(html).toContain('Seconds');
    expect(html).toContain('class="speech-dot-skip"');
    expect(html).toContain('class="speech-dot-out"');
  });

  it('gives each call a focusable button named in words, one tab stop for the chart', () => {
    const html = render({ trend, baseline, name: 'Margaret' });
    expect(html.match(/class="speech-hit"/g)).toHaveLength(5);
    expect(html.match(/class="speech-hit"[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${formatDay(at(3))}: 9.0 s, not counted: temporary condition such as a cold"`);
    expect(html).toContain(`aria-label="${formatDay(at(5))}: 5.0 s, slower than usual"`);
    expect(html).toContain('<svg class="speech-svg" width="560" height="236" viewBox="0 0 560 236" aria-hidden="true"');
  });

  it('keeps the numbers as a table for anyone who cannot see the chart', () => {
    const html = render({ trend, baseline });
    expect(html).toContain('Numbers for each call');
    expect(html).toContain('<th scope="col">Time to answer <span class="meta">seconds</span></th>');
    expect(html).toContain('<td>5.0 s</td>');
    expect(html).toContain('No: temporary condition such as a cold');
  });

  it('shows no chart until a measure is chosen when everything is within the usual range', () => {
    const html = render({ trend: [point(0)], baseline });
    expect(html).toContain('within the usual range for every measure');
    expect(html).not.toContain('<svg class="speech-svg"');
    expect(html).toContain('Choose a measure');
  });

  it('shows how far the usual range has got instead of a chart while there is none', () => {
    const html = render({ trend, baseline: null, name: 'Arthur' });
    expect(html).toContain('Usual range: 5 of 8 calls collected');
    expect(html).toContain('3 more to go.');
    expect(html).not.toContain('<svg class="speech-svg"');
    expect(html).not.toContain('Changed in the latest call');
    expect(html.match(/class="is-done"/g)).toHaveLength(5);
  });
});
