/** Metrics and report for the SYNTHETIC R3 evaluation. Pure functions over per-call results. */
import type { SpeechFeature, SpeechFeatures, Trend, Urgency } from '@hachi/core';
import { DISFLUENCY_KINDS, type ChangeKind, type DisfluencyKind, type Expected } from './scenario.js';

export type KindCounts = Record<DisfluencyKind, number>;

export interface CallResult {
  personId: string;
  callId: string;
  day: number;
  strength: number;
  condition?: 'cold';
  scripted: { gapsMs: number[]; medianGapMs: number; disfluencies: KindCounts; spokenWords: number };
  measured: {
    responseLatencyMs: number | null;
    gapCount: number;
    repairRate: number | null;
    heard: KindCounts | null;
    heardWords: number | null;
    audioQuality: number | null;
    error?: string;
  };
  review: { topicCoherence: number; temporaryCondition: boolean; noisy: boolean } | null;
  reviewError?: string;
  sample: { usable: boolean; exclusionReasons: string[]; features: SpeechFeatures };
  assessment: {
    status: 'excluded' | 'no_baseline' | 'insufficient_recent' | 'assessed';
    urgency: Urgency | null;
    magnitude: number;
    trend: Trend;
    contributors: { feature: SpeechFeature; adverseZ: number }[];
    /** For an excluded call: what the assessment would have been had it been used. */
    ifIncluded?: { urgency: Urgency | null; magnitude: number };
  };
  /** The R3 detection `analyse()` raised for this call, if any. */
  detection: { urgency: Urgency; summary: string; magnitude: number } | null;
  otherRules: string[];
}

export interface PersonInfo {
  id: string;
  name: string;
  change: ChangeKind;
  expected: Expected;
  expectedFeatures: SpeechFeature[];
  note: string;
}

export interface PersonSummary extends PersonInfo {
  calls: number;
  assessedCalls: number;
  detections: number;
  firstDetectionDay: number | null;
  maxUrgency: 'none' | 'watch' | 'action';
  /** Detected (any urgency) when a change was expected, or not flagged when none was. */
  correct: boolean;
  urgencyMatches: boolean;
  /** For changed people: an expected feature was named in at least one detection. */
  rightFeature: boolean | null;
  contributors: SpeechFeature[];
  /** Largest change magnitude and single-feature z over the assessed calls (margin to the thresholds). */
  peakMagnitude: number;
  peakZ: number;
  excluded: { day: number; reasons: string[]; ifIncluded: Urgency | null }[];
  baselineMeans: Partial<Record<SpeechFeature, number>>;
  recentMeans: Partial<Record<SpeechFeature, number>>;
}

export interface Summary {
  people: PersonSummary[];
  detection: {
    changed: number;
    changedDetected: number;
    sensitivity: number;
    changedUrgencyMatches: number;
    stable: number;
    stableFlagged: number;
    stableAssessedCalls: number;
    stableFlaggedCalls: number;
    falsePositiveRatePerCall: number;
    meanFirstDetectionDelayDays: number | null;
  };
  timing: { calls: number; maeMs: number; maxErrorMs: number; meanScriptedMs: number; meanMeasuredMs: number; gapCountMismatches: number };
  disfluency: {
    calls: number;
    inserted: number;
    heard: number;
    /** Count-based: per call, min(heard, inserted) are taken as matched. */
    recall: number;
    precision: number;
    byKind: Record<DisfluencyKind, { inserted: number; heard: number; recall: number; precision: number }>;
    /** Pearson r between scripted and measured repairs per 100 words. */
    rateCorrelation: number | null;
  };
  errors: { listening: number; review: number };
}

const RANK = { none: 0, watch: 1, action: 2 } as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    dx += (x - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  });
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

function featureMeans(calls: CallResult[]): Partial<Record<SpeechFeature, number>> {
  const out: Partial<Record<SpeechFeature, number>> = {};
  for (const f of ['lexicalDiversity', 'repairRate', 'responseLatencyMs', 'topicCoherence'] as const) {
    const xs = calls.filter((c) => c.sample.usable).map((c) => c.sample.features[f]).filter((v): v is number => v !== null);
    if (xs.length) out[f] = mean(xs);
  }
  return out;
}

