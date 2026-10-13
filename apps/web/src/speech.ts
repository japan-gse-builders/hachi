import type { SpeechBaseline, SpeechPoint, SpeechStatus, UsualRange } from './types';

type Method = 'audio' | 'transcript';

interface FeatureInfo {
  key: string;
  /** What the measure is about, in everyday words. */
  title: string;
  /** What a higher value means, for the axis caption. */
  meaning: string;
  /** The axis is drawn in these units: stored value × `scale`. */
  unit: string;
  scale: number;
  suffix: string;
  show: (v: number) => string;
  higher: string;
  lower: string;
  /** Response time and self-repairs from the recording and from transcript timings are on different scales. */
  timing: boolean;
}

export const SPEECH_FEATURES: FeatureInfo[] = [
  {
    key: 'responseLatencyMs',
    title: 'Time to answer',
    meaning: 'Higher means slower to answer',
    unit: 'seconds',
    scale: 0.001,
    suffix: ' s',
    show: (v) => `${(v / 1000).toFixed(1)} s`,
    higher: 'slower than usual',
    lower: 'quicker than usual',
    timing: true,
  },
  {
    key: 'repairRate',
    title: 'Stops and restarts',
    meaning: 'Higher means more stops and restarts',
    unit: 'per 100 words',
    scale: 1,
    suffix: '',
    show: (v) => `${v.toFixed(1)} per 100 words`,
    higher: 'more than usual',
    lower: 'fewer than usual',
    timing: true,
  },
  {
    key: 'lexicalDiversity',
    title: 'Word variety',
    meaning: 'Higher means more varied words',
    unit: '% of words not repeated',
    scale: 100,
    suffix: '%',
    show: (v) => `${Math.round(v * 100)}% of words not repeated`,
    higher: 'more varied than usual',
    lower: 'less varied than usual',
    timing: false,
  },
  {
    key: 'topicCoherence',
    title: 'Staying on topic',
    meaning: 'Higher means staying on topic more',
    unit: 'out of 100',
    scale: 100,
    suffix: '',
    show: (v) => `${Math.round(v * 100)} out of 100`,
    higher: 'more on topic than usual',
    lower: 'less on topic than usual',
    timing: false,
  },
];

/** As the analyzer's MIN_BASELINE_CALLS: the usual range needs this many usable calls from the first 4 weeks. */
export const USUAL_RANGE_CALLS = 8;

const EXCLUSION: Record<string, string> = {
  temporary_condition: 'temporary condition such as a cold',
  too_little_speech: 'too little speech',
  poor_audio: 'poor line',
  background_noise: 'background noise',
};

export function exclusionLabel(reasons: string[] | undefined): string {
  return (reasons ?? []).map((r) => EXCLUSION[r] ?? r.replace(/_/g, ' ')).join(', ') || 'not usable';
}

/** The value in axis units, for tables: "2.4 s", "62%". */
export function shortValue(key: string, v: number): string {
  const f = SPEECH_FEATURES.find((x) => x.key === key);
  if (!f) return String(v);
  return `${(v * f.scale).toFixed(f.scale === 100 ? 0 : 1)}${f.suffix}`;
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
  /** The value in the measure's own words, such as "2.4 s". */
  shown: string;
  /** Against the usual range: "slower than usual", "within the usual range" or why it was not counted. */
  note: string;
  /** Plain description of this point, used as its accessible name and in the text alternative. */
  label: string;
}

export interface FeatureChart {
  key: string;
  title: string;
  meaning: string;
  unit: string;
  points: ChartPoint[];
  range: UsualRange | null;
  /** "0.6 to 1.2 s", or '' without a range. */
  rangeText: string;
  /** Calls not plotted because response time or self-repairs were measured the other way. */
  otherMethod: number;
  summary: string;
  /** One sentence on where the latest call stands, for the chip and the chart caption. */
  headline: string;
  status: SpeechStatus;
  /** Counted calls in a row, back from the latest, outside the range on the same side. */
  streak: number;
  /** The latest counted call is outside the usual range. */
  outsideNow: boolean;
}

const RECENT = 5;
/** Per measure, not R3's combined reading: this many calls in a row outside the range reads as a clear change. */
const CLEAR_STREAK = 3;

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

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function rangeOf(f: FeatureInfo, range: UsualRange | null): string {
  if (!range) return '';
  const low = f.show(range.low).replace(/ .*$/, '');
  return `${low} to ${f.show(range.high)}`;
}

