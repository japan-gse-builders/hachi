import { measureVoiceTiming, parseWav, tokenize } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { pearson, renderReport, summarise, type CallResult, type PersonInfo } from '../eval/metrics.js';
import { mixCall, stereoWav, trimSilence, type Clip } from '../eval/mix.js';
import {
  BASELINE_CALL_DAYS,
  CALL_DAYS,
  changeStrength,
  countByKind,
  effectsFor,
  generateScenario,
  PEOPLE,
  RECENT_CALL_DAYS,
  rng,
  SERVICE_STARTED_AT,
} from '../eval/scenario.js';

const RATE = 8000;

/** A 440 Hz tone at about -12 dBFS. */
function tone(ms: number): Int16Array {
  const n = Math.round((ms * RATE) / 1000);
  return Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / RATE)));
}

describe('synthetic scenario', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(generateScenario(11)).toEqual(generateScenario(11));
    expect(JSON.stringify(generateScenario(12))).not.toEqual(JSON.stringify(generateScenario(11)));
  });

  it('has 5 stable and 5 changing people with 10 baseline and 5 recent calls each', () => {
    const s = generateScenario(1);
    expect(s.people).toHaveLength(10);
    expect(s.people.filter((p) => p.profile.expected === 'none')).toHaveLength(5);
    expect(BASELINE_CALL_DAYS).toHaveLength(10);
    expect(RECENT_CALL_DAYS).toEqual([28, 29, 30, 31, 32]);
    for (const p of s.people) {
      expect(p.calls.map((c) => c.day)).toEqual(CALL_DAYS);
      for (const c of p.calls) {
        const resident = c.turns.filter((t) => t.speaker === 'resident');
        expect(resident).toHaveLength(5);
        expect(tokenize(resident.map((t) => t.text).join(' ')).length).toBeGreaterThan(90);
        expect(Date.parse(c.startedAt) - Date.parse(SERVICE_STARTED_AT)).toBe(c.day * 86_400_000 + 3_600_000);
      }
    }
  });

  it('limits people and calls for a smoke run', () => {
    const s = generateScenario(1, { people: 2, calls: 3 });
    expect(s.people.map((p) => p.calls.length)).toEqual([3, 3]);
  });

  it('only changes behaviour after the baseline window', () => {
    expect(changeStrength(27)).toBe(0);
    expect(changeStrength(28)).toBeCloseTo(0.7);
    expect(changeStrength(32)).toBe(1);
    expect(effectsFor('slower', 1).gapFactor).toBeCloseTo(1.85);
    expect(effectsFor('repairs', 1).repairFactor).toBe(3);
    expect(effectsFor('vocabulary', 0)).toEqual(effectsFor('none', 1));
    const s = generateScenario(3);
    for (const p of s.people) for (const c of p.calls) if (c.day < 28) expect(c.strength).toBe(0);
  });

  it('keeps the clean text as the transcript and records every inserted disfluency', () => {
    const s = generateScenario(5);
    let total = 0;
    for (const p of s.people) {
      for (const c of p.calls) {
        for (const d of c.disfluencies) expect(c.turns[d.turn]!.speaker).toBe('resident');
        const extra = c.turns.reduce((a, t) => a + tokenize(t.spoken).length - tokenize(t.text).length, 0);
        const expectedExtra = c.disfluencies.reduce((a, d) => a + (d.kind === 'correction' ? 2 : 1), 0);
        expect(extra).toBe(expectedExtra);
        for (const t of c.turns.filter((x) => x.speaker === 'agent')) expect(t.spoken).toBe(t.text);
        total += c.disfluencies.length;
      }
    }
    expect(total).toBeGreaterThan(100);
  });

  it('gives the hesitant speaker more disfluencies, the changing speaker more after day 28 and the cold call a mention', () => {
    const s = generateScenario(2026);
    const rate = (id: string, days: (d: number) => boolean) => {
      const calls = s.people.find((p) => p.profile.id === id)!.calls.filter((c) => days(c.day));
      return calls.reduce((a, c) => a + c.disfluencies.length, 0) / calls.length;
    };
    expect(rate('syn-s3', () => true)).toBeGreaterThan(2 * rate('syn-s1', () => true));
    expect(rate('syn-c2', (d) => d >= 28)).toBeGreaterThan(2 * rate('syn-c2', (d) => d < 28));
    const cold = s.people.find((p) => p.profile.id === 'syn-s4')!.calls.find((c) => c.day === 30)!;
    expect(cold.condition).toBe('cold');
    expect(cold.turns.map((t) => t.text).join(' ')).toMatch(/cold/);
  });

  it('makes slower people pause longer after the change', () => {
    const s = generateScenario(2026);
    const c1 = s.people.find((p) => p.profile.id === 'syn-c1')!;
    const gaps = (days: (d: number) => boolean) =>
      c1.calls.filter((c) => days(c.day)).flatMap((c) => c.turns.filter((t) => t.speaker === 'resident').map((t) => t.gapBeforeMs));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(gaps((d) => d >= 30)) / mean(gaps((d) => d < 28))).toBeGreaterThan(1.5);
  });

  it('counts disfluencies by kind and has a stable PRNG', () => {
    expect(countByKind([{ kind: 'filler' }, { kind: 'filler' }, { kind: 'correction' }])).toEqual({ filler: 2, repetition: 0, false_start: 0, correction: 1 });
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(PEOPLE.every((p) => /^syn-/.test(p.id))).toBe(true);
  });
});

