/** Scores the SYNTHETIC R1/R2 evaluation and renders the report. */
import type { IntakeStatus, Urgency } from '@hachi/core';
import type { R2Expected, Rule } from './r12-scenario.js';

export interface CaseResult {
  seed: number;
  /** Independent Gemini sample of the same transcripts (separate cache entry). */
  repeat: number;
  caseId: string;
  /** Wording variant of the case's key utterances. */
  variant: number;
  rule: Rule;
  polarity: 'positive' | 'negative';
  tag: string;
  expectR1: boolean;
  expectR2: R2Expected;
  reason: string;
  /** The case's own resident lines in the evaluated call. */
  keyLines: string[];
  r1: {
    urgency: Urgency | null;
    /** Keyword rules (`detectR1`, also used live by the voice gateway) fired on a resident turn. */
    byRules: boolean;
    /** Gemini reported an emergency that could be grounded in a resident turn. */
    byModel: boolean;
    symptom?: string;
    quotes: string[];
  };
  r2: {
    urgency: Urgency | null;
    poorIntakeDays: number | null;
    /** Intake the production path stored for each call of the case, oldest first. */
    intake: { day: number; status: IntakeStatus; reportedPoorDays?: number }[];
  };
  reviewErrors: string[];
}

export interface Rate {
  hits: number;
  total: number;
  rate: number | null;
}

export interface RuleScore {
  /** Positives written for the rule that were detected (R2: urgent). */
  sensitivity: Rate;
  /** Every case not expected to trigger the rule, including the other rule's cases. */
  specificity: Rate;
  /** Only the hard negatives written for this rule. */
  hardNegatives: Rate;
  /** Exact match of the expected urgency (R1: emergency / none; R2: urgent / watch / none) over all cases. */
  urgencyMatch: Rate;
}

export interface RunScore {
  seed: number | null;
  repeat: number | null;
  cases: number;
  r1: RuleScore & { rulesOnly: Pick<RuleScore, 'sensitivity' | 'specificity'>; modelOnly: Pick<RuleScore, 'sensitivity' | 'specificity'> };
  r2: RuleScore;
  reviewErrors: number;
}

export type MissKind = 'missed' | 'false positive' | 'urgency differs';

export interface Miss {
  seed: number;
  repeat: number;
  caseId: string;
  variant: number;
  rule: Rule;
  kind: MissKind;
  expected: string;
  got: string;
  /** R1: which component fired; R2: intake per call. */
  detail: string;
  quote: string;
  reason: string;
}

export interface CaseSummary {
  caseId: string;
  rule: Rule;
  polarity: 'positive' | 'negative';
  tag: string;
  expected: string;
  /** Outcome → number of runs, e.g. { "emergency (rules+Gemini)": 6, "none": 2 }. */
  outcomes: Record<string, number>;
  correct: number;
  runs: number;
  reason: string;
}

export interface Summary {
  runs: RunScore[];
  pooled: RunScore;
  cases: CaseSummary[];
  misses: Miss[];
  /** Cases whose correctness differed between Gemini samples of the same transcript ("case v0 seed 7"). */
  unstable: string[];
}

const rate = (hits: number, total: number): Rate => ({ hits, total, rate: total ? hits / total : null });
const count = <T>(xs: T[], f: (x: T) => boolean): Rate => rate(xs.filter(f).length, xs.length);

const r1Expected = (r: CaseResult): Urgency | null => (r.expectR1 ? 'emergency' : null);
export const r1Correct = (r: CaseResult) => (r.r1.urgency !== null) === r.expectR1;
export const r2Correct = (r: CaseResult) => r.r2.urgency === r.expectR2;
const r2Alert = (u: Urgency | null) => u === 'urgent' || u === 'emergency';

function via(r: CaseResult): string {
  if (r.r1.byRules && r.r1.byModel) return 'rules+Gemini';
  return r.r1.byRules ? 'rules' : r.r1.byModel ? 'Gemini' : '–';
}

