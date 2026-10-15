import { callEvent, type CallEvent, type CallSnapshot } from './events.js';

export interface Cursor { startedAt: string; path: string }
export interface Published { fingerprint: string; revision: string }
export interface AnalyticsSource {
  cursor(): Promise<Cursor | null>;
  saveCursor(cursor: Cursor | null): Promise<void>;
  page(since: string, cursor: Cursor | null, limit: number): Promise<{ snapshots: CallSnapshot[]; next: Cursor | null }>;
  published(callKey: string): Promise<Published | null>;
  markPublished(callKey: string, value: Published): Promise<void>;
}
export interface EventPublisher { publish(event: CallEvent): Promise<void> }
export interface ExportSettings { orgIds: string[]; includeRealData: boolean; lookbackDays: number; pageSize: number; maxPages: number }
export interface ExportDeps { source: AnalyticsSource; publisher: EventPublisher; settings: ExportSettings; now: () => Date }

/** Durable source + checkpoints: a publish failure never changes a care record or a notification. */
export async function exportCalls({ source, publisher, settings, now }: ExportDeps) {
  const started = now().getTime();
  const since = new Date(started - settings.lookbackDays * 86_400_000).toISOString();
  let cursor = await source.cursor();
  const result = { scanned: 0, published: 0, unchanged: 0, excluded: 0, invalid: 0, failed: 0, caughtUp: false };
  for (let page = 0; page < settings.maxPages; page++) {
    const batch = await source.page(since, cursor, settings.pageSize);
    for (const snapshot of batch.snapshots) {
      // Leave time for the current RPC and response before Cloud Run's five-minute deadline.
      // Keep this page's cursor unchanged; receipts let the next invocation resume safely.
      if (now().getTime() - started >= 240_000) return result;
      result.scanned++;
      if (!settings.orgIds.includes(snapshot.orgId)
        || (!settings.includeRealData && snapshot.synthetic !== true && snapshot.call.synthetic !== true)) {
        result.excluded++;
        continue;
      }
      let row: ReturnType<typeof callEvent>;
      try { row = callEvent(snapshot); }
      catch {
        // One malformed source record must not hold up every subsequent call. Revisit it
        // on the next scan cycle, so a correction can be exported without clearing receipts.
        result.invalid++;
        continue;
      }
      if (!row) { result.excluded++; continue; }
      try {
        const prior = await source.published(row.event.call_key);
        if (prior && (prior.fingerprint === row.fingerprint || prior.revision > snapshot.revision)) {
          result.unchanged++;
          continue;
        }
        await publisher.publish(row.event);
        // If the acknowledgement was lost, retrying can duplicate the event. BigQuery views
        // select the newest source revision per call, so duplicates never inflate reports.
        await source.markPublished(row.event.call_key, { fingerprint: row.fingerprint, revision: snapshot.revision });
        result.published++;
      } catch {
        // Do not log SDK errors: they can include request data. Revisit this page on the next run.
        result.failed++;
        return result;
      }
    }
    cursor = batch.next;
    await source.saveCursor(cursor);
    if (!cursor) { result.caughtUp = true; break; }
  }
  return result;
}