describe('call mixing', () => {
  it('trims leading and trailing silence', () => {
    const pcm = new Int16Array(RATE * 2);
    pcm.set(tone(1000), RATE / 2);
    const trimmed = trimSilence(pcm, RATE);
    expect(trimmed.length).toBeGreaterThanOrEqual(RATE - 160);
    expect(trimmed.length).toBeLessThanOrEqual(RATE + 160);
    expect(trimSilence(new Int16Array(800), RATE)).toHaveLength(800);
  });

  it('places clips at exact offsets on the right channels and measures the scripted gaps', () => {
    const clips: Clip[] = [
      { speaker: 'agent', pcm: tone(1000), gapBeforeMs: 500, text: 'How are you?' },
      { speaker: 'resident', pcm: tone(1500), gapBeforeMs: 1800, text: 'Fine.' },
      { speaker: 'agent', pcm: tone(800), gapBeforeMs: 700, text: 'Lovely. And lunch?' },
      { speaker: 'resident', pcm: tone(1200), gapBeforeMs: 2400, text: 'Soup.' },
    ];
    const mixed = mixCall(clips, { sampleRate: RATE, noiseSeed: 3 });
    expect(mixed.transcript.map((t) => [t.speaker, t.startMs, t.endMs])).toEqual([
      ['agent', 500, 1500],
      ['resident', 3300, 4800],
      ['agent', 5500, 6300],
      ['resident', 8700, 9900],
    ]);
    expect(mixed.durationMs).toBe(10_900);
    const audio = parseWav(mixed.wav);
    expect(audio.sampleRate).toBe(RATE);
    expect(audio.channels).toHaveLength(2);
    // Agent channel is silent while the resident speaks; the resident channel has only a faint noise floor.
    expect(audio.channels[1]![Math.round(3.5 * RATE)]).toBe(0);
    expect(Math.abs(audio.channels[0]![Math.round(1 * RATE)]!)).toBeLessThan(100);
    const timing = measureVoiceTiming(audio);
    expect(timing.gaps.map((g) => g.gapMs)).toEqual([1800, 2400]);
    expect(timing.responseLatencyMs).toBe(2100);
  });

  it('can mix without noise and writes a valid stereo WAV', () => {
    const wav = stereoWav(Int16Array.from([1, 2]), Int16Array.from([3]), RATE);
    const audio = parseWav(wav);
    expect([...audio.channels[0]!]).toEqual([1, 2]);
    expect([...audio.channels[1]!]).toEqual([3, 0]);
    const mixed = mixCall([{ speaker: 'resident', pcm: Int16Array.from([5]), gapBeforeMs: 0, text: 'x' }], { sampleRate: RATE, noiseDbfs: -120, tailMs: 0 });
    expect([...parseWav(mixed.wav).channels[0]!]).toEqual([5]);
  });
});

