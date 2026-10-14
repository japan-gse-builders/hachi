import type { Severity } from './signals';
import type { DomainState, FamilyDashboard, FamilyGlance, LifeDomain, StaffTag, TagTrend } from './types';

export const LIFE_DOMAINS: { key: LifeDomain; label: string }[] = [
  { key: 'body', label: 'Body' },
  { key: 'food', label: 'Food' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'mood', label: 'Mood' },
  { key: 'social', label: 'Social' },
  { key: 'activity', label: 'Activity' },
];

/**
 * `nodata`: the call connected but was analysed before tags existed. `notes`: it connected and
 * Hachi's notes are not ready, which is on our side. `missed`: tried, did not get through.
 * `nocall`: nothing was tried. `notyet`: today's call has not been made. None of them reads as good.
 */
export type CellState = DomainState | 'nodata' | 'notes' | 'missed' | 'nocall' | 'notyet' | 'notshared';

/** Colour is never the only signal: every state has a symbol and a word. `sev` picks the colour. */
export const STATES: Record<CellState, { symbol: string; word: string; tone: string; sev: Severity }> = {
  good: { symbol: '✓', word: 'Good', tone: 'good', sev: 'good' },
  mixed: { symbol: '~', word: 'Some concern', tone: 'mixed', sev: 'soon' },
  concern: { symbol: '!', word: 'Worth a call', tone: 'concern', sev: 'today' },
  unmentioned: { symbol: '?', word: 'Not talked about', tone: 'quiet', sev: 'none' },
  nodata: { symbol: '?', word: 'No details', tone: 'quiet', sev: 'none' },
  notes: { symbol: '…', word: 'Notes not ready', tone: 'notes', sev: 'system' },
  missed: { symbol: '×', word: "Didn't get through", tone: 'missed', sev: 'none' },
  nocall: { symbol: '–', word: 'No call', tone: 'nocall', sev: 'none' },
  notyet: { symbol: '○', word: 'Not called yet', tone: 'notyet', sev: 'none' },
  notshared: { symbol: '–', word: 'Not shared', tone: 'quiet', sev: 'none' },
};

export const LEGEND: CellState[] = ['good', 'mixed', 'concern', 'unmentioned', 'notes', 'missed', 'nocall', 'notyet'];

const tokyoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d);
const tokyoTime = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const DAY = 86_400_000;

/** `date` is a resident-local YYYY-MM-DD. */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

export function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "today", "yesterday" or "3 Oct", in Japan time. */
function relativeDay(iso: string, now: Date): string {
  const day = tokyoDay(new Date(iso));
  if (day === tokyoDay(now)) return 'today';
  if (day === tokyoDay(new Date(now.getTime() - DAY))) return 'yesterday';
  if (day === tokyoDay(new Date(now.getTime() + DAY))) return 'tomorrow';
  return dayLabel(day);
}

/** "Today's call, 10:02", "Yesterday's call, 10:02" or "Latest call, 3 Oct, 10:02" (Japan time). */
export function latestCallLabel(startedAt: string, now: Date): string {
  const time = tokyoTime(new Date(startedAt));
  const day = relativeDay(startedAt, now);
  if (day === 'today') return `Today's call, ${time}`;
  if (day === 'yesterday') return `Yesterday's call, ${time}`;
  return `Latest call, ${day}, ${time}`;
}

export function nextCallLabel(nextCallAt: string | null, now: Date): string {
  if (!nextCallAt) return 'Daily calls are paused';
  return `Next call ${relativeDay(nextCallAt, now)}, ${tokyoTime(new Date(nextCallAt))} (Japan time)`;
}

/** "Today's call is at 10:00." while today's call is still to come; '' otherwise. */
export function todayCallNote(nextCallAt: string | null, now: Date): string {
  if (!nextCallAt || relativeDay(nextCallAt, now) !== 'today') return '';
  return `Today's call is at ${tokyoTime(new Date(nextCallAt))}.`;
}

const TITLES = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|St|Mt)\.$/;

