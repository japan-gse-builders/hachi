import type { CallSpeechSample, Turn } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { analyse, groundEmergencies, type AnalysisInput } from '../src/analysis.js';
import { call, NOW, resident, review, TRANSCRIPT } from './fixtures.js';

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return { resident: resident(), call: call(), transcript: TRANSCRIPT, history: [], review: review(), model: 'gemini-test', now: NOW, ...overrides };
}

const rules = (i: AnalysisInput) => analyse(i).detections.map((d) => d.rule);

describe('emergency grounding', () => {
  const t: Turn[] = [
    { speaker: 'agent', text: 'How are you?', startMs: 0, endMs: 1000 },
    { speaker: 'resident', text: "Well, it's nothing really, but my chest feels a bit tight.", startMs: 1500, endMs: 5000 },
  ];

  it('keeps a verbatim quote from the cited resident turn', () => {
    const [g] = groundEmergencies(review({ emergencies: [{ turn: 1, quote: 'my chest feels a bit tight', symptom: 'chest tightness', confidence: 0.7 }] }), t, 'c1');
    expect(g!.evidence).toEqual({ callId: 'c1', quote: 'my chest feels a bit tight', startMs: 1500, endMs: 5000 });
  });

  it('replaces a paraphrased quote with the resident turn itself', () => {
    const [g] = groundEmergencies(review({ emergencies: [{ turn: 1, quote: 'chest pain', symptom: 'chest', confidence: 0.6 }] }), t, 'c1');
    expect(g!.evidence.quote).toBe(t[1]!.text);
  });

  it('finds the resident turn when the model cites the wrong turn, and drops unsupported claims', () => {
    const r = review({
      emergencies: [
        { turn: 0, quote: 'My chest feels a bit tight', symptom: 'chest', confidence: 0.6 },
        { turn: 7, quote: 'I fell down', symptom: 'fall', confidence: 0.9 },
        { turn: 0, quote: '', symptom: 'none', confidence: 0.9 },
      ],
    });
    const g = groundEmergencies(r, t, 'c1');
    expect(g).toHaveLength(1);
    expect(g[0]!.evidence.startMs).toBe(1500);
  });
});

