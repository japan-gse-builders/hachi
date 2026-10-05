import type { Trend } from './types.js';
import type { Urgency } from './urgency.js';

export interface Turn {
  speaker: 'resident' | 'agent';
  text: string;
  startMs: number;
  endMs: number;
}

export const SPEECH_FEATURES = ['lexicalDiversity', 'repairRate', 'responseLatencyMs', 'topicCoherence'] as const;
export type SpeechFeature = (typeof SPEECH_FEATURES)[number];

/** +1: higher value is worse; -1: lower value is worse. */
const ADVERSE_DIRECTION: Record<SpeechFeature, 1 | -1> = {
  lexicalDiversity: -1,
  repairRate: 1,
  responseLatencyMs: 1,
  topicCoherence: -1,
};

/** Minimum standard deviation per feature so a very stable baseline does not inflate z-scores. */
const MIN_STD: Record<SpeechFeature, number> = {
  lexicalDiversity: 0.02,
  repairRate: 0.5,
  responseLatencyMs: 150,
  topicCoherence: 0.05,
};

export type SpeechFeatures = Record<SpeechFeature, number | null>;

export type ExclusionReason = 'too_little_speech' | 'poor_audio' | 'background_noise' | 'temporary_condition';

export type SpeechExampleKind = 'filler' | 'repetition' | 'false_start' | 'correction' | 'slow_response';

/** SPK-03: a concrete moment behind a feature, with its place in the recording. */
export interface SpeechExample {
  kind: SpeechExampleKind;
  quote: string;
  startMs?: number;
}

/** Response time and self-repairs measured from the recording rather than the live transcript. */
export interface VoiceMeasures {
  responseLatencyMs: number | null;
  repairRate: number | null;
  examples: SpeechExample[];
}

/**
 * Where response time and self-repairs come from. `transcript`: the turn timings and words are
 * exact (imported history). `unavailable`: a live call whose recording could not be measured; the
 * live transcript drops hesitations and its timings lag, so those two features are left out.
 */
export type TimingSource = VoiceMeasures | 'transcript' | 'unavailable';

export interface CallSpeechSample {
  callId: string;
  /** ISO timestamp of the call. */
  at: string;
  features: SpeechFeatures;
  usable: boolean;
  exclusionReasons: ExclusionReason[];
  measuredFrom?: 'audio' | 'transcript' | 'text_only';
  examples?: SpeechExample[];
}

export interface QualitySignals {
  /** 0..1 from the telephony/ASR layer. */
  audioQuality?: number;
  noisy?: boolean;
  /** Resident mentioned a cold, dentures, etc. during the call (SPK-04). */
  temporaryCondition?: boolean;
}

export const MIN_RESIDENT_WORDS = 60;
const MATTR_WINDOW = 50;

const REPAIR_MARKERS = /\b(i mean|sorry,? i mean|what i meant|let me start again|no wait|uh|um|er|erm)\b/g;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 0 && t !== "'");
}

/** Moving-average type-token ratio; robust to differing amounts of speech. */
export function mattr(tokens: string[], window = MATTR_WINDOW): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  for (let i = 0; i < window; i++) counts.set(tokens[i]!, (counts.get(tokens[i]!) ?? 0) + 1);
  let sum = counts.size / window;
  for (let i = window; i < tokens.length; i++) {
    const out = tokens[i - window]!;
    const c = counts.get(out)! - 1;
    if (c === 0) counts.delete(out);
    else counts.set(out, c);
    counts.set(tokens[i]!, (counts.get(tokens[i]!) ?? 0) + 1);
    sum += counts.size / window;
  }
  return sum / (tokens.length - window + 1);
}

/** Self-repairs and fillers per 100 words, including immediate word repetitions ("the the"). */
export function repairRate(text: string): number | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const markers = text.toLowerCase().match(REPAIR_MARKERS)?.length ?? 0;
  let repeats = 0;
  for (let i = 1; i < tokens.length; i++) if (tokens[i] === tokens[i - 1]) repeats++;
  const cutoffs = text.match(/\b\w+-\s/g)?.length ?? 0;
  return ((markers + repeats + cutoffs) / tokens.length) * 100;
}

/** Median gap between the end of an agent turn and the start of the next resident turn. */
export function medianResponseLatency(turns: Turn[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1]!;
    const cur = turns[i]!;
    if (prev.speaker === 'agent' && cur.speaker === 'resident') {
      const gap = cur.startMs - prev.endMs;
      if (gap >= 0 && gap < 20_000) gaps.push(gap);
    }
  }
  return median(gaps);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * SPK-01 / SPK-04. `topicCoherence` (0..1) comes from the LLM analysis because it needs
 * semantic understanding.
 */
