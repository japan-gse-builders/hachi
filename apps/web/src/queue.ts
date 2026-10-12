import type { QueueItem } from './types';

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

export function avatarDetails(id: string, name: string): { initials: string; color: number } {
  const words = name.replace(/\s*\([^)]*\)\s*$/u, '').trim().split(/\s+/u).filter(Boolean);
  const initials = words.length > 1
    ? [words[0], words.at(-1)].map((s) => Array.from(s!)[0]).join('').toUpperCase()
    : Array.from(words[0] ?? '?').slice(0, 2).join('').toUpperCase();
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return { initials, color: hash % 4 };
}