/** The first sentence of generated text, so the headline stays one line of news. */
export function firstSentence(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  for (const m of t.matchAll(/[.!?](?=\s+["'(A-Z])/g)) {
    const end = m.index + 1;
    if (!TITLES.test(t.slice(0, end))) return t.slice(0, end);
  }
  return t;
}

type GlanceDay = FamilyGlance['days'][number];
type FamilyCall = FamilyDashboard['calls'][number];

export type DayKind = 'reached' | 'missed' | 'notyet' | 'nocall';

export interface FamilyDay extends GlanceDay {
  kind: DayKind;
  isToday: boolean;
  /** A call connected that day but Hachi's notes on it are not ready. */
  notesPending: boolean;
}

/**
 * The API ends `days` on the resident's today, reckoned in their time zone, and sends no zone with
 * it; calls are placed on days in Japan time, as the rest of the page shows them. The last day is
 * marked today only while it still is today in Japan, so a page left open overnight marks none.
 */
export function familyDays(days: readonly GlanceDay[], calls: readonly FamilyCall[], now: Date, callsActive: boolean): FamilyDay[] {
  const dateOf = (c: FamilyCall) => tokyoDay(new Date(c.startedAt));
  const tried = new Set(calls.filter((c) => !c.connected).map(dateOf));
  const unready = new Set(calls.filter((c) => c.connected && c.notesPending).map(dateOf));
  const today = tokyoDay(now);
  return days.map((d, i) => {
    const isToday = i === days.length - 1 && d.date === today;
    const kind: DayKind = d.domains ? 'reached' : tried.has(d.date) ? 'missed' : isToday && callsActive ? 'notyet' : 'nocall';
    return { ...d, kind, isToday, notesPending: kind === 'reached' && !d.tagged && unready.has(d.date) };
  });
}

export function cellState(day: FamilyDay, key: LifeDomain): CellState {
  if (day.kind !== 'reached') return day.kind;
  if (!day.tagged || !day.domains) return day.notesPending ? 'notes' : 'nodata';
  return day.domains[key] ?? 'unmentioned';
}

/**
 * Days in a row, back from today, whose call was tried and did not get through. Today counts once
 * it has been tried; a day nothing was tried ends the count, as the staff screens count it.
 */
export function missedDays(days: readonly FamilyDay[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const kind = days[i]!.kind;
    if (kind === 'missed') n++;
    else if (kind !== 'notyet') break;
  }
  return n;
}

export interface FamilyLevel {
  severity: Severity;
  word: string;
  detail: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The no-call ladder for families: green, then yellow, then orange. Red is kept for alerts. */
function reachSeverity(missed: number): Severity {
  return missed <= 0 ? 'good' : missed === 1 ? 'soon' : 'today';
}

/** "Talked today, 10:02" while calls get through; "Last talked 3 Oct, 10:02" once they stop. */
export function lastTalkedLevel(lastAt: string | null, missed: number, now: Date): FamilyLevel {
  if (!lastAt) return { severity: missed > 0 ? 'today' : 'none', word: 'No call in two weeks', detail: 'No call has got through in the last two weeks.' };
  const when = `${relativeDay(lastAt, now)}, ${tokyoTime(new Date(lastAt))}`;
  if (missed > 0) return { severity: reachSeverity(missed), word: `Last talked ${when}`, detail: `No call has got through for ${plural(missed, 'day')}.` };
  const recent = ['today', 'yesterday'].includes(relativeDay(lastAt, now));
  return { severity: recent ? 'good' : 'none', word: `Talked ${when}`, detail: '' };
}

const RANK: Severity[] = ['emergency', 'today', 'soon', 'system', 'monitor', 'none', 'good'];
const worse = (a: Severity, b: Severity) => (RANK.indexOf(a) <= RANK.indexOf(b) ? a : b);

function listWords(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export interface FamilyStatus {
  severity: Severity;
  title: string;
  body: string;
  /** The page leads with the care team's number, rather than keeping it further down. */
  askCareTeam: boolean;
}

export interface FamilyStatusInput {
  name: string;
  latest: FamilyGlance['latest'];
  days: readonly FamilyDay[];
  shareMood: boolean;
  callsActive: boolean;
  /** Any call, connected or not, in the window. */
  anyCalls: boolean;
  latestNotesPending: boolean;
  now: Date;
}

function latestCallStatus(i: FamilyStatusInput): Omit<FamilyStatus, 'askCareTeam'> {
  const latest = i.latest!;
  const headline = firstSentence(latest.headline);
  if (!latest.domains) {
    return i.latestNotesPending
      ? { severity: 'system', title: 'Notes on the latest call are not ready yet', body: `Hachi talked with ${i.name}. What came up will show here once it is ready.` }
      : { severity: 'none', title: 'No details from the latest call', body: headline };
  }
  const domains = latest.domains;
  const shown = LIFE_DOMAINS.filter((d) => d.key !== 'mood' || i.shareMood);
  const areas = (s: DomainState) => shown.filter((d) => domains[d.key] === s).map((d) => d.label);
  const concern = areas('concern');
  if (concern.length) return { severity: 'today', title: 'Worth a call', body: headline || `${listWords(concern)} may be worth asking about.` };
  const mixed = areas('mixed');
  if (mixed.length) return { severity: 'soon', title: 'Mostly well', body: headline || `A little concern about ${listWords(mixed).toLowerCase()}.` };
  const good = areas('good');
  if (good.length) return { severity: 'good', title: 'All seemed well', body: headline || `${listWords(good)} sounded fine.` };
  return { severity: 'none', title: 'Nothing much came up', body: headline || '"Not talked about" does not mean all is well.' };
}

const RECAP: Partial<Record<Severity, string>> = {
  today: 'something came up worth asking about',
  soon: 'mostly well, with a little to ask about',
  good: 'all seemed well',
  system: 'the notes are not ready yet',
};

/** One state for "how is she": the latest call, unless calls have stopped getting through since. */
export function familyStatus(i: FamilyStatusInput): FamilyStatus {
  if (!i.latest) {
    if (!i.anyCalls) {
      return i.callsActive
        ? { severity: 'none', title: 'No calls yet', body: `How ${i.name} is will show here after the first call.`, askCareTeam: false }
        : { severity: 'none', title: 'Daily calls are paused', body: 'The care team can tell you when they start again.', askCareTeam: false };
    }
    return i.callsActive
      ? { severity: 'today', title: `No call has reached ${i.name} in the last two weeks`, body: 'Hachi keeps trying each day, and the care team can see this too.', askCareTeam: true }
      : { severity: 'none', title: 'Daily calls are paused', body: `No call reached ${i.name} in the last two weeks.`, askCareTeam: false };
  }
  const call = latestCallStatus(i);
  const missed = missedDays(i.days);
  if (missed === 0) return { ...call, askCareTeam: call.severity === 'today' };
  const severity = worse(reachSeverity(missed), call.severity);
  const today = i.days.at(-1);
  const title =
    missed > 1
      ? `No call has reached ${i.name} for ${missed} days`
      : today?.isToday && today.kind === 'missed'
        ? `No call has got through to ${i.name} today`
        : `No call reached ${i.name} yesterday`;
  return {
    severity,
    title,
    body: `Last talked ${relativeDay(i.latest.startedAt, i.now)}: ${RECAP[call.severity] ?? 'nothing much came up'}. Hachi will keep trying, and the care team can see this too.`,
    askCareTeam: severity === 'today',
  };
}

export interface AreaTile {
  key: LifeDomain;
  label: string;
  state: CellState;
}

/** All six areas from the latest call. Mood without the resident's agreement reads "Not shared". */
export function latestAreas(latest: NonNullable<FamilyGlance['latest']>, shareMood: boolean, notesPending: boolean): AreaTile[] {
  return LIFE_DOMAINS.map((d) => ({
    ...d,
    state: d.key === 'mood' && !shareMood ? 'notshared' : latest.domains ? (latest.domains[d.key] ?? 'unmentioned') : notesPending ? 'notes' : 'nodata',
  }));
}

export function trendCount(t: TagTrend): string {
  return `${t.last} of last ${t.lastCalls} call${t.lastCalls === 1 ? '' : 's'}`;
}

export function trendChange(t: TagTrend): string {
  if (t.direction === null) return '';
  if (t.direction === 'same') return 'about the same as before';
  return `${t.direction === 'more' ? 'more' : 'less'} often (was ${t.previous} of ${t.previousCalls})`;
}

/** A good sign coming up less, or a concern more, is worse news even though the sign itself is good. */
export function trendTurn(t: TagTrend): 'better' | 'worse' | null {
  if (t.direction !== 'more' && t.direction !== 'less') return null;
  return (t.direction === 'more') === (t.polarity === 'positive') ? 'better' : 'worse';
}

/** One-offs stay muted; patterns stand out. */
export function isOneOff(t: TagTrend): boolean {
  return t.last <= 1;
}

const AUDIENCE: Record<StaffTag['audience'], string> = {
  family: '',
  family_with_consent: 'family only with consent',
  staff: 'staff only',
};

export function staffTagLine(t: StaffTag): string {
  return [t.label, `${t.basis} ${Math.round(t.confidence * 100)}%`, `turn ${t.turn}`, AUDIENCE[t.audience]].filter(Boolean).join(' · ');
}