export function extractSpeechSample(
  callId: string,
  at: string,
  turns: Turn[],
  topicCoherence: number | null,
  quality: QualitySignals = {},
  timing: TimingSource = 'transcript',
): CallSpeechSample {
  const residentText = turns.filter((t) => t.speaker === 'resident').map((t) => t.text).join(' ');
  const tokens = tokenize(residentText);
  const voice = typeof timing === 'object' ? timing : null;
  const exclusionReasons: ExclusionReason[] = [];
  if (tokens.length < MIN_RESIDENT_WORDS) exclusionReasons.push('too_little_speech');
  if (quality.audioQuality !== undefined && quality.audioQuality < 0.6) exclusionReasons.push('poor_audio');
  if (quality.noisy) exclusionReasons.push('background_noise');
  if (quality.temporaryCondition) exclusionReasons.push('temporary_condition');
  return {
    callId,
    at,
    features: {
      lexicalDiversity: mattr(tokens),
      repairRate: voice ? voice.repairRate : timing === 'transcript' ? repairRate(residentText) : null,
      responseLatencyMs: voice ? voice.responseLatencyMs : timing === 'transcript' ? medianResponseLatency(turns) : null,
      topicCoherence,
    },
    usable: exclusionReasons.length === 0,
    exclusionReasons,
    measuredFrom: voice ? 'audio' : timing === 'transcript' ? 'transcript' : 'text_only',
    ...(voice && voice.examples.length ? { examples: voice.examples } : {}),
  };
}

export interface FeatureStats {
  mean: number;
  std: number;
  n: number;
}

export type TimingFeature = 'repairRate' | 'responseLatencyMs';
export type MeasurementMethod = 'audio' | 'transcript';

/**
 * Response time and self-repairs measured from the recording and from transcript timings are on
 * different scales (transcript timings lag by seconds), so each is only compared with itself.
 */
function isTiming(f: SpeechFeature): f is TimingFeature {
  return f === 'repairRate' || f === 'responseLatencyMs';
}

function methodOf(s: CallSpeechSample): MeasurementMethod {
  return s.measuredFrom === 'audio' ? 'audio' : 'transcript';
}

export interface SpeechBaseline {
  from: string;
  to: string;
  callCount: number;
  /** Vocabulary and topic coherence, however the call was measured. */
  stats: Partial<Record<Exclude<SpeechFeature, TimingFeature>, FeatureStats>>;
  timing: Partial<Record<MeasurementMethod, Partial<Record<TimingFeature, FeatureStats>>>>;
}

export const BASELINE_DAYS = 28;
/** How many of a resident's latest calls the analysis reads, and so builds the baseline from. */
export const HISTORY_CALLS = 120;
export const MIN_BASELINE_CALLS = 8;

function statsOf(values: (number | null)[]): FeatureStats | undefined {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length < MIN_BASELINE_CALLS) return undefined;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (xs.length - 1);
  return { mean, std: Math.sqrt(variance), n: xs.length };
}

/** SPK-02: baseline from usable calls within the first BASELINE_DAYS of service. */
export function buildBaseline(samples: CallSpeechSample[], serviceStart: string): SpeechBaseline | null {
  const start = Date.parse(serviceStart);
  const end = start + BASELINE_DAYS * 86_400_000;
  const inWindow = samples.filter((s) => {
    const t = Date.parse(s.at);
    return s.usable && t >= start && t < end;
  });
  if (inWindow.length < MIN_BASELINE_CALLS) return null;
  const stats: SpeechBaseline['stats'] = {};
  for (const f of ['lexicalDiversity', 'topicCoherence'] as const) {
    const st = statsOf(inWindow.map((s) => s.features[f]));
    if (st) stats[f] = st;
  }
  const timing: SpeechBaseline['timing'] = {};
  for (const m of ['audio', 'transcript'] as const) {
    const own = inWindow.filter((s) => methodOf(s) === m);
    for (const f of ['repairRate', 'responseLatencyMs'] as const) {
      const st = statsOf(own.map((s) => s.features[f]));
      if (st) timing[m] = { ...timing[m], [f]: st };
    }
  }
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), callCount: inWindow.length, stats, timing };
}

/** The baseline to compare `f` against for a call measured with `method`. */
export function baselineFor(baseline: SpeechBaseline, f: SpeechFeature, method: MeasurementMethod): FeatureStats | undefined {
  return isTiming(f) ? baseline.timing[method]?.[f] : baseline.stats[f];
}

export interface FeatureChange {
  feature: SpeechFeature;
  /** Positive = change in the adverse direction, in baseline standard deviations. */
  adverseZ: number;
  baselineMean: number;
  recentMean: number;
}

export interface SpeechChangeAssessment {
  status: 'no_baseline' | 'insufficient_recent' | 'assessed';
  magnitude: number;
  trend: Trend;
  urgency: Urgency | null;
  contributors: FeatureChange[];
  recentCallIds: string[];
}

export const RECENT_WINDOW = 5;
const CLEAR_CHANGE = 2.0;
const SLIGHT_CHANGE = 1.0;
const SINGLE_FEATURE_CLEAR = 3.0;

function effectiveStd(f: SpeechFeature, s: FeatureStats): number {
  return Math.max(s.std, MIN_STD[f], Math.abs(s.mean) * 0.05);
}