function result(overrides: Partial<CallResult> & Pick<CallResult, 'personId' | 'day'>): CallResult {
  return {
    callId: `${overrides.personId}-${overrides.day}`,
    strength: 0,
    scripted: { gapsMs: [1000, 1500, 2000], medianGapMs: 1500, disfluencies: { filler: 2, repetition: 1, false_start: 0, correction: 1 }, spokenWords: 100 },
    measured: { responseLatencyMs: 1520, gapCount: 3, repairRate: 4, heard: { filler: 2, repetition: 0, false_start: 1, correction: 1 }, heardWords: 100, audioQuality: 0.9 },
    review: { topicCoherence: 0.9, temporaryCondition: false, noisy: false },
    sample: { usable: true, exclusionReasons: [], features: { lexicalDiversity: 0.8, repairRate: 4, responseLatencyMs: 1520, topicCoherence: 0.9 } },
    assessment: { status: 'assessed', urgency: null, magnitude: 0, trend: 'stable', contributors: [] },
    detection: null,
    otherRules: [],
    ...overrides,
  };
}

const PEOPLE_INFO: PersonInfo[] = [
  { id: 'a', name: 'A', change: 'none', expected: 'none', expectedFeatures: [], note: 'stable' },
  { id: 'b', name: 'B', change: 'none', expected: 'none', expectedFeatures: [], note: 'stable' },
  { id: 'c', name: 'C', change: 'slower', expected: 'action', expectedFeatures: ['responseLatencyMs'], note: 'slower' },
  { id: 'd', name: 'D', change: 'mild', expected: 'watch', expectedFeatures: ['repairRate'], note: 'mild' },
];