describe('analyse', () => {
  it('stores summaries, memory and intake from the model', () => {
    const { update } = analyse(input());
    expect(update.summary).toEqual(review().staffSummary);
    expect(update.familySummary).toEqual(review().familySummary);
    expect(update.analysis).toEqual({
      at: NOW.toISOString(),
      model: 'gemini-test',
      turns: 4,
      intake: { date: '2026-10-02', status: 'normal' },
      memory: review().memory,
    });
    expect(update.speech).toMatchObject({ callId: '2026-10-02-1', usable: false, exclusionReasons: ['too_little_speech'] });
    expect(update.speech!.features.topicCoherence).toBe(0.9);
  });

  it('runs the rule-based checks only when the model is unavailable', () => {
    const t: Turn[] = [...TRANSCRIPT, { speaker: 'resident', text: "I can't breathe properly.", startMs: 18000, endMs: 20000 }];
    const r = analyse(input({ transcript: t, review: null, modelError: 'Gemini request failed: 503' }));
    expect(r.update.summary).toBeUndefined();
    expect(r.update.analysis).toMatchObject({ intake: { status: 'unknown' }, memory: { topics: [], plans: [], likes: [] }, error: 'Gemini request failed: 503' });
    expect(r.update.analysis.model).toBeUndefined();
    expect(r.detections.map((d) => d.rule)).toEqual(['R1']);
    expect(r.detections[0]!.evidence[0]!.quote).toBe("I can't breathe properly.");
  });

  it('derives the call date in the resident time zone when the call has none', () => {
    const c = call({ startedAt: '2026-10-01T16:00:00.000Z' });
    delete c.localDate;
    expect(analyse(input({ call: c })).update.analysis.intake.date).toBe('2026-10-02');
  });

  describe('R1 after the call', () => {
    const hedged = review({ emergencies: [{ turn: 1, quote: 'a little tired', symptom: 'Unusual fatigue', confidence: 0.55 }] });

    it('raises understated complaints the model found', () => {
      const [d] = analyse(input({ review: hedged })).detections;
      expect(d).toMatchObject({ rule: 'R1', urgency: 'emergency', confidence: 0.55, summary: 'Possible emergency found when reviewing the call (Unusual fatigue)' });
      expect(d!.evidence).toEqual([{ callId: '2026-10-02-1', quote: 'a little tired', startMs: 4500, endMs: 9000 }]);
    });

    it('merges rule and model findings for the same words', () => {
      const t: Turn[] = [{ speaker: 'resident', text: 'I have chest pain.', startMs: 0, endMs: 1000 }];
      const r = review({ emergencies: [{ turn: 0, quote: 'I have chest pain.', symptom: 'Chest pain', confidence: 0.95 }] });
      const [d] = analyse(input({ transcript: t, review: r })).detections;
      expect(d!.evidence).toHaveLength(1);
      expect(d!.confidence).toBe(0.95);
    });

    it('uses a generic summary when no symptom is known', () => {
      const t: Turn[] = [{ speaker: 'resident', text: "I can't breathe.", startMs: 0, endMs: 1000 }];
      expect(analyse(input({ transcript: t, review: null })).detections[0]!.summary).toBe('Possible emergency found when reviewing the call');
    });

    it('is skipped when the emergency was already raised during the call', () => {
      const c = call({ emergency: { at: NOW.toISOString(), caseId: 'case-9', quote: 'I am tired' } });
      expect(rules(input({ call: c, review: hedged }))).toEqual([]);
    });
  });

  describe('R2', () => {
    const poor = review({ intake: { status: 'poor', reportedPoorDays: 0, evidenceTurns: [3] } });

    it('watches a single day of poor intake, quoting the cited turn', () => {
      const [d] = analyse(input({ review: poor })).detections;
      expect(d).toMatchObject({ rule: 'R2', urgency: 'watch', poorIntakeDays: 1, summary: 'Has not been eating enough' });
      expect(d!.evidence.map((e) => e.quote)).toEqual([TRANSCRIPT[3]!.text]);
    });

    it('is urgent when the resident reports several days', () => {
      const [d] = analyse(input({ review: review({ intake: { status: 'poor', reportedPoorDays: 3, evidenceTurns: [] } }) })).detections;
      expect(d).toMatchObject({ urgency: 'urgent', poorIntakeDays: 3, summary: 'Has not been eating enough for 3 days' });
      // Without cited turns, resident turns about food are used.
      expect(d!.evidence.map((e) => e.quote)).toEqual([TRANSCRIPT[3]!.text]);
    });

    it('counts consecutive poor days from earlier calls', () => {
      const yesterday = call({
        id: '2026-10-01-1',
        startedAt: '2026-10-01T02:00:00.000Z',
        analysisPending: false,
        analysis: { at: '', turns: 4, intake: { date: '2026-10-01', status: 'poor' }, memory: { topics: [], plans: [], likes: [] } },
      });
      const old = call({
        id: '2026-09-20-1',
        startedAt: '2026-09-20T02:00:00.000Z',
        analysis: { at: '', turns: 4, intake: { date: '2026-09-20', status: 'poor' }, memory: { topics: [], plans: [], likes: [] } },
      });
      const unanalysed = call({ id: '2026-09-30-1', startedAt: '2026-09-30T02:00:00.000Z' });
      const [d] = analyse(input({ review: poor, history: [yesterday, old, unanalysed] })).detections;
      expect(d).toMatchObject({ urgency: 'urgent', poorIntakeDays: 2 });
    });

    it('does not alert when today was normal or unknown', () => {
      const yesterday = call({
        id: '2026-10-01-1',
        startedAt: '2026-10-01T02:00:00.000Z',
        analysis: { at: '', turns: 4, intake: { date: '2026-10-01', status: 'poor' }, memory: { topics: [], plans: [], likes: [] } },
      });
      expect(rules(input({ history: [yesterday] }))).toEqual([]);
      expect(rules(input({ review: review({ intake: { status: 'unknown', reportedPoorDays: 0, evidenceTurns: [] } }) }))).toEqual([]);
    });
  });

  describe('R3', () => {
    const features = (o: Partial<CallSpeechSample['features']> = {}) => ({
      lexicalDiversity: 0.8,
      repairRate: 1,
      responseLatencyMs: 800,
      topicCoherence: 0.9,
      ...o,
    });
    const sample = (id: string, at: string, f = features()): CallSpeechSample => ({ callId: id, at, features: f, usable: true, exclusionReasons: [] });
    const past = (id: string, at: string, f?: CallSpeechSample['features']) =>
      call({ id, startedAt: at, analysisPending: false, speech: sample(id, at, f) });
    const baseline = Array.from({ length: 8 }, (_, i) =>
      past(`b${i}`, `2026-08-${String(2 + i * 3).padStart(2, '0')}T02:00:00.000Z`, features({ lexicalDiversity: 0.78 + (i % 3) * 0.02, responseLatencyMs: 700 + (i % 4) * 100 })),
    );
    const slow = features({ responseLatencyMs: 6000, repairRate: 12, topicCoherence: 0.3, lexicalDiversity: 0.5 });
    const recent = [past('r1', '2026-09-29T02:00:00.000Z', slow), past('r2', '2026-09-30T02:00:00.000Z', slow)];
    const words = 'um I went to the the market and er I bought some uh fish and rice and then I mean I came home and um sat down for a while'.split(' ');
    const long: Turn[] = [
      { speaker: 'agent', text: 'What did you do yesterday?', startMs: 0, endMs: 2000 },
      { speaker: 'resident', text: [...words, ...words, ...words].join(' '), startMs: 8000, endMs: 30000 },
    ];
    const slowReview = review({ topicCoherence: 0.3 });

    it('flags a clear change from the resident\'s own baseline', () => {
      const r = analyse(input({ transcript: long, review: slowReview, history: [...baseline, ...recent] }));
      const d = r.detections.find((x) => x.rule === 'R3')!;
      expect(d).toMatchObject({ urgency: 'action', evidence: [{ callId: '2026-10-02-1', startMs: 8000 }] });
      expect(d.changeMagnitude).toBeGreaterThan(2);
      expect(d.confidence).toBeLessThanOrEqual(0.9);
      expect(d.summary).toContain('Response time is longer than usual');
      expect(d.summary).toMatch(/\(trend: \w+\)$/);
      expect(r.update.speech!.usable).toBe(true);
    });

    it('quotes the longest things the resident said', () => {
      const r = analyse(input({
        transcript: [{ speaker: 'resident', text: 'Yes.', startMs: 0, endMs: 400 }, ...long],
        review: slowReview,
        history: [...baseline, ...recent],
      }));
      const d = r.detections.find((x) => x.rule === 'R3')!;
      expect(d.evidence.map((e) => e.startMs)).toEqual([8000, 0]);
    });

    it('quotes the moments in the recording that show the change', () => {
      const r = analyse(input({
        transcript: long,
        review: slowReview,
        history: [...baseline, ...recent],
        timing: {
          responseLatencyMs: 6000,
          repairRate: 12,
          examples: [
            { kind: 'slow_response', quote: 'um I went to the market', startMs: 8000 },
            { kind: 'repetition', quote: 'the the market' },
            { kind: 'false_start', quote: 'vi- visiting', startMs: 21000 },
            { kind: 'correction', quote: 'Tuesday, no, Wednesday', startMs: 25000 },
          ],
        },
        audioQuality: 0.9,
      }));
      const d = r.detections.find((x) => x.rule === 'R3')!;
      expect(d.evidence).toEqual([
        { callId: '2026-10-02-1', quote: 'um I went to the market', startMs: 8000 },
        { callId: '2026-10-02-1', quote: 'the the market' },
        { callId: '2026-10-02-1', quote: 'vi- visiting', startMs: 21000 },
      ]);
      expect(r.update.speech!.measuredFrom).toBe('audio');
    });

    it('falls back to long answers when the recording shows nothing that changed', () => {
      const flat = recent.map((c) => ({ ...c, speech: { ...c.speech!, features: features({ lexicalDiversity: 0.4, topicCoherence: 0.2 }) } }));
      const r = analyse(input({
        transcript: long,
        review: slowReview,
        history: [...baseline, ...flat],
        timing: { responseLatencyMs: 800, repairRate: 1, examples: [{ kind: 'slow_response', quote: 'fine', startMs: 2500 }] },
      }));
      const d = r.detections.find((x) => x.rule === 'R3')!;
      expect(d.summary).not.toContain('Response time');
      expect(d.evidence.map((e) => e.startMs)).toEqual([8000]);
    });

    it('needs a baseline, enough speech and good conditions', () => {
      expect(rules(input({ transcript: long, review: slowReview, history: recent }))).toEqual([]);
      expect(rules(input({ review: slowReview, history: [...baseline, ...recent] }))).toEqual([]);
      expect(rules(input({ transcript: long, review: review({ topicCoherence: 0.3, temporaryCondition: true }), history: [...baseline, ...recent] }))).toEqual([]);
      expect(rules(input({ transcript: long, review: review({ topicCoherence: 0.3, noisy: true }), history: [...baseline, ...recent] }))).toEqual([]);
    });

    it('does not flag speech that matches the baseline', () => {
      const usual = [past('r1', '2026-09-29T02:00:00.000Z'), past('r2', '2026-09-30T02:00:00.000Z')];
      const fine: Turn[] = [
        { speaker: 'agent', text: 'What did you do yesterday?', startMs: 0, endMs: 2000 },
        {
          speaker: 'resident',
          text: 'Yesterday I walked to the little bakery near the station, bought fresh bread, chatted with the owner about her garden, then visited my friend Keiko who lives nearby. We drank green tea, watched birds outside, laughed about old photographs, planned a picnic next month, and later I cooked salmon with rice for dinner before reading quietly.',
          startMs: 2800,
          endMs: 30000,
        },
      ];
      expect(rules(input({ transcript: fine, history: [...baseline, ...usual] }))).toEqual([]);
    });

    it('describes a change without a single dominant feature', () => {
      const mild = features({ responseLatencyMs: 1100, repairRate: 1.6, topicCoherence: 0.82, lexicalDiversity: 0.74 });
      const r = analyse(
        input({
          transcript: long,
          review: slowReview,
          history: [...baseline, past('r1', '2026-09-29T02:00:00.000Z', mild), past('r2', '2026-09-30T02:00:00.000Z', mild)],
        }),
      );
      expect(r.detections.find((x) => x.rule === 'R3')?.summary).toBeTruthy();
    });
  });

  it('never raises alerts for imported history', () => {
    const t: Turn[] = [{ speaker: 'resident', text: "I can't breathe.", startMs: 0, endMs: 1000 }];
    const r = analyse(input({ call: call({ source: 'imported' }), transcript: t, review: review({ intake: { status: 'poor', reportedPoorDays: 3, evidenceTurns: [] } }) }));
    expect(r.detections).toEqual([]);
    expect(r.update.analysis.intake.status).toBe('poor');
  });
});
