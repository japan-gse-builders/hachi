import type { SpeechBaseline, SpeechPoint, UsualRange } from './types';

type Method = 'audio' | 'transcript';

interface FeatureInfo {
  key: string;
  title: string;
  show: (v: number) => string;
  higher: string;
  lower: string;
  /** Response time and self-repairs from the recording and from transcript timings are on different scales. */
  timing: boolean;
}

export const SPEECH_FEATURES: FeatureInfo[] = [
  { key: 'responseLatencyMs', title: 'Response time', show: (v) => `${(v / 1000).toFixed(1)} s`, higher: 'slower than usual', lower: 'quicker than usual', timing: true },
  { key: 'repairRate', title: 'Self-corrections and hesitations', show: (v) => `${v.toFixed(1)} per 100 words`, higher: 'more than usual', lower: 'fewer than usual', timing: true },
  { key: 'lexicalDiversity', title: 'Vocabulary variety', show: (v) => v.toFixed(2), higher: 'more varied than usual', lower: 'less varied than usual', timing: false },
  { key: 'topicCoherence', title: 'How well topics connect', show: (v) => v.toFixed(2), higher: 'clearer than usual', lower: 'less clear than usual', timing: false },
];

const EXCLUSION: Record<string, string> = {
  temporary_condition: 'temporary condition such as a cold',
  too_little_speech: 'too little speech',
  poor_audio: 'poor line',
  background_noise: 'background noise',
};

export function exclusionLabel(reasons: string[] | undefined): string {
  return (reasons ?? []).map((r) => EXCLUSION[r] ?? r.replace(/_/g, ' ')).join(', ') || 'not usable';
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export type Side = 'above' | 'below' | null;

export interface ChartPoint {
  callId: string;
  at: string;
  value: number;
  counted: boolean;
  side: Side;
  /** Plain description of this point, used as its tooltip and in the text alternative. */
  label: string;
}

export interface FeatureChart {
  key: string;
  title: string;
  points: ChartPoint[];
  range: UsualRange | null;
  /** Calls not plotted because response time or self-repairs were measured the other way. */
  otherMethod: number;
  summary: string;
  /** The latest counted call is outside the usual range. */
  outsideNow: boolean;
}

const RECENT = 5;

function methodOf(p: SpeechPoint): Method {
  return p.measuredFrom === 'audio' ? 'audio' : 'transcript';
}

function sideOf(v: number, range: UsualRange | null): Side {
  if (!range) return null;
  return v > range.high ? 'above' : v < range.low ? 'below' : null;
}

/** The analyzer compares timing features with the method most recent calls used; the chart does the same. */
function chooseMethod(f: FeatureInfo, trend: SpeechPoint[], baseline: SpeechBaseline | null): Method {
  const counts = { audio: 0, transcript: 0 };
  for (const p of trend.slice(-RECENT * 2)) if (p.usable !== false && p.features[f.key] != null) counts[methodOf(p)]++;
  const ranged = (['audio', 'transcript'] as const).filter((m) => baseline?.ranges[f.key]?.[m]);
  const options = ranged.length ? ranged : (['audio', 'transcript'] as const);
  return options.reduce((a, m) => (counts[m] > counts[a] ? m : a));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describe(f: FeatureInfo, points: ChartPoint[], range: UsualRange | null, otherMethod: number): string {
  const counted = points.filter((p) => p.counted);
  const excluded = points.length - counted.length;
  const parts: string[] = [];
  if (range) parts.push(`Usual range ${f.show(range.low)} to ${f.show(range.high)}.`);
  else parts.push('No usual range yet: it is set from the first 4 weeks of calls.');
  const latest = counted.at(-1);
  if (!latest) parts.push('No counted calls yet.');
  else {
    const where = latest.side ? (latest.side === 'above' ? f.higher : f.lower) : range ? 'within the usual range' : '';
    parts.push(`Latest ${f.show(latest.value)} on ${formatDay(latest.at)}${where ? `, ${where}` : ''}.`);
    if (range) {
      let streak = 0;
      while (streak < counted.length && counted[counted.length - 1 - streak]!.side === latest.side && latest.side) streak++;
      const recent = counted.slice(-RECENT);
      const outside = recent.filter((p) => p.side).length;
      if (streak > 1) parts.push(`Outside the usual range for the last ${streak} calls, since ${formatDay(counted[counted.length - streak]!.at)}.`);
      else if (outside > 0 && !(streak === 1 && outside === 1)) parts.push(`Outside the usual range in ${outside} of the last ${plural(recent.length, 'call')}.`);
    }
  }
  if (excluded) parts.push(`${plural(excluded, 'call')} not counted (shown hollow).`);
  if (otherMethod) parts.push(`${plural(otherMethod, 'call')} measured a different way not shown.`);
  return parts.join(' ');
}

export function speechCharts(trend: SpeechPoint[], baseline: SpeechBaseline | null | undefined): FeatureChart[] {
  const b = baseline ?? null;
  return SPEECH_FEATURES.map((f) => {
    const method = chooseMethod(f, trend, b);
    const range = b?.ranges[f.key]?.[method] ?? null;
    let otherMethod = 0;
    const points: ChartPoint[] = [];
    for (const p of trend) {
      const v = p.features[f.key];
      if (v === null || v === undefined) continue;
      if (f.timing && methodOf(p) !== method) {
        otherMethod++;
        continue;
      }
      const counted = p.usable !== false;
      const side = counted ? sideOf(v, range) : null;
      const note = !counted ? `not counted: ${exclusionLabel(p.exclusionReasons)}` : side ? (side === 'above' ? f.higher : f.lower) : range ? 'within the usual range' : '';
      points.push({ callId: p.callId, at: p.at, value: v, counted, side, label: `${formatDay(p.at)}: ${f.show(v)}${note ? `, ${note}` : ''}` });
    }
    const latest = points.filter((p) => p.counted).at(-1);
    return {
      key: f.key,
      title: f.title,
      points,
      range,
      otherMethod,
      summary: describe(f, points, range, otherMethod),
      outsideNow: !!latest?.side,
    };
  });
}

export const CHART = { width: 300, height: 90, pad: 8 };

/** Positions in the chart's viewBox: time across, value up. */
export function layout(chart: FeatureChart) {
  const { width, height, pad } = CHART;
  const values = chart.points.map((p) => p.value);
  if (chart.range) values.push(chart.range.low, chart.range.high);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const margin = (hi - lo) * 0.08;
  lo -= margin;
  hi += margin;
  const times = chart.points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (at: string) => (t1 === t0 ? width / 2 : pad + ((Date.parse(at) - t0) / (t1 - t0)) * (width - 2 * pad));
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (height - 2 * pad);
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    band: chart.range ? { y: r(y(chart.range.high)), height: r(y(chart.range.low) - y(chart.range.high)), mean: r(y(chart.range.mean)) } : null,
    points: chart.points.map((p) => ({ ...p, x: r(x(p.at)), y: r(y(p.value)) })),
    line: chart.points
      .filter((p) => p.counted)
      .map((p) => `${r(x(p.at))},${r(y(p.value))}`)
      .join(' '),
  };
}
