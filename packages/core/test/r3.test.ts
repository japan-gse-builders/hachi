import { describe, expect, it } from 'vitest';
import {
  assessSpeechChange,
  buildBaseline,
  describeFeatureChange,
  describeTrend,
  extractSpeechSample,
  mattr,
  median,
  medianResponseLatency,
  MIN_BASELINE_CALLS,
  repairRate,
  tokenize,
  usualRange,
  type CallSpeechSample,
  type SpeechFeatures,
  type Turn,
} from '../src/r3.js';

const START = '2026-08-01T00:00:00.000Z';
const day = (n: number) => new Date(Date.parse(START) + n * 86_400_000 + 9 * 3_600_000).toISOString();

function sample(n: number, features: Partial<SpeechFeatures>, usable = true): CallSpeechSample {
  return {
    callId: `c${n}`,
    at: day(n),
    features: { lexicalDiversity: 0.7, repairRate: 2, responseLatencyMs: 900, topicCoherence: 0.85, ...features },
    usable,
    exclusionReasons: usable ? [] : ['background_noise'],
  };
}

/** 4 weeks of stable calls with small natural variation. */
function baselineSamples(): CallSpeechSample[] {
  const jitter = [0, 0.01, -0.01, 0.02, -0.02, 0.005, -0.005, 0.015, -0.015, 0];
  return Array.from({ length: 20 }, (_, i) =>
    sample(i, {
      lexicalDiversity: 0.7 + jitter[i % 10]!,
      repairRate: 2 + jitter[i % 10]! * 20,
      responseLatencyMs: 900 + jitter[i % 10]! * 5000,
      topicCoherence: 0.85 + jitter[i % 10]!,
    }),
  );
}