function streakOf(counted: ChartPoint[]): number {
  const latest = counted.at(-1);
  if (!latest?.side) return 0;
  let streak = 0;
  while (streak < counted.length && counted[counted.length - 1 - streak]!.side === latest.side) streak++;
  return streak;
}

function statusOf(range: UsualRange | null, counted: ChartPoint[], streak: number): SpeechStatus {
  if (!range) return 'no_baseline';
  if (!counted.length) return 'insufficient_recent';
  if (!streak) return 'usual';
  return streak >= CLEAR_STREAK ? 'clear_change' : 'slight_change';
}

function headlineOf(f: FeatureInfo, status: SpeechStatus, counted: ChartPoint[], streak: number): string {
  if (status === 'no_baseline') return 'No usual range yet.';
  if (status === 'insufficient_recent') return 'No counted calls yet.';
  if (status === 'usual') return 'Within the usual range in the latest call.';
  const latest = counted.at(-1)!;
  const words = capital(latest.side === 'above' ? f.higher : f.lower);
  if (streak === 1) return `${words} in the latest call.`;
  return `${words} for the last ${streak} calls, since ${formatDay(counted[counted.length - streak]!.at)}.`;
}

function describe(f: FeatureInfo, points: ChartPoint[], range: UsualRange | null, otherMethod: number, streak: number): string {
  const counted = points.filter((p) => p.counted);
  const excluded = points.length - counted.length;
  const parts: string[] = [];
  if (range) parts.push(`Usual range ${rangeOf(f, range)}.`);
  else parts.push('No usual range yet: it is set from the first 4 weeks of calls.');
  const latest = counted.at(-1);
  if (!latest) parts.push('No counted calls yet.');
  else {
    parts.push(`Latest ${latest.shown} on ${formatDay(latest.at)}${latest.note ? `, ${latest.note}` : ''}.`);
    if (range) {
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
      const shown = f.show(v);
      points.push({ callId: p.callId, at: p.at, value: v, counted, side, shown, note, label: `${formatDay(p.at)}: ${shown}${note ? `, ${note}` : ''}` });
    }
    const counted = points.filter((p) => p.counted);
    const streak = streakOf(counted);
    const status = statusOf(range, counted, streak);
    return {
      key: f.key,
      title: f.title,
      meaning: f.meaning,
      unit: f.unit,
      points,
      range,
      rangeText: rangeOf(f, range),
      otherMethod,
      summary: describe(f, points, range, otherMethod, streak),
      headline: headlineOf(f, status, counted, streak),
      status,
      streak,
      outsideNow: streak > 0,
    };
  });
}

const OVERALL: SpeechStatus[] = ['clear_change', 'slight_change', 'usual', 'insufficient_recent', 'no_baseline'];

/** Across the measures: any change is the story; otherwise "as usual" once anything can be compared. */
export function speechOverall(charts: readonly FeatureChart[]): SpeechStatus {
  const seen = charts.filter((c) => c.points.length).map((c) => c.status);
  return OVERALL.find((s) => seen.includes(s)) ?? 'no_baseline';
}

export interface SpeechProgress {
  collected: number;
  needed: number;
  /** Enough calls were counted, yet too few of them fell in the first 4 weeks for a range. */
  stalled: boolean;
}

/** While there is no usual range, how far along it is; null once there is one to compare with. */
export function speechProgress(trend: SpeechPoint[], baseline: SpeechBaseline | null | undefined): SpeechProgress | null {
  if (baseline) return null;
  const collected = trend.filter((p) => p.usable !== false).length;
  return { collected: Math.min(collected, USUAL_RANGE_CALLS), needed: USUAL_RANGE_CALLS, stalled: collected >= USUAL_RANGE_CALLS };
}

const STEPS = [1, 2, 2.5, 5];

/**
 * Round axis values covering `lo`..`hi` with at most `maxTicks` of them (at least 2). Steps are 1, 2,
 * 2.5 or 5 times a power of ten, the smallest that fits. A range that starts at zero or above never
 * gets a tick below zero.
 */
