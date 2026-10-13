import { dayLabel, latestCallLabel, LIFE_DOMAINS, STATES } from './glance';
import { speechCharts } from './speech';
import type {
  CaseDetail,
  DomainState,
  DomainStates,
  IncompleteAnalyses,
  LifeDomain,
  ReachSummary,
  ResidentSignals,
  SpeechStatus,
} from './types';

/**
 * One meaning per colour. Red, orange, yellow and gray say how worried to be; green is good or done;
 * `system` (blue, dashed) is a problem on our side rather than a finding about the resident; `none`
 * is no data or not talked about, and is never drawn as good.
 */
export type Severity = 'emergency' | 'today' | 'soon' | 'monitor' | 'good' | 'system' | 'none';

/** Colour is never the only signal: every severity has a symbol and a word. Listed in key order. */
export const SEVERITY: Record<Severity, { symbol: string; label: string }> = {
  emergency: { symbol: '!!', label: 'Act now' },
  today: { symbol: '!', label: 'Review today' },
  soon: { symbol: '~', label: 'Review soon' },
  monitor: { symbol: '•', label: 'Monitor' },
  good: { symbol: '✓', label: 'Good' },
  system: { symbol: '?', label: 'Not checked' },
  none: { symbol: '–', label: 'No data' },
};

export const SEVERITIES = Object.keys(SEVERITY) as Severity[];

/** Most worrying first. Unknowns outrank good, so a resident nobody knows about never sorts with the fine ones. */
export const SEVERITY_RANK: readonly Severity[] = ['emergency', 'today', 'soon', 'system', 'monitor', 'none', 'good'];

/** Most worrying first, for `Array.prototype.sort`, which keeps equals in the order they came. */
export function bySeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK.indexOf(a) - SEVERITY_RANK.indexOf(b);
}

export function worstSeverity(list: readonly Severity[]): Severity {
  return list.reduce<Severity>((a, s) => (bySeverity(s, a) < 0 ? s : a), list.length ? 'good' : 'none');
}

/** A severity with the word shown beside it and a sentence for the tooltip ('' when there is none). */
export interface Level {
  severity: Severity;
  word: string;
  detail: string;
}

const own = <T>(table: Record<string, T>, key: string | null | undefined): T | undefined =>
  key != null && Object.hasOwn(table, key) ? table[key] : undefined;

const URGENCY: Record<string, Severity> = { emergency: 'emergency', urgent: 'today', action: 'soon', watch: 'monitor' };

/** Case urgency as the API sends it; the API's `urgencyLabel` stays the word. */
export function urgencySeverity(urgency: string | null | undefined): Severity {
  return own(URGENCY, urgency) ?? 'none';
}

const DOMAIN: Record<DomainState, Severity> = { good: 'good', mixed: 'soon', concern: 'today', unmentioned: 'none' };

export function domainLevel(state: DomainState | undefined, detail = ''): Level {
  const s = state ?? 'unmentioned';
  return { severity: DOMAIN[s], word: STATES[s].word, detail };
}

const SPEECH: Record<SpeechStatus, Level> = {
  usual: { severity: 'good', word: 'As usual', detail: 'Within their usual range.' },
  slight_change: { severity: 'monitor', word: 'Slight change', detail: 'A slight change from how they usually speak.' },
  clear_change: { severity: 'soon', word: 'Clear change', detail: 'A clear change from how they usually speak.' },
  no_baseline: { severity: 'none', word: 'No usual range yet', detail: 'Their usual range is set from the first 4 weeks of calls.' },
  insufficient_recent: { severity: 'none', word: 'Too few calls', detail: 'Too few recent calls could be measured to compare.' },
};