export function summarisePerson(info: PersonInfo, calls: CallResult[], changeStartDay: number): PersonSummary {
  const detected = calls.filter((c) => c.detection);
  const maxUrgency = detected.reduce<'none' | 'watch' | 'action'>((m, c) => {
    const u = c.detection!.urgency === 'watch' ? 'watch' : 'action';
    return RANK[u] > RANK[m] ? u : m;
  }, 'none');
  const contributors = [...new Set(detected.flatMap((c) => c.assessment.contributors.map((x) => x.feature)))];
  const changed = info.expected !== 'none';
  const assessed = calls.filter((c) => c.assessment.status === 'assessed');
  return {
    ...info,
    calls: calls.length,
    assessedCalls: assessed.length,
    detections: detected.length,
    firstDetectionDay: detected[0]?.day ?? null,
    maxUrgency,
    correct: changed ? detected.length > 0 : detected.length === 0,
    urgencyMatches: maxUrgency === info.expected,
    rightFeature: changed ? (detected.length ? contributors.some((f) => info.expectedFeatures.includes(f)) : false) : null,
    contributors,
    peakMagnitude: Math.max(0, ...assessed.map((c) => c.assessment.magnitude)),
    peakZ: Math.max(0, ...assessed.flatMap((c) => c.assessment.contributors.map((x) => x.adverseZ))),
    excluded: calls
      .filter((c) => !c.sample.usable)
      .map((c) => ({ day: c.day, reasons: c.sample.exclusionReasons, ifIncluded: c.assessment.ifIncluded?.urgency ?? null })),
    baselineMeans: featureMeans(calls.filter((c) => c.day < changeStartDay)),
    recentMeans: featureMeans(calls.filter((c) => c.day >= changeStartDay)),
  };
}

const ratio = (a: number, b: number) => (b ? a / b : NaN);

export function summarise(people: PersonInfo[], results: CallResult[], changeStartDay: number): Summary {
  const persons = people.map((p) =>
    summarisePerson(
      p,
      results.filter((r) => r.personId === p.id).sort((a, b) => a.day - b.day),
      changeStartDay,
    ),
  );
  const changed = persons.filter((p) => p.expected !== 'none');
  const stable = persons.filter((p) => p.expected === 'none');
  const stableIds = new Set(stable.map((p) => p.id));
  const stableAssessed = results.filter((r) => stableIds.has(r.personId) && r.assessment.status === 'assessed');
  const delays = changed.filter((p) => p.firstDetectionDay !== null).map((p) => p.firstDetectionDay! - changeStartDay);

  const timed = results.filter((r) => r.measured.responseLatencyMs !== null);
  const errs = timed.map((r) => Math.abs(r.measured.responseLatencyMs! - r.scripted.medianGapMs));

  const heardCalls = results.filter((r) => r.measured.heard);
  const byKind = {} as Summary['disfluency']['byKind'];
  for (const k of DISFLUENCY_KINDS) {
    const inserted = heardCalls.reduce((a, r) => a + r.scripted.disfluencies[k], 0);
    const heard = heardCalls.reduce((a, r) => a + r.measured.heard![k], 0);
    const matched = heardCalls.reduce((a, r) => a + Math.min(r.scripted.disfluencies[k], r.measured.heard![k]), 0);
    byKind[k] = { inserted, heard, recall: ratio(matched, inserted), precision: ratio(matched, heard) };
  }
  const total = (c: KindCounts) => DISFLUENCY_KINDS.reduce((a, k) => a + c[k], 0);
  const inserted = heardCalls.reduce((a, r) => a + total(r.scripted.disfluencies), 0);
  const heard = heardCalls.reduce((a, r) => a + total(r.measured.heard!), 0);
  const matched = heardCalls.reduce((a, r) => a + Math.min(total(r.scripted.disfluencies), total(r.measured.heard!)), 0);
  const rated = heardCalls.filter((r) => r.measured.repairRate !== null);

  return {
    people: persons,
    detection: {
      changed: changed.length,
      changedDetected: changed.filter((p) => p.detections > 0).length,
      sensitivity: ratio(changed.filter((p) => p.detections > 0).length, changed.length),
      changedUrgencyMatches: changed.filter((p) => p.urgencyMatches).length,
      stable: stable.length,
      stableFlagged: stable.filter((p) => p.detections > 0).length,
      stableAssessedCalls: stableAssessed.length,
      stableFlaggedCalls: stableAssessed.filter((r) => r.detection).length,
      falsePositiveRatePerCall: ratio(stableAssessed.filter((r) => r.detection).length, stableAssessed.length),
      meanFirstDetectionDelayDays: delays.length ? mean(delays) : null,
    },
    timing: {
      calls: timed.length,
      maeMs: mean(errs),
      maxErrorMs: errs.length ? Math.max(...errs) : NaN,
      meanScriptedMs: mean(timed.map((r) => r.scripted.medianGapMs)),
      meanMeasuredMs: mean(timed.map((r) => r.measured.responseLatencyMs!)),
      gapCountMismatches: results.filter((r) => r.measured.gapCount !== r.scripted.gapsMs.length).length,
    },
    disfluency: {
      calls: heardCalls.length,
      inserted,
      heard,
      recall: ratio(matched, inserted),
      precision: ratio(matched, heard),
      byKind,
      rateCorrelation: pearson(
        rated.map((r) => (total(r.scripted.disfluencies) / r.scripted.spokenWords) * 100),
        rated.map((r) => r.measured.repairRate!),
      ),
    },
    errors: {
      listening: results.filter((r) => r.measured.error).length,
      review: results.filter((r) => r.reviewError).length,
    },
  };
}

