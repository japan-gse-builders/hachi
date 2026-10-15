import type { CallAnalysis, CallRecord } from '@hachi/store';
import type { CallEvent, CallSnapshot } from '../src/events.js';
import type { AnalyticsSource, Cursor, ExportDeps, Published } from '../src/worker.js';

export const NOW = new Date('2026-10-15T03:00:00.000Z');
export const analysis = (overrides: Partial<CallAnalysis> = {}): CallAnalysis => ({
  at: NOW.toISOString(), turns: 2,
  intake: { date: '2026-10-15', status: 'normal', reportedPoorDays: 0 },
  memory: { topics: [], plans: [], likes: [] }, ...overrides,
});
export const call = (overrides: Partial<CallRecord> = {}): CallRecord => ({
  id: 'c-1', residentId: 'r-1', source: 'live', status: 'completed', channel: 'pstn',
  startedAt: '2026-10-15T02:00:00.000Z', endedAt: '2026-10-15T02:02:00.000Z', durationSec: 120,
  analysisPending: false, analysis: analysis(), createdAt: '2026-10-15T02:00:00.000Z', ...overrides,
});
export const snapshot = (overrides: Partial<CallSnapshot> = {}): CallSnapshot => ({
  call: call(), orgId: 'org-1', synthetic: true, revision: '001792032000.000000001',
  updatedAt: NOW.toISOString(), ...overrides,
});
export const pathOf = (s: CallSnapshot) => `residents/${s.call.residentId}/calls/${s.call.id}`;

export class MemorySource implements AnalyticsSource {
  savedCursor: Cursor | null = null;
  receipts = new Map<string, Published>();
  constructor(public snapshots: CallSnapshot[] = [snapshot()]) {}
  async cursor() { return this.savedCursor; }
  async saveCursor(cursor: Cursor | null) { this.savedCursor = cursor; }
  async published(key: string) { return this.receipts.get(key) ?? null; }
  async markPublished(key: string, value: Published) { this.receipts.set(key, value); }
  async page(since: string, cursor: Cursor | null, limit: number) {
    const ordered = this.snapshots.filter((s) => s.call.startedAt >= since)
      .sort((a, b) => a.call.startedAt.localeCompare(b.call.startedAt) || pathOf(a).localeCompare(pathOf(b)));
    const eligible = cursor ? ordered.filter((s) => s.call.startedAt > cursor.startedAt
      || (s.call.startedAt === cursor.startedAt && pathOf(s) > cursor.path)) : ordered;
    const snapshots = eligible.slice(0, limit);
    const last = snapshots.at(-1);
    return { snapshots, next: eligible.length > limit && last
      ? { startedAt: last.call.startedAt, path: pathOf(last) } : null };
  }
}
export function setup(snapshots?: CallSnapshot[]) {
  const source = new MemorySource(snapshots);
  const events: CallEvent[] = [];
  const deps: ExportDeps = { source, publisher: { publish: async (event) => { events.push(event); } },
    settings: { orgIds: ['org-1'], includeRealData: false, lookbackDays: 30, pageSize: 100, maxPages: 5 },
    now: () => NOW };
  return { source, events, deps };
}
