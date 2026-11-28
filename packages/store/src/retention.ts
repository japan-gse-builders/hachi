import { callMediaExpiresAt, retentionCutoff, type CallMediaRetention } from '@hachi/core';
import type { CallMediaCursor, CallRecord } from './model.js';

export function compareMediaCursor(a: CallMediaCursor, b: CallMediaCursor): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export function callMediaState(call: CallRecord, policy: CallMediaRetention | undefined, now: Date): { expired: boolean; expiresAt: string | null } {
  if (call.mediaExpiredAt) return { expired: true, expiresAt: call.mediaExpiredAt };
  if (!policy) return { expired: false, expiresAt: null };
  const expiresAt = callMediaExpiresAt(call.startedAt, policy);
  const expired = expiresAt === null || Date.parse(call.startedAt) <= Date.parse(retentionCutoff(policy, now));
  return { expired, expiresAt: expired && expiresAt && expiresAt > now.toISOString() ? null : expiresAt };
}

/** Retain derived care information, dropping verbatim copies of the recording or transcript. */
export function stripCallMediaText(call: CallRecord): CallRecord {
  const { transcript: _transcript, analysisLease: _lease, speech, emergency, ...rest } = call;
  const next: CallRecord = { ...rest, analysisPending: false };
  if (speech) {
    const { examples: _examples, ...features } = speech;
    next.speech = features;
  }
  if (emergency) {
    const { quote: _quote, ...alert } = emergency;
    next.emergency = alert;
  }
  return next;
}
