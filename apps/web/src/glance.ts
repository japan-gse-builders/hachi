import type { DomainState, DomainStates, FamilyGlance, LifeDomain, StaffTag, TagTrend } from './types';

export const LIFE_DOMAINS: { key: LifeDomain; label: string }[] = [
  { key: 'body', label: 'Body' },
  { key: 'food', label: 'Food' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'mood', label: 'Mood' },
  { key: 'social', label: 'Social' },
  { key: 'activity', label: 'Activity' },
];

/** `nodata`: the call connected but was analysed before tags existed. Looks like "not talked about", never like good. */
export type CellState = DomainState | 'nocall' | 'nodata';

/** Colour is never the only signal: every state has a symbol and a word. */
export const STATES: Record<CellState, { symbol: string; word: string; tone: string }> = {
  good: { symbol: '✓', word: 'Good', tone: 'good' },
  mixed: { symbol: '~', word: 'Some concern', tone: 'mixed' },
  concern: { symbol: '!', word: 'Worth a call', tone: 'concern' },
  unmentioned: { symbol: '?', word: 'Not talked about', tone: 'unmentioned' },
  nodata: { symbol: '?', word: 'No details', tone: 'unmentioned' },
  nocall: { symbol: '–', word: 'No call', tone: 'nocall' },
};

export const LEGEND: CellState[] = ['good', 'mixed', 'concern', 'unmentioned', 'nocall'];

export function domainState(domains: DomainStates | null | undefined, key: LifeDomain): CellState {
  return domains ? (domains[key] ?? 'unmentioned') : 'nodata';
}

export function cellState(day: FamilyGlance['days'][number], key: LifeDomain): CellState {
  if (!day.domains) return 'nocall';
  return day.tagged ? (day.domains[key] ?? 'unmentioned') : 'nodata';
}

const tokyoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d);
const DAY = 86_400_000;

/** `date` is a resident-local YYYY-MM-DD. */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

export function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "Today's call, 10:02", "Yesterday's call, 10:02" or "Latest call, 3 Oct, 10:02" (Japan time). */
export function latestCallLabel(startedAt: string, now: Date): string {
  const at = new Date(startedAt);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const day = tokyoDay(at);
  if (day === tokyoDay(now)) return `Today's call, ${time}`;
  if (day === tokyoDay(new Date(now.getTime() - DAY))) return `Yesterday's call, ${time}`;
  return `Latest call, ${dayLabel(day)}, ${time}`;
}

export function glanceHeadline(latest: FamilyGlance['latest']): string {
  if (!latest) return 'No calls have connected in the last two weeks.';
  if (latest.headline) return latest.headline;
  return latest.domains ? 'Here is what came up in the latest call.' : 'There are no details for the latest call yet.';
}

export function worthAsking(latest: FamilyGlance['latest']): boolean {
  return !!latest?.domains && Object.values(latest.domains).includes('concern');
}

export function trendCount(t: TagTrend): string {
  return `${t.last} of last ${t.lastCalls} call${t.lastCalls === 1 ? '' : 's'}`;
}

export function trendChange(t: TagTrend): string {
  if (t.direction === null) return '';
  if (t.direction === 'same') return 'about the same as before';
  return `${t.direction === 'more' ? 'more' : 'less'} often (was ${t.previous} of ${t.previousCalls})`;
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