// ---------------------------------------------------------------- report

const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const num = (x: number | undefined, d = 2) => (x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d));
const ms = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '–' : `${Math.round(x)}`);
const LABEL = { none: '–', watch: 'Monitor (watch)', action: 'Review soon (action)' } as const;

export interface RunInfo {
  seed: number;
  generatedAt: string;
  model: string;
  calls: number;
  people: number;
  durationSec: number;
  geminiRequests: number;
  ttsRequests: number;
  /** What this run charged the monthly ledger, at the configured prices. */
  spentUsd: number;
}

export function renderReport(s: Summary, run: RunInfo): string {
  const d = s.detection;
  const lines: string[] = [];
  lines.push(
    '# R3 (change in speech) — evaluation on SYNTHETIC recordings',
    '',
    '> **All people, calls, voices and recordings in this report are synthetic** (USR-04). They were generated by',
    '> `services/analyzer/eval/` with Cloud Text-to-Speech and scripted pauses and hesitations. No resident data was used.',
    '',
    `Seed ${run.seed} · ${run.people} people · ${run.calls} calls · model \`${run.model}\` · generated ${run.generatedAt.slice(0, 10)} · run time ${Math.round(run.durationSec)} s`,
    '',
    'Each call goes through the production path: `measureRecording()` (VAD response time on the stereo WAV + Gemini',
    'listening to the resident channel), `GeminiReviewer.review()` (topic coherence, temporary conditions) and',
    '`analyse()` with the person’s earlier calls as history. Baseline: calls on days 0–27 (every 3 days, 10 calls);',
    'change starts on day 28 (70% strength, full from day 30); recent calls daily on days 28–32.',
    '',
    '## Headline',
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Changed people detected (sensitivity) | ${d.changedDetected}/${d.changed} (${pct(d.sensitivity)}) |`,
    `| Changed people with the expected urgency | ${d.changedUrgencyMatches}/${d.changed} |`,
    `| Stable people falsely flagged | ${d.stableFlagged}/${d.stable} |`,
    `| False positives per assessed stable call | ${d.stableFlaggedCalls}/${d.stableAssessedCalls} (${pct(d.falsePositiveRatePerCall)}) |`,
    `| Mean delay to first detection | ${d.meanFirstDetectionDelayDays === null ? '–' : `${num(d.meanFirstDetectionDelayDays, 1)} days after the change starts`} |`,
    `| Response time error (measured vs scripted median gap) | MAE ${ms(s.timing.maeMs)} ms, max ${ms(s.timing.maxErrorMs)} ms over ${s.timing.calls} calls |`,
    `| Disfluencies heard by Gemini (count-based) | recall ${pct(s.disfluency.recall)}, precision ${pct(s.disfluency.precision)} (${s.disfluency.heard} heard / ${s.disfluency.inserted} inserted) |`,
    `| Scripted vs measured repairs per 100 words | Pearson r = ${s.disfluency.rateCorrelation === null ? '–' : num(s.disfluency.rateCorrelation)} |`,
    `| Gemini errors after retries | listening ${s.errors.listening}, review ${s.errors.review} |`,
    '',
    '## Per person',
    '',
    '| Person | Scripted change | Expected | Result | First detection | Features named | Peak magnitude / max z | Excluded calls |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const p of s.people) {
    const verdict = p.expected === 'none' ? (p.correct ? 'not flagged ✓' : `flagged ✗ (${p.detections}×)`) : p.correct ? `${LABEL[p.maxUrgency]}${p.urgencyMatches ? ' ✓' : ''}` : 'missed ✗';
    const excluded = p.excluded.map((e) => `day ${e.day} (${e.reasons.join(', ')}; if used: ${e.ifIncluded ?? 'no alert'})`).join('; ') || '–';
    lines.push(
      `| ${p.id} ${p.name} | ${p.note} | ${LABEL[p.expected]} | ${verdict} | ${p.firstDetectionDay === null ? '–' : `day ${p.firstDetectionDay}`} | ${p.contributors.join(', ') || '–'} | ${num(p.peakMagnitude)} / ${p.peakZ ? num(p.peakZ, 1) : '<1'} | ${excluded} |`,
    );
  }
  lines.push(
    '',
    'Thresholds in `packages/core/src/r3.ts`: Monitor (watch) at magnitude ≥ 1.0 or one feature z ≥ 2.0; Review soon (action) at magnitude ≥ 2.0 or one feature z ≥ 3.0. z values below 1 are not reported as contributors.',
  );
  const notable = [
    ...s.people.filter((p) => p.expected !== 'none' && !p.correct).map((p) => `- **Missed:** ${p.id} (${p.note}).`),
    ...s.people.filter((p) => p.expected === 'none' && !p.correct).map((p) => `- **False positive:** ${p.id} flagged on ${p.detections} call(s) (${p.contributors.join(', ')}).`),
    ...s.people
      .filter((p) => p.correct && p.expected !== 'none' && !p.urgencyMatches)
      .map((p) => `- **Urgency differs:** ${p.id} expected ${LABEL[p.expected]}, got ${LABEL[p.maxUrgency]} (peak magnitude ${num(p.peakMagnitude)}, max z ${num(p.peakZ, 1)}).`),
    ...s.people.filter((p) => p.rightFeature === false && p.detections > 0).map((p) => `- **Wrong feature:** ${p.id} was flagged for ${p.contributors.join(', ')}, expected ${p.expectedFeatures.join(' or ')}.`),
  ];
  lines.push('', '## Notable results', '', ...(notable.length ? notable : ['- None: every person got the expected result and urgency.']));
  lines.push(
    '',
    '## Features: baseline mean → recent mean',
    '',
    '| Person | Response time (ms) | Repairs /100 words | Vocabulary (MATTR) | Topic coherence |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const p of s.people) {
    const b = p.baselineMeans;
    const r = p.recentMeans;
    lines.push(
      `| ${p.id} | ${ms(b.responseLatencyMs)} → ${ms(r.responseLatencyMs)} | ${num(b.repairRate, 1)} → ${num(r.repairRate, 1)} | ${num(b.lexicalDiversity, 3)} → ${num(r.lexicalDiversity, 3)} | ${num(b.topicCoherence)} → ${num(r.topicCoherence)} |`,
    );
  }
  lines.push(
    '',
    '## Measurement accuracy',
    '',
    `Response time: mean scripted median gap ${ms(s.timing.meanScriptedMs)} ms, mean measured ${ms(s.timing.meanMeasuredMs)} ms; calls where the number of measured answers differed from the script: ${s.timing.gapCountMismatches}.`,
    '',
    '| Disfluency kind | Inserted | Heard | Recall | Precision |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const k of DISFLUENCY_KINDS) {
    const x = s.disfluency.byKind[k];
    lines.push(`| ${k} | ${x.inserted} | ${x.heard} | ${pct(x.recall)} | ${pct(x.precision)} |`);
  }
  lines.push(
    '',
    'Recall/precision are count-based per call and kind (min(heard, inserted) counted as matched), not position-matched.',
    '',
    `Cost drivers: ${run.geminiRequests} Gemini requests (listening + review) and ${run.ttsRequests} new TTS requests in this run (cached results are reused). Charged $${run.spentUsd.toFixed(2)} to the monthly AI spend ledger.`,
    '',
    '## Limitations',
    '',
    '- Synthetic TTS on a clean line is easier than real phone audio: real speech has overlapping talk, background noise, accents and',
    '  less distinct hesitations, so timing and disfluency accuracy here are an upper bound.',
    '- Baseline variation is scripted (about 10% call-to-call in response time); real people may vary more, which would lower z-scores.',
    '- Small sample: 10 people, and only calls from day 30 can be assessed (3 recent usable calls are required), so the per-call',
    '  false-positive rate rests on few calls. The first possible detection is day 30, two days after the change starts.',
    '- Disfluency recall/precision are count-based per call and kind, not matched by position.',
    '',
  );
  return lines.join('\n');
}
