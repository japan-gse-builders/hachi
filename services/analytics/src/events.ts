import { createHash } from 'node:crypto';
import type { CallRecord } from '@hachi/store';

export interface CallSnapshot {
  call: CallRecord;
  orgId: string;
  synthetic: boolean;
  /** Firestore update time: padded seconds.nanoseconds, sortable without losing precision. */
  revision: string;
  updatedAt: string;
}

/** An explicit allowlist. No names, contact details, free text, recordings, or resident IDs. */
export interface CallEvent {
  schema_version: number;
  event_id: string;
  call_key: string;
  organization_key: string;
  source_revision: string;
  source_updated_at: string;
  call_started_at: string;
  call_ended_at: string | null;
  status: 'completed' | 'no_answer' | 'failed';
  channel: 'pstn' | 'whatsapp';
  trigger: 'daily' | 'staff';
  synthetic: boolean;
  duration_seconds: number | null;
  attempt: number;
  analysis_state: 'pending' | 'complete' | 'partial' | 'missing' | 'not_applicable';
  emergency_flagged: boolean;
  no_response_escalated: boolean;
}

export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp = (value: string | undefined): string | null => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Snapshot identity excludes unrelated source writes, such as leases or the transcript text. */
export function callEvent(snapshot: CallSnapshot): { event: CallEvent; fingerprint: string } | null {
  const { call: c } = snapshot;
  if (c.source !== 'live' || !['completed', 'no_answer', 'failed'].includes(c.status)) return null;
  const started = timestamp(c.startedAt);
  const updated = timestamp(snapshot.updatedAt);
  if (!started || !updated || !/^\d{12}\.\d{9}$/.test(snapshot.revision)) throw new Error('Invalid analytics source timestamp');
  if (!snapshot.orgId || !c.residentId || !c.id) throw new Error('Missing analytics source identity');
  if (c.channel !== 'pstn' && c.channel !== 'whatsapp') throw new Error('Invalid call channel');
  const payload = {
    schema_version: 1,
    call_key: hash(['hachi-call-v1', snapshot.orgId, c.residentId, c.id]),
    organization_key: hash(['hachi-organization-v1', snapshot.orgId]),
    call_started_at: started,
    call_ended_at: timestamp(c.endedAt),
    status: c.status as CallEvent['status'],
    channel: c.channel,
    trigger: c.trigger === 'staff' ? 'staff' as const : 'daily' as const,
    synthetic: snapshot.synthetic || c.synthetic === true,
    duration_seconds: Number.isFinite(c.durationSec) && c.durationSec! >= 0 ? c.durationSec! : null,
    attempt: Number.isSafeInteger(c.attempt) && c.attempt! >= 0 ? c.attempt! : 0,
    analysis_state: (c.status !== 'completed' ? 'not_applicable'
      : c.analysisPending ? 'pending'
      : !c.analysis ? 'missing'
      : c.analysis.incomplete?.length || c.analysis.error || c.analysis.voiceError ? 'partial'
      : 'complete') as CallEvent['analysis_state'],
    emergency_flagged: Boolean(c.emergency || c.conversation?.noResponseEscalated),
    no_response_escalated: c.conversation?.noResponseEscalated === true,
  };
  const fingerprint = hash(payload);
  return {
    fingerprint,
    event: { ...payload, source_revision: snapshot.revision, source_updated_at: updated,
      event_id: hash([payload.call_key, snapshot.revision, fingerprint]) },
  };
}
