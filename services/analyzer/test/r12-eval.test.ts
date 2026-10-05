import { describe, expect, it } from 'vitest';
import { misses, renderReport, score, summarise, type CaseResult, type RunInfo } from '../eval/r12-metrics.js';
import { CASES, FIRST_DATE, generateR12Scenario, VARIANTS } from '../eval/r12-scenario.js';

describe('synthetic R1/R2 scenario', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(generateR12Scenario(11)).toEqual(generateR12Scenario(11));
    expect(JSON.stringify(generateR12Scenario(12))).not.toEqual(JSON.stringify(generateR12Scenario(11)));
  });

  it('never lets the seed change a label or a key utterance', () => {
    const a = generateR12Scenario(1);
    const b = generateR12Scenario(2);
    expect(a.cases.map((c) => [c.spec, c.variant, c.calls.map((k) => k.keyLines)])).toEqual(b.cases.map((c) => [c.spec, c.variant, c.calls.map((k) => k.keyLines)]));
  });

  it('decides every label up front with a reason, consistent with the polarity', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.reason.length).toBeGreaterThan(10);
      expect(c.calls.length).toBeGreaterThan(0);
      if (c.rule === 'R1') {
        expect(c.expectR1).toBe(c.polarity === 'positive');
        expect(c.expectR2).toBeNull();
      } else {
        expect(c.expectR1).toBe(false);
        expect(c.expectR2 === 'urgent').toBe(c.polarity === 'positive');
      }
      for (const call of c.calls) for (const b of call.beats) expect(b.resident).toHaveLength(2);
    }
    const n = (rule: string, polarity: string) => CASES.filter((c) => c.rule === rule && c.polarity === polarity).length;
    expect([n('R1', 'positive'), n('R1', 'negative'), n('R2', 'positive'), n('R2', 'negative')]).toEqual([16, 16, 8, 9]);
    expect(CASES.find((c) => c.id === 'r1n-ambulance-left')!.reason).toMatch(/Decision: NOT an R1 emergency/);
    expect(CASES.filter((c) => c.expectR2 === 'watch').map((c) => c.id)).toEqual(['r2n-single-day', 'r2n-broken-streak']);
  });

  it('scripts both wording variants of every case as separate synthetic residents', () => {
    const s = generateR12Scenario(2026);
    expect(s.cases).toHaveLength(CASES.length * VARIANTS.length);
    for (const spec of CASES) {
      const [v0, v1] = s.cases.filter((c) => c.spec.id === spec.id);
      expect(v0!.residentId).toBe(`syn-r12-${spec.id}-v0`);
      expect(v1!.calls.at(-1)!.keyLines).not.toEqual(v0!.calls.at(-1)!.keyLines);
    }
    expect(generateR12Scenario(1, { cases: ['r1p-stroke'] }).cases.map((c) => c.spec.id)).toEqual(['r1p-stroke', 'r1p-stroke']);
  });

  it('builds production-like transcripts with the key lines spoken by the resident', () => {
    const s = generateR12Scenario(7);
    for (const c of s.cases) {
      expect(c.calls.map((k) => k.day)).toEqual(c.spec.calls.map((k) => k.day));
      for (const call of c.calls) {
        const t = call.transcript;
        expect(t[0]!.speaker).toBe('agent');
        expect(t[0]!.text).toContain(c.name);
        t.forEach((turn, i) => {
          expect(turn.speaker).toBe(i % 2 ? 'resident' : 'agent');
          expect(turn.endMs).toBeGreaterThan(turn.startMs);
          if (i) expect(turn.startMs).toBeGreaterThan(t[i - 1]!.endMs);
        });
        const said = t.filter((x) => x.speaker === 'resident').map((x) => x.text);
        for (const line of call.keyLines) expect(said).toContain(line);
        expect(call.durationMs).toBeGreaterThan(t.at(-1)!.endMs);
        expect(call.startedAt.endsWith('T01:00:00.000Z')).toBe(true);
        expect(call.localDate >= FIRST_DATE).toBe(true);
        expect(t.map((x) => x.text).join(' ')).not.toMatch(/\+?\d{6,}|@[a-z]/i);
      }
      const days = c.calls.map((k) => Date.parse(k.startedAt) / 86_400_000);
      expect(days.map((d) => d - days[0]!)).toEqual(c.spec.calls.map((k) => k.day));
    }
  });

  it('adds an ordinary meal beat unless the call already talks about food or has none', () => {
    const s = generateR12Scenario(3);
    const resident = (id: string) => s.cases.find((c) => c.spec.id === id)!.calls.at(-1)!.transcript.filter((t) => t.speaker === 'resident').length;
    // greeting + 2 small talk + key + closing (+ meal)
    expect(resident('r1p-stroke')).toBe(6);
    expect(resident('r1p-choking')).toBe(5);
    expect(resident('r2p-reported-days')).toBe(5);
  });

  it('places late beats last and early beats first', () => {
    const s = generateR12Scenario(5);
    const late = s.cases.find((c) => c.spec.id === 'r1p-midconv-chest')!.calls[0]!;
    expect(late.transcript.at(-3)!.text).toBe(late.keyLines[0]);
    const early = s.cases.find((c) => c.spec.id === 'r1n-joke-heart-attack')!.calls[0]!;
    expect(early.transcript[3]!.text).toBe(early.keyLines[0]);
  });
});