export function speechLevel(status: SpeechStatus | undefined): Level {
  return own(SPEECH, status) ?? { severity: 'none', word: 'No data', detail: '' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `unchecked` as `ResidentSignals.unchecked`; undefined when nobody has said. */
export function checkedLevel(unchecked: number | undefined): Level {
  if (unchecked === undefined) return { severity: 'none', word: 'Not known', detail: '' };
  if (unchecked <= 0) return { severity: 'good', word: 'All checked', detail: 'Hachi finished checking every recent call.' };
  return {
    severity: 'system',
    word: `${unchecked} not checked`,
    detail: `${plural(unchecked, 'recent call')} not fully checked. That is not the same as nothing wrong.`,
  };
}

const TZ = 'Asia/Tokyo';
const DAY = 86_400_000;
const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const clock = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const shiftDate = (date: string, days: number) => new Date(dayMs(date) + days * DAY).toISOString().slice(0, 10);

/** Whole Japan-time calendar days from `iso` to `now`. */
function daysSince(iso: string, now: Date): number {
  return Math.round((dayMs(localDate(now)) - dayMs(localDate(new Date(iso)))) / DAY);
}

function reachedOn(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : dayLabel(localDate(new Date(iso)));
}

/** `ReachSummary`, or an `UnreachedResident`, whose `missedDays` older servers leave out. */
export type ReachInput = Pick<ReachSummary, 'lastReachedAt' | 'ourFault'> & { missedDays?: number };

/**
 * The no-call ladder: reached = green, 1 day = yellow, 2 = orange, 3+ = red, and blue whenever the
 * latest miss was our fault. Without `missedDays` the days since `lastReachedAt` stand in, which
 * counts today before today's call is due.
 */
export function reachLevel(reach: ReachInput | undefined, now: Date): Level {
  if (!reach) return { severity: 'none', word: 'No call data', detail: '' };
  const last = reach.lastReachedAt;
  const missed = reach.missedDays ?? (last ? daysSince(last, now) : null);
  const detail = last ? `Last reached ${reachedOn(last, now)} at ${clock(new Date(last))}.` : 'No call has connected recently.';
  if (reach.ourFault && missed !== 0) {
    return { severity: 'system', word: 'Call failed (our side)', detail: `The last check-in failed on our side, so nothing is known about them. ${detail}` };
  }
  if (missed === null) return { severity: 'none', word: 'Not reached', detail };
  if (missed <= 0) return last ? { severity: 'good', word: `Reached ${reachedOn(last, now)}`, detail } : { severity: 'none', word: 'No calls yet', detail };
  return { severity: missed === 1 ? 'soon' : missed === 2 ? 'today' : 'emergency', word: `No call for ${plural(missed, 'day')}`, detail };
}

export type IndicatorKey = LifeDomain | 'speech' | 'calls' | 'checked';

const WHAT: Record<IndicatorKey, string> = {
  body: 'Pain, tired, unwell, a fall',
  food: 'Ate little, skipped meals, not drinking',
  sleep: 'Slept badly, up at night',
  mood: 'Low, worried, lonely',
  social: 'Contact with family or friends',
  activity: 'Went out, hobbies, chores',
  speech: 'How they answer, against their usual',
  calls: 'When a call last got through',
  checked: 'Whether Hachi finished checking recent calls',
};

const NAMES: { key: IndicatorKey; label: string }[] = [
  ...LIFE_DOMAINS,
  { key: 'speech', label: 'Speech' },
  { key: 'calls', label: 'Calls' },
  { key: 'checked', label: 'Checked' },
];

/** The nine indicators, in the one order every screen uses. */
export const INDICATORS: readonly { key: IndicatorKey; label: string; what: string }[] = NAMES.map((d) => ({ ...d, what: WHAT[d.key] }));

export interface Indicator extends Level {
  key: IndicatorKey;
  label: string;
}

function lifeLevel(s: ResidentSignals, key: LifeDomain, now: Date, shareMood: boolean): Level {
  if (key === 'mood' && !shareMood) return { severity: 'none', word: 'Not shared', detail: 'Mood is shown only with their agreement.' };
  if (s.latestCallAt === null) return { severity: 'none', word: 'No call', detail: 'No call has connected recently.' };
  const from = s.latestCallAt ? `${latestCallLabel(s.latestCallAt, now)}.` : '';
  if (s.domains) return domainLevel(s.domains[key], from);
  return s.domains === null ? { severity: 'none', word: STATES.nodata.word, detail: from } : { severity: 'none', word: 'No data', detail: '' };
}

/**
 * The nine indicators for one resident. Anything `signals` leaves out reads as no data. Pass
 * `shareMood: false` wherever mood needs the resident's agreement, as on the family screens.
 */
export function buildIndicators(signals: ResidentSignals | undefined, now: Date, { shareMood = true }: { shareMood?: boolean } = {}): Indicator[] {
  const s = signals ?? {};
  const level = (key: IndicatorKey): Level => {
    if (key === 'speech') return speechLevel(s.speech);
    if (key === 'calls') return reachLevel(s.reach, now);
    if (key === 'checked') return checkedLevel(s.unchecked);
    return lifeLevel(s, key, now, shareMood);
  };
  return INDICATORS.map((d) => ({ key: d.key, label: d.label, ...level(d.key) }));
}

/** For narrow spaces: the indicators worth a look, and one line for the rest. */
export function compactIndicators(list: readonly Indicator[]): { attention: Indicator[]; summary: { text: string; detail: string } | null } {
  const fine = list.filter((i) => i.severity === 'good');
  const unknown = list.filter((i) => i.severity === 'none');
  const names = (l: Indicator[]) => l.map((i) => i.label).join(', ');
  const parts = [fine.length && `${fine.length} fine`, unknown.length && `${unknown.length} no data`].filter(Boolean);
  const detail = [fine.length && `Fine: ${names(fine)}.`, unknown.length && `No data: ${names(unknown)}.`].filter(Boolean);
  return {
    attention: list.filter((i) => i.severity !== 'good' && i.severity !== 'none'),
    summary: parts.length ? { text: parts.join(' · '), detail: detail.join(' ') } : null,
  };
}

/** Calls in the incomplete-analyses list for one resident; undefined when the list did not load. */
export function uncheckedFor(incomplete: IncompleteAnalyses | undefined, residentId: string): number | undefined {
  return incomplete?.items.filter((i) => i.residentId === residentId).length;
}

type CaseCall = CaseDetail['calls'][number];

function pickDomains(domains: Record<string, DomainState>): DomainStates {
  return Object.fromEntries(LIFE_DOMAINS.map((d) => [d.key, own(domains, d.key) ?? 'unmentioned'])) as DomainStates;
}

/**
 * As the API's unreached list counts, from the calls on the page. A day without any finished attempt
 * ends the count, except today, whose call may not be due yet. Staff-requested calls count only
 * when they connected. A connected call that broke on our side reads as reached: the page does not say.
 */
function caseReach(calls: readonly CaseCall[], now: Date): ReachSummary {
  const daily = calls.filter((c) => c.trigger !== 'staff' || c.status === 'completed');
  const lastReachedAt = daily.filter((c) => c.status === 'completed').map((c) => c.startedAt).sort().at(-1) ?? null;
  const today = localDate(now);
  let missedDays = 0;
  let ourFault = false;
  for (let back = 0; ; back++) {
    const onDay = daily.filter((c) => localDate(new Date(c.startedAt)) === shiftDate(today, -back));
    if (onDay.some((c) => c.status === 'completed')) break;
    const missed = onDay.filter((c) => c.status === 'no_answer' || c.status === 'failed').sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    if (!missed.length) {
      if (back === 0) continue;
      break;
    }
    if (missedDays === 0) ourFault = missed.at(-1)!.status === 'failed';
    missedDays++;
  }
  return { lastReachedAt, missedDays, ourFault };
}

/** An open R3 case is R3's own reading; otherwise the page's speech chart stands in for it. */
function caseSpeech(d: CaseDetail): SpeechStatus | undefined {
  if (d.case.rule === 'R3' && d.case.status !== 'closed') return d.case.autoUrgency === 'action' ? 'clear_change' : 'slight_change';
  if (d.speechBaseline === undefined) return undefined;
  if (d.speechBaseline === null) return 'no_baseline';
  const charts = speechCharts(d.speechTrend, d.speechBaseline);
  if (!charts.some((c) => c.points.some((p) => p.counted))) return 'insufficient_recent';
  return charts.some((c) => c.outsideNow) ? 'slight_change' : 'usual';
}

/**
 * The case page's indicator inputs: whatever the API sent in `resident.signals`, with the rest read
 * from the page. `unchecked` is not on the page; add it from `uncheckedFor`.
 */
export function caseSignals(d: CaseDetail, now: Date): ResidentSignals {
  const latest = [...d.calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).find((c) => c.status === 'completed');
  const derived: ResidentSignals = {
    latestCallAt: latest?.startedAt ?? null,
    domains: latest?.wellbeing ? pickDomains(latest.wellbeing.domains) : null,
    reach: caseReach(d.calls, now),
  };
  const speech = caseSpeech(d);
  if (speech) derived.speech = speech;
  return { ...derived, ...d.resident.signals };
}
