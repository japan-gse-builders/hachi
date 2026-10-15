import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { callEvent } from '../src/events.js';
import { analysis, call, snapshot } from './fixtures.js';

describe('call analytics event', () => {
  it('exports a normal call without any case and excludes all private/free-text fields', () => {
    const source = snapshot({ call: call({ transcript: [{ speaker: 'resident', text: 'private transcript', startMs: 0, endMs: 10 }],
      audioUri: 'gs://private/audio.wav', streamToken: 'secret-stream-token', requestedBy: 'staff-private',
      failure: { message: 'provider-private', retryable: false },
      emergency: { at: '2026-10-15T02:01:00Z', caseId: 'case-private', quote: 'private quote',
        legs: [{ recipient: 'family', to: '+819012345678' }] } }) });
    const { event } = callEvent(source)!;
    expect(event).toMatchObject({ schema_version: 1, status: 'completed', duration_seconds: 120,
      analysis_state: 'complete', emergency_flagged: true, synthetic: true, trigger: 'daily' });
    for (const sensitive of ['private', 'r-1', 'org-1', 'c-1', 'secret-stream-token', '+819012345678', 'gs://']) {
      expect(JSON.stringify(event)).not.toContain(sensitive);
    }
    // Contract with the native BigQuery subscription: every payload field must have a column.
    const sql = readFileSync(new URL('../../../infra/analytics/tables.sql', import.meta.url), 'utf8');
    const columns = [...sql.matchAll(/^  (\w+) (INT64|STRING|TIMESTAMP|BOOL|FLOAT64)( NOT NULL)?/gm)]
      .map((m) => m[1]).filter((c) => !['subscription_name', 'message_id', 'publish_time', 'attributes'].includes(c!));
    expect(Object.keys(event).sort()).toEqual(columns.sort());
  });

  it('uses stable organization-scoped keys and nanosecond source revisions', () => {
    const first = snapshot();
    const a = callEvent(first)!;
    expect(a).toEqual(callEvent(first));
    const newer = callEvent({ ...first, revision: '001792032000.000000002' })!;
    expect(newer.event.call_key).toBe(a.event.call_key);
    expect(newer.fingerprint).toBe(a.fingerprint);
    expect(newer.event.event_id).not.toBe(a.event.event_id);
    const otherOrg = callEvent({ ...first, orgId: 'other' })!.event;
    expect(otherOrg.call_key).not.toBe(a.event.call_key);
    expect(otherOrg.organization_key).not.toBe(a.event.organization_key);
    expect(a.event.call_key).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['scheduled', 'in_progress'] as const)('excludes %s calls', (status) => {
    expect(callEvent(snapshot({ call: call({ status }) }))).toBeNull();
  });
  it('excludes imported history and synthetic evaluation recordings from live operations', () => {
    expect(callEvent(snapshot({ call: call({ source: 'imported', synthetic: true }) }))).toBeNull();
  });
  it.each(['no_answer', 'failed'] as const)('counts %s without claiming it was analyzed', (status) => {
    expect(callEvent(snapshot({ call: call({ status, analysisPending: true }) }))!.event.analysis_state).toBe('not_applicable');
  });
  it.each([
    ['pending', { analysisPending: true }], ['missing', { analysis: undefined }],
    ['partial', { analysis: analysis({ error: 'private model error' }) }],
    ['partial', { analysis: analysis({ voiceError: 'private recording error' }) }],
    ['partial', { analysis: analysis({ incomplete: [{ part: 'review', failure: 'model_unavailable' }] }) }],
  ] as const)('preserves the %s analysis state', (expected, overrides) => {
    const result = callEvent(snapshot({ call: call(overrides as Partial<ReturnType<typeof call>>) }))!;
    expect(result.event.analysis_state).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('marks silence escalation even if the immediate emergency write failed', () => {
    expect(callEvent(snapshot({ call: call({ conversation: { at: '2026-10-15T02:01:00Z',
      endedBy: 'silent_after_greeting', noResponseEscalated: true } }) }))!.event)
      .toMatchObject({ emergency_flagged: true, no_response_escalated: true });
  });
  it('normalizes optional numbers and recognizes call-level synthetic data', () => {
    expect(callEvent(snapshot({ synthetic: false, call: call({ synthetic: true, durationSec: NaN,
      endedAt: undefined, attempt: -1, trigger: 'staff', channel: 'whatsapp' }) }))!.event)
      .toMatchObject({ synthetic: true, duration_seconds: null, call_ended_at: null, attempt: 0, trigger: 'staff', channel: 'whatsapp' });
  });
  it('rejects unusable identities and timestamps instead of poisoning BigQuery', () => {
    for (const source of [snapshot({ orgId: '' }), snapshot({ revision: 'invalid' }),
      snapshot({ updatedAt: 'invalid' }), snapshot({ call: call({ startedAt: 'invalid' }) })]) {
      expect(() => callEvent(source)).toThrow();
    }
  });
});