function result(overrides: Partial<CaseResult> & Pick<CaseResult, 'caseId' | 'rule' | 'polarity' | 'expectR1' | 'expectR2'>): CaseResult {
  return {
    seed: 1,
    repeat: 0,
    variant: 0,
    tag: 't',
    reason: 'because',
    keyLines: ['line'],
    r1: { urgency: null, byRules: false, byModel: false, quotes: [] },
    r2: { urgency: null, poorIntakeDays: null, intake: [{ day: 0, status: 'normal' }] },
    reviewErrors: [],
    ...overrides,
  };
}

const R1 = { urgency: 'emergency' as const, quotes: ['q'] };
const RESULTS: CaseResult[] = [
  result({ caseId: 'p1', rule: 'R1', polarity: 'positive', expectR1: true, expectR2: null, r1: { ...R1, byRules: true, byModel: true } }),
  result({ caseId: 'p2', rule: 'R1', polarity: 'positive', expectR1: true, expectR2: null, r1: { ...R1, byRules: false, byModel: true, symptom: 'breathing' } }),
  result({ caseId: 'p3', rule: 'R1', polarity: 'positive', expectR1: true, expectR2: null }),
  result({ caseId: 'n1', rule: 'R1', polarity: 'negative', expectR1: false, expectR2: null, r1: { ...R1, byRules: true, byModel: false } }),
  result({ caseId: 'n2', rule: 'R1', polarity: 'negative', expectR1: false, expectR2: null }),
  result({
    caseId: 'q1',
    rule: 'R2',
    polarity: 'positive',
    expectR1: false,
    expectR2: 'urgent',
    r2: { urgency: 'urgent', poorIntakeDays: 2, intake: [{ day: 0, status: 'poor' }, { day: 1, status: 'poor', reportedPoorDays: 2 }] },
  }),
  result({ caseId: 'q2', rule: 'R2', polarity: 'positive', expectR1: false, expectR2: 'urgent', r2: { urgency: 'watch', poorIntakeDays: 1, intake: [{ day: 0, status: 'normal' }, { day: 1, status: 'poor' }] } }),
  result({ caseId: 'm1', rule: 'R2', polarity: 'negative', expectR1: false, expectR2: null, r2: { urgency: 'urgent', poorIntakeDays: 2, intake: [] } }),
  result({ caseId: 'm2', rule: 'R2', polarity: 'negative', expectR1: false, expectR2: 'watch', r2: { urgency: 'watch', poorIntakeDays: 1, intake: [] } }),
  result({ caseId: 'm3', rule: 'R2', polarity: 'negative', expectR1: false, expectR2: null, r2: { urgency: 'watch', poorIntakeDays: 1, intake: [] }, reviewErrors: ['boom'] }),
];

