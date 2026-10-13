import { hasCallConsent } from './privacy';
import { checkedLevel, reachLevel, urgencySeverity, worstSeverity, type Level, type ReachInput, type Severity } from './signals';
import type { NotificationItem, QueueItem, Resident, ResidentSignals, UnreachedResident } from './types';

const URGENCIES = ['emergency', 'urgent', 'action', 'watch'];
export interface QueueFilters { urgency: string; query: string; includeClosed: boolean }

export function queueFilters(params: URLSearchParams): QueueFilters {
  const urgency = params.get('urgency') ?? '';
  return { urgency: URGENCIES.includes(urgency) ? urgency : '', query: (params.get('q') ?? '').slice(0, 200), includeClosed: params.get('includeClosed') === 'true' };
}

/** Keep the core's priority order; these controls only select which cases are visible. */
export function filterQueue(items: QueueItem[], filters: QueueFilters): QueueItem[] {
  const term = filters.query.trim().normalize('NFKC').toLowerCase();
  return items.filter((item) =>
    (filters.includeClosed || item.status !== 'closed') &&
    (!filters.urgency || item.urgency === filters.urgency) &&
    (!term || `${item.residentName}\n${item.summary}`.normalize('NFKC').toLowerCase().includes(term)),
  );
}

/** Back from a case to the queue as it was left, filters included; a pasted case link gets the plain queue. */
export function queueLink(state: unknown): string {
  const search = (state as { queueSearch?: unknown } | null)?.queueSearch;
  return typeof search === 'string' && search ? `/staff?${search}` : '/staff';
}

export function avatarDetails(id: string, name: string): { initials: string; color: number } {
  const words = name.replace(/\s*\([^)]*\)\s*$/u, '').trim().split(/\s+/u).filter(Boolean);
  const initials = words.length > 1
    ? [words[0], words.at(-1)].map((s) => Array.from(s!)[0]).join('').toUpperCase()
    : Array.from(words[0] ?? '?').slice(0, 2).join('').toUpperCase();
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return { initials, color: hash % 4 };
}

/** Most worrying first, for `Array.prototype.sort`, which keeps equals in the order they came. */
export function bySeverity(a: Severity, b: Severity): number {
  if (a === b) return 0;
  return worstSeverity([a, b]) === a ? -1 : 1;
}

/** `null` urgency is the closed lane, which comes last whatever the urgency its cases had. */
export interface QueueLane { key: string; urgency: string | null; severity: Severity; items: QueueItem[] }

/** One lane per urgency, most urgent first, each keeping the core's order; empty lanes are left out. */
export function queueLanes(items: QueueItem[]): QueueLane[] {
  const open = items.filter((i) => i.status !== 'closed');
  const urgencies = [...new Set([...URGENCIES, ...open.map((i) => i.urgency)])];
  const lanes: QueueLane[] = urgencies
    .map((urgency) => ({ key: urgency, urgency, severity: urgencySeverity(urgency), items: open.filter((i) => i.urgency === urgency) }))
    .filter((l) => l.items.length > 0);
  const closed = items.filter((i) => i.status === 'closed');
  if (closed.length) lanes.push({ key: 'closed', urgency: null, severity: 'good', items: closed });
  return lanes;
}

/** Open cases at each of the four urgencies, zeros included, whatever the filters show. */
export function openCounts(items: QueueItem[]): { urgency: string; severity: Severity; count: number }[] {
  return URGENCIES.map((urgency) => ({
    urgency,
    severity: urgencySeverity(urgency),
    count: items.filter((i) => i.status !== 'closed' && i.urgency === urgency).length,
  }));
}

/** "25 min ago", "3 h ago", "2 days ago": how long a case has been waiting, not when it began. */
export function ageLabel(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const UNDELIVERED = new Set(['undelivered', 'failed', 'no_answer', 'busy', 'canceled']);

/** One mark per recipient: not delivered when any message to them failed, otherwise sent. */
export function notifiedSummary(notifications: NotificationItem[]): { recipient: string; delivered: boolean; items: NotificationItem[] }[] {
  const recipients = [...new Set(notifications.map((n) => n.recipient))];
  return recipients.map((recipient) => {
    const items = notifications.filter((n) => n.recipient === recipient);
    return { recipient, delivered: !items.some((n) => n.delivery && UNDELIVERED.has(n.delivery.status)), items };
  });
}

/** Three days or more without a call first; a call that failed on our side comes after the ladder. */
export function sortUnreached(items: UnreachedResident[], now: Date): UnreachedResident[] {
  return [...items].sort((a, b) => bySeverity(reachLevel(a, now).severity, reachLevel(b, now).severity));
}

/** The unreached entry as a `ReachSummary`, which the indicator bar can only take with `missedDays`. */
function unreachedSummary(u: UnreachedResident | undefined) {
  return u?.missedDays === undefined ? undefined : { lastReachedAt: u.lastReachedAt, missedDays: u.missedDays, ourFault: u.ourFault };
}

/**
 * `signals` with what the page knows from elsewhere filled in where the API left it out. Stays
 * undefined without `signals`, so the bar is not drawn as nine "No data" marks.
 */
export function knownSignals(signals: ResidentSignals | undefined, known: { unreached?: UnreachedResident | undefined; unchecked?: number | undefined }): ResidentSignals | undefined {
  if (!signals) return undefined;
  const reach = signals.reach ?? unreachedSummary(known.unreached);
  const unchecked = signals.unchecked ?? known.unchecked;
  return { ...signals, ...(reach && { reach }), ...(unchecked !== undefined && { unchecked }) };
}

export interface ResidentChip extends Level {
  key: 'case' | 'reach' | 'checked' | 'approval' | 'paused';
  /** The case the chip is about, so the card can link to it. */
  caseId?: string;
}

/**
 * What a resident's card says at a glance, as chips in reading order. `cases` is undefined when the
 * queue did not load, so no chip claims there is nothing open; the same goes for `unchecked`.
 */
export function residentChips(
  r: Resident,
  { cases, reach, unchecked }: { cases?: QueueItem[] | undefined; reach?: ReachInput | undefined; unchecked?: number | undefined },
  now: Date,
): ResidentChip[] {
  const chips: ResidentChip[] = [];
  if (cases) {
    const open = cases.filter((c) => c.residentId === r.id && c.status !== 'closed');
    const top = [...open].sort((a, b) => bySeverity(urgencySeverity(a.urgency), urgencySeverity(b.urgency)))[0];
    chips.push(top
      ? { key: 'case', severity: urgencySeverity(top.urgency), word: `${top.urgencyLabel} · ${open.length} open ${open.length === 1 ? 'case' : 'cases'}`, detail: top.summary, caseId: top.caseId }
      : { key: 'case', severity: 'good', word: 'No open cases', detail: '' });
  }
  if (reach) chips.push({ key: 'reach', ...reachLevel(reach, now) });
  if (unchecked) chips.push({ key: 'checked', ...checkedLevel(unchecked) });
  if (!hasCallConsent(r.callConsent)) chips.push({ key: 'approval', severity: 'system', word: 'Approval needed', detail: 'Daily calls wait until the resident agrees.' });
  if (!r.active) chips.push({ key: 'paused', severity: 'none', word: 'Calls paused', detail: 'No daily calls until they are resumed.' });
  return chips;
}

/** A severity that asks somebody to do something, as opposed to keeping an eye or nothing at all. */
export function needsAttention(s: Severity): boolean {
  return s === 'emergency' || s === 'today' || s === 'soon' || s === 'system';
}