export function score(results: CaseResult[], seed: number | null = null, repeat: number | null = null): RunScore {
  const r1Pos = results.filter((r) => r.expectR1);
  const r1Neg = results.filter((r) => !r.expectR1);
  const r2Pos = results.filter((r) => r.expectR2 === 'urgent');
  const r2Neg = results.filter((r) => r.expectR2 !== 'urgent');
  return {
    seed,
    repeat,
    cases: results.length,
    r1: {
      sensitivity: count(r1Pos, (r) => r.r1.urgency !== null),
      specificity: count(r1Neg, (r) => r.r1.urgency === null),
      hardNegatives: count(
        r1Neg.filter((r) => r.rule === 'R1'),
        (r) => r.r1.urgency === null,
      ),
      urgencyMatch: count(results, (r) => r.r1.urgency === r1Expected(r)),
      rulesOnly: { sensitivity: count(r1Pos, (r) => r.r1.byRules), specificity: count(r1Neg, (r) => !r.r1.byRules) },
      modelOnly: { sensitivity: count(r1Pos, (r) => r.r1.byModel), specificity: count(r1Neg, (r) => !r.r1.byModel) },
    },
    r2: {
      sensitivity: count(r2Pos, (r) => r2Alert(r.r2.urgency)),
      specificity: count(r2Neg, (r) => !r2Alert(r.r2.urgency)),
      hardNegatives: count(
        r2Neg.filter((r) => r.rule === 'R2'),
        (r) => !r2Alert(r.r2.urgency),
      ),
      urgencyMatch: count(results, r2Correct),
    },
    reviewErrors: results.reduce((a, r) => a + r.reviewErrors.length, 0),
  };
}

const intakeText = (r: CaseResult) => r.r2.intake.map((i) => `d${i.day} ${i.status}${i.reportedPoorDays ? `(${i.reportedPoorDays}d)` : ''}`).join(', ');
const r2Label = (u: Urgency | null) => u ?? 'none';

export function misses(results: CaseResult[]): Miss[] {
  const out: Miss[] = [];
  for (const r of results) {
    const base = { seed: r.seed, repeat: r.repeat, caseId: r.caseId, variant: r.variant, quote: r.keyLines.join(' / '), reason: r.reason };
    if (!r1Correct(r)) {
      out.push({
        ...base,
        rule: 'R1',
        kind: r.expectR1 ? 'missed' : 'false positive',
        expected: r.expectR1 ? 'emergency' : 'none',
        got: r.r1.urgency ? `emergency (${via(r)})` : 'none',
        detail: r.r1.symptom ? `Gemini: ${r.r1.symptom}` : via(r),
      });
    }
    if (!r2Correct(r)) {
      const kind: MissKind = r.expectR2 === 'urgent' ? 'missed' : r2Alert(r.r2.urgency) ? 'false positive' : 'urgency differs';
      out.push({ ...base, rule: 'R2', kind, expected: r2Label(r.expectR2), got: r2Label(r.r2.urgency), detail: intakeText(r) });
    }
  }
  return out;
}

function outcome(r: CaseResult): string {
  if (r.rule === 'R1') return r.r1.urgency ? `emergency (${via(r)})` : 'none';
  return r2Label(r.r2.urgency);
}

export function summarise(results: CaseResult[]): Summary {
  const runKeys = [...new Set(results.map((r) => `${r.seed}:${r.repeat}`))];
  const runs = runKeys.map((k) => {
    const [seed, repeat] = k.split(':').map(Number) as [number, number];
    return score(
      results.filter((r) => r.seed === seed && r.repeat === repeat),
      seed,
      repeat,
    );
  });
  const ok = (r: CaseResult) => r1Correct(r) && r2Correct(r);
  const ids = [...new Set(results.map((r) => r.caseId))];
  const cases = ids.map((id): CaseSummary => {
    const rs = results.filter((r) => r.caseId === id);
    const first = rs[0]!;
    const outcomes: Record<string, number> = {};
    for (const r of rs) outcomes[outcome(r)] = (outcomes[outcome(r)] ?? 0) + 1;
    return {
      caseId: id,
      rule: first.rule,
      polarity: first.polarity,
      tag: first.tag,
      expected: first.rule === 'R1' ? (first.expectR1 ? 'emergency' : 'none') : r2Label(first.expectR2),
      outcomes,
      correct: rs.filter(ok).length,
      runs: rs.length,
      reason: first.reason,
    };
  });
  const samples = new Map<string, Set<boolean>>();
  for (const r of results) {
    const key = `${r.caseId} v${r.variant} seed ${r.seed}`;
    samples.set(key, (samples.get(key) ?? new Set<boolean>()).add(ok(r)));
  }
  const unstable = [...samples].filter(([, s]) => s.size > 1).map(([k]) => k);
  return { runs, pooled: score(results), cases, misses: misses(results), unstable };
}

// ---------------------------------------------------------------- report