describe('R1/R2 evaluation metrics', () => {
  it('scores sensitivity, specificity, hard negatives, urgency match and each R1 component', () => {
    const s = score(RESULTS, 1, 0);
    expect(s).toMatchObject({ seed: 1, repeat: 0, cases: 10, reviewErrors: 1 });
    expect(s.r1.sensitivity).toEqual({ hits: 2, total: 3, rate: 2 / 3 });
    expect(s.r1.specificity).toMatchObject({ hits: 6, total: 7 });
    expect(s.r1.hardNegatives).toMatchObject({ hits: 1, total: 2 });
    expect(s.r1.urgencyMatch).toMatchObject({ hits: 8, total: 10 });
    expect(s.r1.rulesOnly).toMatchObject({ sensitivity: { hits: 1, total: 3 }, specificity: { hits: 6, total: 7 } });
    expect(s.r1.modelOnly).toMatchObject({ sensitivity: { hits: 2, total: 3 }, specificity: { hits: 7, total: 7 } });
    expect(s.r2.sensitivity).toMatchObject({ hits: 1, total: 2 });
    expect(s.r2.specificity).toMatchObject({ hits: 7, total: 8 });
    expect(s.r2.hardNegatives).toMatchObject({ hits: 2, total: 3 });
    expect(s.r2.urgencyMatch).toMatchObject({ hits: 7, total: 10 });
    expect(score([]).r1.sensitivity.rate).toBeNull();
  });

  it('lists every miss, false positive and urgency difference with its reason', () => {
    const m = misses(RESULTS);
    expect(m.map((x) => [x.caseId, x.rule, x.kind, x.expected, x.got])).toEqual([
      ['p3', 'R1', 'missed', 'emergency', 'none'],
      ['n1', 'R1', 'false positive', 'none', 'emergency (rules)'],
      ['q2', 'R2', 'missed', 'urgent', 'watch'],
      ['m1', 'R2', 'false positive', 'none', 'urgent'],
      ['m3', 'R2', 'urgency differs', 'none', 'watch'],
    ]);
    expect(m[2]!.detail).toBe('d0 normal, d1 poor');
    expect(m[0]).toMatchObject({ reason: 'because', quote: 'line', detail: '–' });
  });

  it('summarises per case and flags transcripts whose outcome changed between Gemini samples', () => {
    const again = RESULTS.map((r) => ({ ...r, repeat: 1 }));
    again[2] = { ...again[2]!, r1: { ...R1, byRules: false, byModel: true } };
    const s = summarise([...RESULTS, ...again]);
    expect(s.runs.map((r) => [r.seed, r.repeat])).toEqual([
      [1, 0],
      [1, 1],
    ]);
    expect(s.pooled.cases).toBe(20);
    expect(s.unstable).toEqual(['p3 v0 seed 1']);
    const p3 = s.cases.find((c) => c.caseId === 'p3')!;
    expect(p3).toMatchObject({ expected: 'emergency', correct: 1, runs: 2, outcomes: { none: 1, 'emergency (Gemini)': 1 } });
    expect(s.cases.find((c) => c.caseId === 'm2')).toMatchObject({ expected: 'watch', outcomes: { watch: 2 } });
    expect(s.cases.find((c) => c.caseId === 'p1')!.outcomes).toEqual({ 'emergency (rules+Gemini)': 2 });
  });

  it('renders a report marked as synthetic, with merged misses and limitations', () => {
    const run: RunInfo = {
      seeds: [1],
      repeats: 2,
      generatedAt: '2026-10-04T00:00:00.000Z',
      model: 'm',
      cases: 10,
      calls: 20,
      durationSec: 3,
      geminiRequests: 20,
      promptTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.0123,
    };
    const again = RESULTS.map((r) => ({ ...r, repeat: 1 }));
    const md = renderReport(summarise([...RESULTS, ...again]), run);
    expect(md).toMatch(/SYNTHETIC/);
    expect(md).toMatch(/USR-04/);
    expect(md).toMatch(/\(≈ \$0\.01\)/);
    expect(md).toMatch(/\| R1 sensitivity \(positives raised as emergency\) \| 4\/6 \(67%\) \| 2\/3 \(67%\) \| 2\/3 \(67%\) \|/);
    expect(md).toMatch(/\| n1 \(v0\) \| R1 \| false positive \| none \| emergency \(rules\) \| 1#0, 1#1 \|/);
    expect(md).toMatch(/\| p1 \| R1 positive \| t \| emergency \| 2\/2 ✓ \| emergency \(rules\+Gemini\) ×2 \|/);
    expect(md).toMatch(/\| p3 \| R1 positive \| t \| emergency \| 0\/2 ✗ \|/);
    expect(md).toMatch(/no transcript changed outcome/);
    expect(md).toMatch(/## Limitations/);
    const clean = renderReport(summarise([RESULTS[0]!]), { ...run, estimatedCostUsd: null });
    expect(clean).toMatch(/## Misses and false positives\n\nNone\./);
    expect(clean).not.toMatch(/≈ \$/);
  });
});
