import { retentionCutoff, type CallMediaRetention } from '@hachi/core';
import { callMediaState, compareMediaCursor, stripCallMediaText, type CallMediaCursor, type CallRecord, type Resident, type Store } from '@hachi/store';

export interface RecordingDeletion {
  deleteCallRecordings(call: CallRecord): Promise<void>;
}

export interface RetentionResult {
  purged: number;
  errors: string[];
}

const RETRY_MS = 60 * 60 * 1000;

async function markExpired(store: Store, resident: Resident, policy: CallMediaRetention, now: Date, limit: number): Promise<void> {
  const candidates = await store.listCallsForMediaExpiry(resident.id, retentionCutoff(policy, now), resident.mediaScan?.after, limit);
  const at = now.toISOString();
  let after: CallMediaCursor | undefined;
  for (const candidate of candidates) {
    const call = await store.updateCall(resident.id, candidate.id, (c) => {
      if (c.mediaExpiredAt || (c.analysisLease && c.analysisLease > at)) return null;
      const media = callMediaState(c, policy, now);
      if (!media.expired) return null;
      return stripCallMediaText({ ...c, mediaExpiredAt: media.expiresAt ?? at, mediaPurgeDueAt: at });
    });
    // Analysis leases are short. Leave this position for the next sweep while a worker is finishing.
    if (!call.mediaExpiredAt) break;
    after = candidate;
  }
  if (!after) return;
  const position = after;
  await store.updateResident(resident.id, (current) => {
    const importRevision = resident.mediaScan?.importRevision ?? 0;
    const scan = current.mediaScan;
    if ((scan?.importRevision ?? 0) !== importRevision) return current;
    if (scan?.after && compareMediaCursor(scan.after, position) >= 0) return current;
    return { ...current, mediaScan: { importRevision, after: position } };
  });
}

async function scrubEvidence(store: Store, resident: Resident, ids: ReadonlySet<string>): Promise<void> {
  const cases = await store.listCasesByResident(resident.id);
  for (const c of cases) {
    if (c.orgId !== resident.orgId || !c.detections.some((d) => d.evidence.some((e) => e.quote && ids.has(e.callId)))) continue;
    await store.mutateCase(c.id, (current) => ({
      case: {
        ...current,
        detections: current.detections.map((d) => ({
          ...d,
          evidence: d.evidence.map((e) => ids.has(e.callId) ? { ...e, quote: '' } : e),
        })),
      },
      events: [],
    }));
  }
}

async function purgeDue(store: Store, recordings: RecordingDeletion, resident: Resident, now: Date, limit: number): Promise<RetentionResult> {
  const calls = await store.listDueMediaPurges(resident.id, now.toISOString(), limit);
  const result: RetentionResult = { purged: 0, errors: [] };
  if (!calls.length) return result;
  // Preserve the call references used for deduplication and case history.
  await scrubEvidence(store, resident, new Set(calls.map((call) => call.id)));
  for (const call of calls) {
    try {
      await recordings.deleteCallRecordings(call);
      const saved = await store.updateCall(resident.id, call.id, (current) => {
        if (current.mediaPurgeDueAt !== call.mediaPurgeDueAt) return null;
        const { audioUri: _primary, extraAudioUris: _extra, mediaPurgeDueAt: _due, ...rest } = current;
        return stripCallMediaText(rest);
      });
      if (!saved.mediaPurgeDueAt) result.purged++;
    } catch {
      // Keep references for retry. Moving a failed job back lets other calls be purged first.
      result.errors.push(`${resident.id}/${call.id}: media purge failed`);
      await store.updateCall(resident.id, call.id, (current) => current.mediaPurgeDueAt === call.mediaPurgeDueAt
        ? { ...current, mediaPurgeDueAt: new Date(now.getTime() + RETRY_MS).toISOString() }
        : null);
    }
  }
  return result;
}

export async function sweepCallMedia(store: Store, recordings: RecordingDeletion, now: Date, limit = 20): Promise<RetentionResult> {
  const result: RetentionResult = { purged: 0, errors: [] };
  for (const org of await store.listOrganizationsWithMediaRetention()) {
    const policy = org.callMediaRetention;
    if (!policy) continue;
    const residents = await store.listResidents(org.id);
    for (let i = 0; i < residents.length; i += 4) {
      await Promise.all(residents.slice(i, i + 4).map(async (resident) => {
        try {
          await markExpired(store, resident, policy, now, limit);
          const pass = await purgeDue(store, recordings, resident, now, limit);
          result.purged += pass.purged;
          result.errors.push(...pass.errors);
        } catch {
          result.errors.push(`${resident.id}: media cleanup could not finish`);
        }
      }));
    }
  }
  return result;
}