export function niceTicks(lo: number, hi: number, maxTicks: number): number[] {
  const most = Math.max(2, Math.floor(maxTicks));
  const floor = lo >= 0 ? 0 : -Infinity;
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.25 || 1;
    lo = Math.max(lo - pad, floor);
    hi += pad;
  }
  const rough = (hi - lo) / (most - 1);
  let power = 10 ** Math.floor(Math.log10(rough));
  for (;;) {
    for (const m of STEPS) {
      const step = m * power;
      if (step < rough * (1 - 1e-9)) continue;
      const first = Math.max(Math.floor(lo / step + 1e-9), floor);
      const last = Math.ceil(hi / step - 1e-9);
      if (last - first + 1 > most) continue;
      return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
    }
    power *= 10;
  }
}

function decimals(step: number): number {
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 6;
}

/** At most one date label per this many pixels, so dates never overlap or shrink. */
const X_LABEL_PX = 80;
/** At most one value line per this many pixels of plot height. */
const Y_TICK_PX = 40;
const FONT_PX = 14;

export interface PlotPoint extends ChartPoint {
  x: number;
  y: number;
  /** Left edge and width of the point's touch column: halfway to each neighbour, the full plot height. */
  hitX: number;
  hitWidth: number;
}

export interface Plot {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  band: { y: number; height: number; mean: number } | null;
  points: PlotPoint[];
  line: string;
}

/** Which points get a date under them: the first and the last always, evenly between, never closer than X_LABEL_PX. */
export function dateLabelIndexes(xs: readonly number[], plotWidth: number): number[] {
  if (xs.length <= 1) return xs.map((_, i) => i);
  const most = Math.max(2, Math.floor(plotWidth / X_LABEL_PX) + 1);
  const wanted = Math.min(xs.length, most);
  const picked = new Set(Array.from({ length: wanted }, (_, k) => Math.round((k * (xs.length - 1)) / (wanted - 1))));
  const last = xs.length - 1;
  const out: number[] = [];
  const tooClose = (i: number) => out.length > 0 && xs[i]! - xs[out.at(-1)!]! < X_LABEL_PX;
  for (const i of [...picked].sort((a, b) => a - b)) {
    if (i !== last) {
      if (!tooClose(i)) out.push(i);
      continue;
    }
    while (tooClose(i)) out.pop();
    out.push(i);
  }
  return out;
}

/**
 * The chart in pixels at the size it is drawn, so text stays its real size at any width: time across,
 * value up on round ticks in the measure's own unit, and a touch column per call.
 */
export function plotChart(chart: FeatureChart, width: number, height: number): Plot {
  const f = SPEECH_FEATURES.find((x) => x.key === chart.key)!;
  const top = 10;
  const bottom = height - 28;
  const values = chart.points.map((p) => p.value * f.scale);
  if (chart.range) values.push(chart.range.low * f.scale, chart.range.high * f.scale);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), Math.floor((bottom - top) / Y_TICK_PX) + 1);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const labels = ticks.map((t) => `${t.toFixed(decimals(step))}${f.suffix}`);
  const left = Math.ceil(Math.max(...labels.map((l) => l.length)) * FONT_PX * 0.6) + 12;
  const right = width - 12;
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const y = (raw: number) => bottom - ((raw * f.scale - lo) / (hi - lo || 1)) * (bottom - top);
  const times = chart.points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const inset = 10;
  const x = (at: string) => (t1 === t0 ? (left + right) / 2 : left + inset + ((Date.parse(at) - t0) / (t1 - t0)) * (right - left - 2 * inset));
  const r = (n: number) => Math.round(n * 10) / 10;
  const xs = chart.points.map((p) => r(x(p.at)));
  const points = chart.points.map((p, i) => {
    const from = i === 0 ? left : (xs[i - 1]! + xs[i]!) / 2;
    const to = i === xs.length - 1 ? right : (xs[i]! + xs[i + 1]!) / 2;
    return { ...p, x: xs[i]!, y: r(y(p.value)), hitX: r(from), hitWidth: r(Math.max(to - from, 1)) };
  });
  const dated = dateLabelIndexes(xs, right - left);
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    yTicks: ticks.map((t, i) => ({ y: r(y(t / f.scale)), label: labels[i]! })),
    xTicks: dated.map((i, k) => ({
      x: xs[i]!,
      label: formatDay(chart.points[i]!.at),
      anchor: dated.length === 1 ? 'middle' : k === 0 ? 'start' : k === dated.length - 1 ? 'end' : 'middle',
    })),
    band: chart.range ? { y: r(y(chart.range.high)), height: r(y(chart.range.low) - y(chart.range.high)), mean: r(y(chart.range.mean)) } : null,
    points,
    line: points
      .filter((p) => p.counted)
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  };
}