describe('text features (SPK-01)', () => {
  it('tokenizes words, keeping apostrophes', () => {
    expect(tokenize("I don’t know, it's   FINE!")).toEqual(['i', "don't", 'know', "it's", 'fine']);
    expect(tokenize('')).toEqual([]);
  });

  it('computes MATTR', () => {
    expect(mattr([])).toBeNull();
    expect(mattr(['a', 'b', 'a', 'b'])).toBe(0.5);
    const varied = Array.from({ length: 120 }, (_, i) => `w${i}`);
    expect(mattr(varied)).toBe(1);
    const repetitive = Array.from({ length: 120 }, (_, i) => `w${i % 10}`);
    expect(mattr(repetitive)).toBeCloseTo(10 / 50, 5);
  });

  it('counts self-repairs, fillers, repetitions and cut-off words', () => {
    expect(repairRate('')).toBeNull();
    expect(repairRate('I went to the shop')).toBe(0);
    // "um", "the the", "I mean", "sho-" over 12 tokens
    const text = 'Um I went to the the sho- shop, I mean the market';
    expect(repairRate(text)).toBeCloseTo((4 / tokenize(text).length) * 100, 5);
  });

  it('computes the median agent-to-resident response latency', () => {
    const turns: Turn[] = [
      { speaker: 'agent', text: 'Hi', startMs: 0, endMs: 1000 },
      { speaker: 'resident', text: 'Hello', startMs: 1800, endMs: 2500 },
      { speaker: 'agent', text: 'How are you?', startMs: 2600, endMs: 3500 },
      { speaker: 'resident', text: 'Fine', startMs: 5500, endMs: 6000 },
      { speaker: 'resident', text: 'Thanks', startMs: 9000, endMs: 9500 },
      { speaker: 'agent', text: 'Good', startMs: 9600, endMs: 10000 },
      { speaker: 'resident', text: 'Yes', startMs: 11000, endMs: 11500 },
      { speaker: 'agent', text: 'Overlap', startMs: 11400, endMs: 12000 },
      { speaker: 'resident', text: 'barge-in', startMs: 11900, endMs: 12500 },
      { speaker: 'agent', text: 'Long', startMs: 13000, endMs: 14000 },
      { speaker: 'resident', text: 'after a pause of 30s', startMs: 44000, endMs: 45000 },
    ];
    expect(medianResponseLatency(turns)).toBe(1000);
    expect(medianResponseLatency([])).toBeNull();
  });

  it('median handles odd, even and empty arrays', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('extractSpeechSample (SPK-04)', () => {
  const longText = Array.from({ length: 80 }, (_, i) => `word${i % 40}`).join(' ');
  const turns: Turn[] = [
    { speaker: 'agent', text: 'Good morning', startMs: 0, endMs: 1000 },
    { speaker: 'resident', text: longText, startMs: 1500, endMs: 30000 },
  ];

  it('is usable when there is enough clean speech', () => {
    const s = extractSpeechSample('c1', day(0), turns, 0.9, { audioQuality: 0.9 });
    expect(s.usable).toBe(true);
    expect(s.features.responseLatencyMs).toBe(500);
    expect(s.features.topicCoherence).toBe(0.9);
    expect(s.features.lexicalDiversity).toBeGreaterThan(0);
  });

  it('excludes calls that are short, noisy, low quality, or affected by a temporary condition', () => {
    const short = extractSpeechSample('c2', day(0), [{ speaker: 'resident', text: 'Fine thanks', startMs: 0, endMs: 1 }], null);
    expect(short.usable).toBe(false);
    expect(short.exclusionReasons).toEqual(['too_little_speech']);
    const bad = extractSpeechSample('c3', day(0), turns, 0.9, { audioQuality: 0.3, noisy: true, temporaryCondition: true });
    expect(bad.exclusionReasons).toEqual(['poor_audio', 'background_noise', 'temporary_condition']);
  });

  it('takes response time and repairs from the recording when it was measured', () => {
    const examples = [{ kind: 'false_start' as const, quote: 'vi- visiting', startMs: 67200 }];
    const s = extractSpeechSample('c1', day(0), turns, 0.9, {}, { responseLatencyMs: 1740, repairRate: 2.5, examples });
    expect(s.features).toMatchObject({ responseLatencyMs: 1740, repairRate: 2.5 });
    expect(s.measuredFrom).toBe('audio');
    expect(s.examples).toEqual(examples);
    expect(extractSpeechSample('c1', day(0), turns, 0.9, {}, { responseLatencyMs: null, repairRate: null, examples: [] })).not.toHaveProperty('examples');
  });

  it('measures only the words when the recording could not be used', () => {
    const s = extractSpeechSample('c1', day(0), turns, 0.9, {}, 'unavailable');
    expect(s.features).toMatchObject({ responseLatencyMs: null, repairRate: null, topicCoherence: 0.9 });
    expect(s.features.lexicalDiversity).not.toBeNull();
    expect(s.measuredFrom).toBe('text_only');
    expect(extractSpeechSample('c1', day(0), turns, 0.9).measuredFrom).toBe('transcript');
  });
});

describe('buildBaseline (SPK-02)', () => {
  it('requires enough usable calls within the first 4 weeks', () => {
    expect(buildBaseline(baselineSamples().slice(0, MIN_BASELINE_CALLS - 1), START)).toBeNull();
    const withUnusable = baselineSamples().map((s, i) => (i >= MIN_BASELINE_CALLS - 1 ? { ...s, usable: false } : s));
    expect(buildBaseline(withUnusable, START)).toBeNull();
  });

  it('ignores calls outside the baseline window', () => {
    const outside = Array.from({ length: 10 }, (_, i) => sample(40 + i, {}));
    expect(buildBaseline(outside, START)).toBeNull();
  });

  it('computes mean and sample standard deviation per feature', () => {
    const b = buildBaseline(baselineSamples(), START)!;
    expect(b.callCount).toBe(20);
    expect(b.stats.lexicalDiversity!.mean).toBeCloseTo(0.7, 5);
    expect(b.stats.lexicalDiversity!.std).toBeGreaterThan(0);
    expect(b.timing.transcript!.responseLatencyMs!.n).toBe(20);
  });

  it('skips features that are missing too often', () => {
    const samples = baselineSamples().map((s) => ({ ...s, features: { ...s.features, topicCoherence: null } }));
    const b = buildBaseline(samples, START)!;
    expect(b.stats.topicCoherence).toBeUndefined();
    expect(b.timing.transcript!.repairRate).toBeDefined();
  });

  it('keeps response time and repairs from recordings apart from transcript timings', () => {
    const audio = baselineSamples().slice(0, 10).map((s) => ({ ...s, measuredFrom: 'audio' as const, features: { ...s.features, responseLatencyMs: 1700 } }));
    const b = buildBaseline([...audio, ...baselineSamples().slice(10)], START)!;
    expect(b.stats.lexicalDiversity!.n).toBe(20);
    expect(b.timing.audio!.responseLatencyMs).toMatchObject({ mean: 1700, n: 10 });
    expect(b.timing.transcript!.responseLatencyMs!.n).toBe(10);
    const few = buildBaseline([...audio.slice(0, MIN_BASELINE_CALLS - 1), ...baselineSamples().slice(10)], START)!;
    expect(few.timing.audio).toBeUndefined();
  });
});

describe('assessSpeechChange (SPK-02, SPK-03)', () => {
  const baseline = buildBaseline(baselineSamples(), START)!;

  it('reports no baseline or too few recent calls', () => {
    expect(assessSpeechChange([], null).status).toBe('no_baseline');
    expect(assessSpeechChange([sample(30, {}), sample(31, {})], baseline).status).toBe('insufficient_recent');
  });

  it('finds no change when recent calls match the baseline', () => {
    const recent = [30, 31, 32, 33, 34].map((n) => sample(n, {}));
    const r = assessSpeechChange([...baselineSamples(), ...recent], baseline);
    expect(r.status).toBe('assessed');
    expect(r.urgency).toBeNull();
    expect(r.contributors).toEqual([]);
    expect(r.trend).toBe('stable');
  });

  it('flags a clear, worsening change and names the contributing features', () => {
    const recent = [30, 31, 32, 33, 34].map((n, i) =>
      sample(n, { responseLatencyMs: 1400 + i * 400, lexicalDiversity: 0.6 - i * 0.02, topicCoherence: 0.6 - i * 0.03 }),
    );
    const r = assessSpeechChange([...baselineSamples(), ...recent], baseline);
    expect(r.urgency).toBe('action');
    expect(r.trend).toBe('worsening');
    expect(r.magnitude).toBeGreaterThanOrEqual(2);
    expect(r.contributors.map((c) => c.feature)).toContain('responseLatencyMs');
    expect(r.contributors[0]!.adverseZ).toBeGreaterThanOrEqual(r.contributors.at(-1)!.adverseZ);
    expect(r.recentCallIds).toEqual(['c30', 'c31', 'c32', 'c33', 'c34']);
  });

  it('flags a slight change as watch', () => {
    const recent = [30, 31, 32].map((n) => sample(n, { responseLatencyMs: 1200 }));
    const r = assessSpeechChange([...baselineSamples(), ...recent], baseline);
    expect(r.urgency).toBe('watch');
  });

  it('treats improvement as non-adverse and detects an improving trend', () => {
    const recent = [30, 31, 32, 33].map((n, i) => sample(n, { responseLatencyMs: 2500 - i * 600 }));
    const r = assessSpeechChange([...baselineSamples(), ...recent], baseline);
    expect(r.trend).toBe('improving');
    const better = [30, 31, 32].map((n) => sample(n, { responseLatencyMs: 500, lexicalDiversity: 0.8 }));
    expect(assessSpeechChange([...baselineSamples(), ...better], baseline).urgency).toBeNull();
  });

  it('does not mistake recorded timings for a change from transcript-timed history', () => {
    const live = (n: number, f: Partial<SpeechFeatures>) => ({ ...sample(n, f), measuredFrom: 'audio' as const });
    // Recorded response times are far below transcript timings; without an audio baseline they are left out.
    const faster = [30, 31, 32].map((n) => live(n, { responseLatencyMs: 300, repairRate: 9 }));
    const r = assessSpeechChange([...baselineSamples(), ...faster], baseline);
    expect(r.status).toBe('assessed');
    expect(r.urgency).toBeNull();
    // Vocabulary is still compared.
    const words = [30, 31, 32].map((n) => live(n, { responseLatencyMs: 300, lexicalDiversity: 0.5 }));
    expect(assessSpeechChange([...baselineSamples(), ...words], baseline).contributors.map((c) => c.feature)).toEqual(['lexicalDiversity']);
  });

  it('compares recorded timings with recorded history and prefers the method most recent calls used', () => {
    const live = (n: number, f: Partial<SpeechFeatures>) => ({ ...sample(n, f), measuredFrom: 'audio' as const });
    const history = [...baselineSamples(), ...[20, 21, 22, 23, 24, 25, 26, 27].map((n) => live(n, { responseLatencyMs: 1700 + (n % 3) * 100 }))];
    const both = buildBaseline(history, START)!;
    const slower = [30, 31, 32].map((n) => live(n, { responseLatencyMs: 3200 }));
    const r = assessSpeechChange([...history, ...slower], both);
    expect(r.contributors[0]).toMatchObject({ feature: 'responseLatencyMs', recentMean: 3200 });
    expect(r.contributors[0]!.baselineMean).toBeCloseTo(1800, 5);
    const mixed = [sample(30, { responseLatencyMs: 900 }), live(31, { responseLatencyMs: 3200 }), live(32, { responseLatencyMs: 3200 })];
    expect(assessSpeechChange([...history, ...mixed], both).contributors.find((c) => c.feature === 'responseLatencyMs')?.recentMean).toBe(3200);
  });

  it('excludes unusable calls from the assessment (SPK-04)', () => {
    const recent = [30, 31, 32, 33, 34].map((n) => sample(n, { responseLatencyMs: 5000 }, false));
    expect(assessSpeechChange([...baselineSamples(), ...recent], baseline).status).toBe('insufficient_recent');
  });

  it('describes changes in plain language without diagnostic terms', () => {
    const c = { feature: 'responseLatencyMs' as const, adverseZ: 3, baselineMean: 900, recentMean: 2000 };
    expect(describeFeatureChange(c, 'ja')).toBe('応答までの時間が平常時より延びている');
    expect(describeFeatureChange(c, 'en')).toMatch(/Response time/);
    for (const f of ['lexicalDiversity', 'repairRate', 'topicCoherence'] as const) {
      expect(describeFeatureChange({ ...c, feature: f }, 'ja')).not.toMatch(/認知症|dementia/i);
    }
  });

  it('describes the trend in words staff cannot misread, and says nothing when it is flat', () => {
    expect(describeTrend('worsening', 'en')).toBe('getting worse over recent calls');
    expect(describeTrend('improving', 'en')).toBe('easing over recent calls');
    expect(describeTrend('stable', 'en')).toBeNull();
    expect(describeTrend('stable', 'ja')).toBeNull();
    expect(describeTrend('worsening', 'ja')).toMatch(/直近/);
    expect(describeTrend('improving', 'ja')).toMatch(/和らいで/);
  });
});

describe('usualRange', () => {
  it('spans two of the standard deviations the assessment uses, never below zero', () => {
    expect(usualRange('responseLatencyMs', { mean: 1000, std: 200, n: 8 })).toEqual({ mean: 1000, low: 600, high: 1400, n: 8 });
    // A very steady baseline still gets the assessment's minimum spread.
    expect(usualRange('responseLatencyMs', { mean: 1000, std: 10, n: 8 })).toMatchObject({ low: 700, high: 1300 });
    expect(usualRange('repairRate', { mean: 0.4, std: 0.1, n: 8 }).low).toBe(0);
  });
});