describe('evaluation metrics', () => {
  const flagged = (urgency: 'watch' | 'action', feature: 'responseLatencyMs' | 'topicCoherence') => ({
    detection: { urgency, summary: 's', magnitude: 2 },
    assessment: { status: 'assessed' as const, urgency, magnitude: 2, trend: 'worsening' as const, contributors: [{ feature, adverseZ: 3 }] },
  });
  const results: CallResult[] = [
    result({ personId: 'a', day: 0, assessment: { status: 'no_baseline', urgency: null, magnitude: 0, trend: 'stable', contributors: [] } }),
    result({ personId: 'a', day: 30 }),
    result({ personId: 'a', day: 31 }),
    result({ personId: 'b', day: 30, ...flagged('watch', 'topicCoherence') }),
    result({ personId: 'b', day: 31, sample: { usable: false, exclusionReasons: ['temporary_condition'], features: { lexicalDiversity: 0.5, repairRate: 9, responseLatencyMs: 3000, topicCoherence: 0.5 } }, assessment: { status: 'excluded', urgency: null, magnitude: 0, trend: 'stable', contributors: [], ifIncluded: { urgency: 'watch', magnitude: 1.2 } } }),
    result({ personId: 'c', day: 31, ...flagged('watch', 'responseLatencyMs') }),
    result({ personId: 'c', day: 30, ...flagged('action', 'responseLatencyMs'), measured: { ...result({ personId: 'c', day: 30 }).measured, responseLatencyMs: 1400, gapCount: 2 } }),
    result({ personId: 'd', day: 30, measured: { ...result({ personId: 'd', day: 30 }).measured, heard: null, responseLatencyMs: null, repairRate: null } }),
  ];
  const s = summarise(PEOPLE_INFO, results, 28);

  it('scores detection per person and per assessed call', () => {
    expect(s.detection).toMatchObject({ changed: 2, changedDetected: 1, sensitivity: 0.5, changedUrgencyMatches: 1, stable: 2, stableFlagged: 1, stableAssessedCalls: 3, stableFlaggedCalls: 1 });
    expect(s.detection.falsePositiveRatePerCall).toBeCloseTo(1 / 3);
    expect(s.detection.meanFirstDetectionDelayDays).toBe(2);
    const c = s.people.find((p) => p.id === 'c')!;
    expect(c).toMatchObject({ firstDetectionDay: 30, maxUrgency: 'action', correct: true, urgencyMatches: true, rightFeature: true, contributors: ['responseLatencyMs'], peakMagnitude: 2, peakZ: 3 });
    expect(s.people.find((p) => p.id === 'd')).toMatchObject({ correct: false, rightFeature: false, maxUrgency: 'none', peakMagnitude: 0, peakZ: 0 });
    expect(s.people.find((p) => p.id === 'b')).toMatchObject({ correct: false, rightFeature: null, excluded: [{ day: 31, reasons: ['temporary_condition'], ifIncluded: 'watch' }] });
    expect(s.people.find((p) => p.id === 'a')!.baselineMeans.responseLatencyMs).toBe(1520);
  });

  it('measures timing error and disfluency recall/precision', () => {
    expect(s.timing.calls).toBe(7);
    expect(s.timing.maeMs).toBeCloseTo((6 * 20 + 100) / 7);
    expect(s.timing.maxErrorMs).toBe(100);
    expect(s.timing.gapCountMismatches).toBe(1);
    // 7 calls with 4 inserted / 4 heard; matched per kind: filler 2, repetition 0, false_start 0, correction 1.
    expect(s.disfluency).toMatchObject({ calls: 7, inserted: 28, heard: 28, recall: 1, precision: 1 });
    expect(s.disfluency.byKind.repetition).toMatchObject({ inserted: 7, heard: 0, recall: 0 });
    expect(s.disfluency.byKind.false_start.precision).toBe(0);
    expect(s.disfluency.byKind.filler.recall).toBe(1);
    expect(s.disfluency.rateCorrelation).toBeNull();
  });

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('renders a report marked as synthetic', () => {
    const md = renderReport(s, { seed: 1, generatedAt: '2026-10-04T00:00:00.000Z', model: 'm', calls: 8, people: 4, durationSec: 12, geminiRequests: 16, ttsRequests: 3 });
    expect(md).toMatch(/SYNTHETIC/);
    expect(md).toMatch(/\| Changed people detected \(sensitivity\) \| 1\/2 \(50%\) \|/);
    expect(md).toMatch(/flagged ✗ \(1×\)/);
    expect(md).toMatch(/missed ✗/);
    expect(md).toMatch(/day 31 \(temporary_condition; if used: watch\)/);
    expect(md).toMatch(/\*\*Missed:\*\* d/);
    expect(md).toMatch(/\*\*False positive:\*\* b flagged on 1 call/);
  });

  it('reports urgency mismatches and wrong features, or that nothing is notable', () => {
    const mild: PersonInfo = { id: 'm', name: 'M', change: 'mild', expected: 'watch', expectedFeatures: ['repairRate'], note: 'mild' };
    const flaggedAction = result({
      personId: 'm',
      day: 30,
      detection: { urgency: 'action', summary: 's', magnitude: 2 },
      assessment: { status: 'assessed', urgency: 'action', magnitude: 2, trend: 'stable', contributors: [{ feature: 'responseLatencyMs', adverseZ: 3.4 }] },
    });
    const run = { seed: 1, generatedAt: '2026-10-04T00:00:00.000Z', model: 'm', calls: 1, people: 1, durationSec: 1, geminiRequests: 0, ttsRequests: 0 };
    const md = renderReport(summarise([mild], [flaggedAction], 28), run);
    expect(md).toMatch(/\*\*Urgency differs:\*\* m expected Monitor \(watch\), got Review soon \(action\)/);
    expect(md).toMatch(/\*\*Wrong feature:\*\* m was flagged for responseLatencyMs, expected repairRate/);
    expect(renderReport(summarise([PEOPLE_INFO[0]!], [result({ personId: 'a', day: 30 })], 28), run)).toMatch(/None: every person/);
  });
});