function compositeFor(sample: CallSpeechSample, baseline: SpeechBaseline): number | null {
  const zs: number[] = [];
  for (const f of SPEECH_FEATURES) {
    const st = baselineFor(baseline, f, methodOf(sample));
    const v = sample.features[f];
    if (!st || v === null) continue;
    zs.push((ADVERSE_DIRECTION[f] * (v - st.mean)) / effectiveStd(f, st));
  }
  return zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
}

function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return num / den;
}

/**
 * SPK-02 / SPK-03: compares the most recent usable calls against the resident's own baseline.
 * Never compares against other people.
 */
export function assessSpeechChange(samples: CallSpeechSample[], baseline: SpeechBaseline | null): SpeechChangeAssessment {
  const empty = { magnitude: 0, trend: 'stable' as Trend, urgency: null, contributors: [], recentCallIds: [] };
  if (!baseline) return { status: 'no_baseline', ...empty };
  const baselineEnd = Date.parse(baseline.to);
  const recent = samples
    .filter((s) => s.usable && Date.parse(s.at) >= baselineEnd)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-RECENT_WINDOW);
  if (recent.length < 3) return { status: 'insufficient_recent', ...empty };

  const contributors: FeatureChange[] = [];
  for (const f of SPEECH_FEATURES) {
    // With both kinds of recent calls, use the method that has more of them (the recording on a tie).
    const byMethod = (['audio', 'transcript'] as const)
      .map((m) => ({
        st: baselineFor(baseline, f, m),
        vals: recent.filter((s) => !isTiming(f) || methodOf(s) === m).map((s) => s.features[f]).filter((v): v is number => v !== null),
      }))
      .filter((x) => x.st && x.vals.length);
    const best = byMethod.reduce<(typeof byMethod)[number] | undefined>((a, x) => (!a || x.vals.length > a.vals.length ? x : a), undefined);
    if (!best) continue;
    const st = best.st!;
    const vals = best.vals;
    const recentMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const adverseZ = (ADVERSE_DIRECTION[f] * (recentMean - st.mean)) / effectiveStd(f, st);
    contributors.push({ feature: f, adverseZ, baselineMean: st.mean, recentMean });
  }
  const magnitude = contributors.length
    ? contributors.reduce((a, c) => a + Math.max(0, c.adverseZ), 0) / contributors.length
    : 0;
  const composites = recent.map((s) => compositeFor(s, baseline)).filter((v): v is number => v !== null);
  const sl = slope(composites);
  const trend: Trend = sl > 0.25 ? 'worsening' : sl < -0.25 ? 'improving' : 'stable';

  const maxZ = Math.max(0, ...contributors.map((c) => c.adverseZ));
  let urgency: Urgency | null = null;
  if (magnitude >= CLEAR_CHANGE || maxZ >= SINGLE_FEATURE_CLEAR) urgency = 'action';
  else if (magnitude >= SLIGHT_CHANGE || maxZ >= CLEAR_CHANGE) urgency = 'watch';

  return {
    status: 'assessed',
    magnitude,
    trend,
    urgency,
    contributors: contributors.filter((c) => c.adverseZ >= SLIGHT_CHANGE).sort((a, b) => b.adverseZ - a.adverseZ),
    recentCallIds: recent.map((s) => s.callId),
  };
}

const FEATURE_TEXT: Record<'ja' | 'en', Record<SpeechFeature, string>> = {
  ja: {
    lexicalDiversity: '使う言葉の種類が平常時より減っている',
    repairRate: '言い直しや言いよどみが平常時より増えている',
    responseLatencyMs: '応答までの時間が平常時より延びている',
    topicCoherence: '話題のつながりが平常時より弱くなっている',
  },
  en: {
    lexicalDiversity: 'Vocabulary variety is lower than usual',
    repairRate: 'Self-corrections and hesitations are more frequent than usual',
    responseLatencyMs: 'Response time is longer than usual',
    topicCoherence: 'Topics connect less clearly than usual',
  },
};

export function describeFeatureChange(c: FeatureChange, locale: 'ja' | 'en'): string {
  return FEATURE_TEXT[locale][c.feature];
}

/** `trend` is about the size of the change across recent calls, so a flat one says nothing new. */
const TREND_TEXT: Record<'ja' | 'en', Record<Trend, string | null>> = {
  ja: { worsening: '直近の通話でさらに強まっている', improving: '直近の通話では和らいできている', stable: null },
  en: { worsening: 'getting worse over recent calls', improving: 'easing over recent calls', stable: null },
};

export function describeTrend(trend: Trend, locale: 'ja' | 'en'): string | null {
  return TREND_TEXT[locale][trend];
}

/** The resident's usual range for a feature: the baseline mean ± 2 of the standard deviations the assessment uses. */
export function usualRange(f: SpeechFeature, s: FeatureStats): { mean: number; low: number; high: number; n: number } {
  const spread = 2 * effectiveStd(f, s);
  return { mean: s.mean, low: Math.max(0, s.mean - spread), high: s.mean + spread, n: s.n };
}
