import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeechTrendCard } from '../src/components/SpeechTrendCard';
import { exclusionLabel, formatDay, layout, speechCharts } from '../src/speech';
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
    expect(latency.range).toEqual(range(900, 600, 1200));
    expect(latency.outsideNow).toBe(true);
    expect(latency.points.map((p) => p.side)).toEqual([null, 'above', null, 'above', 'above']);
    expect(latency.summary).toBe(
      `Usual range 0.6 s to 1.2 s. Latest 5.0 s on ${formatDay(at(5))}, slower than usual. ` +
        `Outside the usual range for the last 3 calls, since ${formatDay(at(2))}. ` +
        '1 call not counted (shown hollow). 1 call measured a different way not shown.',
    );
  });

  it('marks calls left out, e.g. for a cold, without counting them', () => {
    const excluded = byKey.responseLatencyMs!.points.find((p) => !p.counted)!;
    expect(excluded.side).toBeNull();
    expect(excluded.label).toBe(`${formatDay(at(3))}: 9.0 s, not counted: temporary condition such as a cold`);
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

  it('lays points out over time inside the band scale', () => {
    const l = layout(byKey.responseLatencyMs!);
    expect(l.points[0]!.x).toBe(8);
    expect(l.points.at(-1)!.x).toBe(292);
    expect(l.band!.y).toBeGreaterThan(l.points.at(-1)!.y);
    expect(l.line.split(' ')).toHaveLength(4);
    const flat = layout(speechCharts([point(0)], null)[0]!);
    expect(flat.points[0]).toMatchObject({ x: 150, y: 45 });
    expect(flat.band).toBeNull();
  });
});

describe('SpeechTrendCard', () => {
  it('renders an accessible chart per feature with a text alternative', () => {
    const html = renderToStaticMarkup(createElement(SpeechTrendCard, { trend, baseline }));
    expect(html).toContain('Outside the usual range in the latest call: Response time, Vocabulary variety.');
    expect(html).toContain(`Usual range from 8 calls, ${formatDay(baseline.from)} to ${formatDay(baseline.to)}.`);
    expect(html.match(/<svg /g)).toHaveLength(4);
    expect(html.match(/role="img"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Response time over recent calls"');
    expect(html).toContain('class="speech-excluded"');
    expect(html).toContain('class="speech-outside"');
    expect(html).toContain('not counted: temporary condition such as a cold');
    expect(html).toContain('<details>');
  });

  it('says when everything is within the usual range, or no range exists yet', () => {
    expect(renderToStaticMarkup(createElement(SpeechTrendCard, { trend: [point(0)], baseline }))).toContain('within the usual range for every measure');
    const none = renderToStaticMarkup(createElement(SpeechTrendCard, { trend: [point(0, { topicCoherence: null })], baseline: null }));
    expect(none).toContain('No usual range yet.');
    expect(none.match(/<svg /g)).toHaveLength(3);
  });
});