export interface RunInfo {
  seeds: number[];
  repeats: number;
  generatedAt: string;
  model: string;
  cases: number;
  calls: number;
  durationSec: number;
  geminiRequests: number;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

const pct = (r: Rate) => (r.rate === null ? '–' : `${r.hits}/${r.total} (${Math.round(r.rate * 100)}%)`);
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderReport(s: Summary, run: RunInfo): string {
  const p = s.pooled;
  const runCols = s.runs.map((r) => `seed ${r.seed} #${r.repeat}`);
  const row = (label: string, f: (r: RunScore) => Rate) => `| ${label} | ${[p, ...s.runs].map((r) => pct(f(r))).join(' | ')} |`;
  const lines = [
    '# R1 (acute danger) / R2 (not eating) — evaluation on SYNTHETIC transcripts',
    '',
    '> **All residents, calls and transcripts in this report are synthetic** (USR-04). They were generated by',
    '> `services/analyzer/eval/r12-scenario.ts` from hand-written utterances. No resident data was used.',
    '',
    `Seeds ${run.seeds.join(', ')} × ${run.repeats} Gemini samples each · ${run.cases} cases × 2 wording variants · ${run.calls} calls analysed · model \`${run.model}\` · generated ${run.generatedAt.slice(0, 10)} · run time ${Math.round(run.durationSec)} s · ${run.geminiRequests ? `${run.geminiRequests} new Gemini requests` : 'all Gemini reviews from the local cache'}${run.estimatedCostUsd !== null ? ` (≈ $${run.estimatedCostUsd.toFixed(2)})` : ''}`,
    '',
    'Each call goes through the production worker, `analyzeCall()` (`services/analyzer/src/worker.ts`), against an',
    'in-memory store: `GeminiReviewer.review()` → `analyse()` (keyword rules `detectR1` on every resident turn + the',
    "model's grounded emergencies for R1; the model's intake judgement + `assessR2` over the last 7 days of stored",
    'calls for R2) → `recordDetections()`. Earlier calls of a case are analysed first, so R2 sees the history the',
    'worker would see. Nothing is written to Firestore or Cloud Storage and no calls or texts are placed.',
    '',
    'Expected labels were fixed in `r12-scenario.ts` before the first run, with a reason each. Every case is run in',
    'both of its wording variants; the seed changes name, small talk, position of the key utterance and dates. Each',
    'transcript is reviewed by Gemini more than once (separate cache entries) to show model variance. Thresholds and',
    'prompts were not tuned; the keyword rules were revised once after the first run (see "Change since the first run").',
    'R2 counts as detected only at **urgent** (2+ consecutive poor days); one poor day gives a **watch** R2 by design',
    '(DET-04), which is scored in the urgency match, not as a detection.',
    '',
    '## Headline',
    '',
    `| Metric | pooled | ${runCols.join(' | ')} |`,
    `| --- | --- | ${runCols.map(() => '---').join(' | ')} |`,
    row('R1 sensitivity (positives raised as emergency)', (r) => r.r1.sensitivity),
    row('R1 specificity (all non-R1 cases)', (r) => r.r1.specificity),
    row('R1 hard negatives not raised', (r) => r.r1.hardNegatives),
    row('R1 expected urgency matched', (r) => r.r1.urgencyMatch),
    row('R1 keyword rules alone: sensitivity', (r) => r.r1.rulesOnly.sensitivity),
    row('R1 keyword rules alone: specificity', (r) => r.r1.rulesOnly.specificity),
    row('R1 Gemini alone: sensitivity', (r) => r.r1.modelOnly.sensitivity),
    row('R1 Gemini alone: specificity', (r) => r.r1.modelOnly.specificity),
    row('R2 sensitivity (positives reaching urgent)', (r) => r.r2.sensitivity),
    row('R2 specificity (no urgent R2 when not expected)', (r) => r.r2.specificity),
    row('R2 hard negatives not urgent', (r) => r.r2.hardNegatives),
    row('R2 expected urgency matched (urgent / watch / none)', (r) => r.r2.urgencyMatch),
    `| Gemini errors after retries | ${[p, ...s.runs].map((r) => r.reviewErrors).join(' | ')} |`,
    '',
    `Gemini variance: ${s.unstable.length ? `${s.unstable.length} transcript(s) changed outcome between samples of the same transcript: ${s.unstable.join(', ')}.` : 'no transcript changed outcome between samples.'}`,
    '',
    '### Change since the first run',
    '',
    'The first run (same cases, seeds and cached Gemini reviews) gave R1 specificity 224/264 (85%): all 40 false alarms',
    'came from the keyword rules, Gemini alone had none. The rules alone also missed 56/128 positives (sensitivity 56%),',
    'which Gemini caught after the call but the voice gateway could not bridge during it. `detectR1`',
    '(`packages/core/src/r1.ts`) was then revised with general sentence-level rules, each with unit tests and',
    'counterexamples that must still fire:',
    '',
    '- whose symptom: the nearest person named in the clause (also "a man", "the old lady", "a character", "Mrs …"), or',
    '  the previous subject when "and" drops it ("she fell and can\'t get up");',
    '- figures of speech: "gave me a heart attack";',
    '- passing symptoms (breathlessness, racing heart, choking, feeling faint) told in the past tense and over, or as a',
    '  reaction to laughter / excitement / something watched; never when told in the present or "still";',
    '- long-standing limits ("can\'t get up the hill", "… easily", "anymore") unless a fall, the floor or being stuck is',
    '  mentioned;',
    '- added wordings: "can\'t seem to", "can hardly breathe", "hurts to breathe", choking, "can\'t get myself up", "still',
    '  on the floor", "been on the floor since", "legs won\'t hold me", speech coming out wrong, a floppy / limp arm, a',
    '  droop of the mouth, "feeling faint", "send someone" / "get someone to come round", "I need a doctor".',
    '',
    'These numbers are therefore on the development set and overstate how the rules will do on new wording; a',
    'held-out set of new utterances is needed for an unbiased estimate. In the call the gateway checks each streamed',
    'fragment as it arrives, so an exclusion that depends on words after the symptom ("…, but I was fine",',
    '"… I laughed so much") only applies if those words arrive in the same fragment; otherwise the alarm is raised.',
    '',
    '## Misses and false positives',
    '',
  ];
  if (!s.misses.length) lines.push('None.', '');
  else {
    lines.push(
      'Identical outcomes for the same wording are merged; "runs" lists seed #sample. Detail: R1 = component that fired, R2 = intake stored per call.',
      '',
      '| Case (variant) | Rule | Kind | Expected | Got | Runs | Detail | Resident said | Why the label |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    const groups = new Map<string, Miss[]>();
    for (const m of s.misses) {
      const key = [m.caseId, m.variant, m.rule, m.kind, m.got].join('|');
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    for (const ms of groups.values()) {
      const m = ms[0]!;
      const runs = ms.map((x) => `${x.seed}#${x.repeat}`).join(', ');
      const details = [...new Set(ms.map((x) => x.detail))].join(' / ');
      lines.push(`| ${m.caseId} (v${m.variant}) | ${m.rule} | ${m.kind} | ${m.expected} | ${m.got} | ${runs} | ${esc(details)} | ${esc(m.quote)} | ${esc(m.reason)} |`);
    }
    lines.push('');
  }
  lines.push('## Per case', '', 'Each case runs in 2 wording variants × every seed and Gemini sample.', '', '| Case | Written for | Tag | Expected | Correct | Outcomes |', '| --- | --- | --- | --- | --- | --- |');
  for (const c of s.cases) {
    const mark = c.correct === c.runs ? '✓' : c.correct === 0 ? '✗' : '±';
    const outcomes = Object.entries(c.outcomes)
      .map(([o, n]) => `${o} ×${n}`)
      .join('; ');
    lines.push(`| ${c.caseId} | ${c.rule} ${c.polarity} | ${esc(c.tag)} | ${c.expected} | ${c.correct}/${c.runs} ${mark} | ${outcomes} |`);
  }
  lines.push(
    '',
    'R1 outcomes name the component that fired: `rules` = keyword safety net (`detectR1`, the same check the voice',
    'gateway runs live), `Gemini` = post-call review. The reason for every label is in `r12-scenario.ts` and in',
    '`r12-synthetic.json`.',
    '',
    '## Limitations',
    '',
    '- Synthetic, hand-written English transcripts (USR-04); real speech is messier, and real ASR errors, accents and',
    '  crosstalk are not modelled. Transcript level only: no audio, no TTS, no live voice agent.',
    '- The Hachi turns are neutral and identical for positives and negatives; the live agent would react to a',
    '  complaint (and the voice gateway would already have raised R1 in the call, which makes the worker skip R1).',
    '- Small sample: about 50 cases with 2 wording variants each; seeds and repeated samples of the same wording are',
    '  not independent, so rates have wide confidence intervals and one case moves a rate by several points. Cases are',
    '  deliberately hard, so rates are not a prevalence-weighted estimate.',
    '- Labels are one reviewer\'s judgement, decided up front; borderline cases (e.g. the ambulance that has just left,',
    '  breathlessness after exertion) are documented in the case reason and could reasonably be labelled differently.',
    '- Gemini is sampled at temperature 0.2; each transcript is reviewed only twice, which shows variance but does not',
    '  estimate it precisely.',
    '',
  );
  return lines.join('\n');
}
