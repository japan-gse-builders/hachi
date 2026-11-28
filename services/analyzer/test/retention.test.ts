import { setCallMediaRetention } from '@hachi/core';
import { MemoryStore, type CallRecord, type Organization, type StoredCase } from '@hachi/store';
import type { Storage } from 'firebase-admin/storage';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { GcsRecordingDeletion } from '../src/gcsRetention.js';
import { sweepCallMedia } from '../src/retention.js';
import { analyzeCall } from '../src/worker.js';
import { call, NOW, resident, review, setup } from './fixtures.js';

const oldTime = '2026-10-01T03:00:00.000Z';
const primary = 'gs://hachi-recordings/recordings/res-1/past-s1.wav';
const extra = 'gs://hachi-recordings/recordings/res-1/past-s2.wav';
const oldest = (patch: Partial<CallRecord> = {}) => call({ id: 'past', startedAt: oldTime, endedAt: oldTime, audioUri: primary, ...patch });

const org: Organization = {
  id: 'org-1', name: 'Sakura Care', timeZone: 'Asia/Tokyo', status: 'active',
  billing: { plan: 'internal', email: 'office@example.org', limits: { residents: 50, members: 10 } },
  createdAt: oldTime, createdBy: 'staff-1', updatedAt: oldTime,
  callMediaRetention: setCallMediaRetention(undefined, 1, NOW),
};

function caseFor(oldCall: CallRecord, recent: CallRecord): StoredCase {
  return {
    id: 'case-1', residentId: oldCall.residentId, orgId: org.id, rule: 'R1', autoUrgency: 'emergency', status: 'open',
    firstDetectedAt: oldTime, updatedAt: oldTime, notifications: [],
    detections: [{
      residentId: oldCall.residentId, rule: 'R1', urgency: 'emergency', confidence: 1, detectedAt: oldTime,
      summary: 'Staff should check in.',
      evidence: [{ callId: oldCall.id, quote: 'Expired quoted words' }, { callId: recent.id, quote: 'Current quoted words' }],
    }],
  };
}

describe('scheduled call media cleanup', () => {
  it('runs from the existing authenticated scheduler endpoint', async () => {
    const { store, deps } = await setup({ calls: [oldest()] });
    store.seedAccounts({ organizations: [org] });
    const deleteCallRecordings = vi.fn(async () => undefined);
    const verifier = {
      async verify(token: string | undefined) { if (token !== 'Bearer scheduled') throw new Error('Refused'); },
    };
    const app = buildApp({ ...deps, verifier, mediaDeletion: { deleteCallRecordings } });
    const sweep = { method: 'POST' as const, url: '/tasks/sweep' };
    expect((await app.inject(sweep)).statusCode).toBe(403);
    expect(deleteCallRecordings).not.toHaveBeenCalled();
    const res = await app.inject({ ...sweep, headers: { authorization: 'Bearer scheduled' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toEqual({ purged: 1, errors: [] });
    expect((await store.getCall('res-1', 'past'))?.transcript).toBeUndefined();
  });

  it('deletes recordings and transcript copies for a paused resident while retaining care metadata', async () => {
    const store = new MemoryStore();
    const paused = resident({ active: false });
    store.seedAccounts({ organizations: [org] });
    await store.createResident(paused);
    const past = oldest({
      extraAudioUris: [extra],
      summary: { health: 'Derived care notes', meals: 'Normal', topics: [] },
      emergency: { at: oldTime, caseId: 'case-1', quote: 'Expired quoted words' },
      speech: {
        callId: 'past', at: oldTime, usable: true, exclusionReasons: [],
        features: { responseLatencyMs: 400, repairRate: null, lexicalDiversity: null, topicCoherence: null },
        examples: [{ kind: 'slow_response', quote: 'Expired spoken example' }],
      },
    });
    const recent = call({ id: 'recent' });
    await store.addCalls([past, recent]);
    await store.putCase(caseFor(past, recent));
    const objects = new Set([primary, extra]);
    const deleteCallRecordings = vi.fn(async (expired: CallRecord) => {
      for (const name of [expired.audioUri, ...expired.extraAudioUris ?? []]) if (name) objects.delete(name);
    });
    expect(await sweepCallMedia(store, { deleteCallRecordings }, NOW)).toEqual({ purged: 1, errors: [] });
    const saved = (await store.getCall(paused.id, past.id))!;
    expect(saved).toMatchObject({
      mediaExpiredAt: NOW.toISOString(), summary: past.summary, analysisPending: false,
      emergency: { caseId: 'case-1' }, speech: { features: past.speech!.features },
    });
    expect(saved.transcript).toBeUndefined();
    expect(saved.audioUri).toBeUndefined();
    expect(saved.extraAudioUris).toBeUndefined();
    expect(saved.mediaPurgeDueAt).toBeUndefined();
    expect(saved.emergency!.quote).toBeUndefined();
    expect(saved.speech!.examples).toBeUndefined();
    expect(objects.size).toBe(0);
    expect((await store.getCase('case-1'))!.detections[0]!.evidence).toEqual([
      { callId: past.id, quote: '' }, { callId: recent.id, quote: 'Current quoted words' },
    ]);
    expect(await store.getCall('res-1', 'recent')).toEqual(recent);
    expect(await sweepCallMedia(store, { deleteCallRecordings }, NOW)).toEqual({ purged: 0, errors: [] });
    expect(deleteCallRecordings).toHaveBeenCalledTimes(1);
  });

  it('retries a partial storage failure and does not block a later call behind it', async () => {
    const store = new MemoryStore();
    store.seedAccounts({ organizations: [org] });
    await store.createResident(resident());
    await store.addCalls([oldest({ id: 'a' }), oldest({ id: 'b' })]);
    const deleteCallRecordings = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined);
    await expect(sweepCallMedia(store, { deleteCallRecordings }, NOW, 1)).resolves.toMatchObject({ purged: 0, errors: ['res-1/a: media purge failed'] });
    const failed = (await store.getCall('res-1', 'a'))!;
    expect(failed).toMatchObject({ audioUri: primary, mediaExpiredAt: NOW.toISOString(), mediaPurgeDueAt: '2026-10-02T04:00:00.000Z' });
    expect(failed.transcript).toBeUndefined();
    await expect(sweepCallMedia(store, { deleteCallRecordings }, NOW, 1)).resolves.toEqual({ purged: 1, errors: [] });
    expect(deleteCallRecordings.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b']);
    await expect(sweepCallMedia(store, { deleteCallRecordings }, new Date('2026-10-02T04:00:00.000Z'), 1)).resolves.toEqual({ purged: 1, errors: [] });
    expect(deleteCallRecordings.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b', 'a']);
  });

  it('honors an active analysis lease and resumes the scan after it ends', async () => {
    const store = new MemoryStore();
    store.seedAccounts({ organizations: [org] });
    await store.createResident(resident());
    const leaseUntil = new Date(NOW.getTime() + 30_000);
    await store.addCalls([oldest({ analysisLease: leaseUntil.toISOString() })]);
    const deleteCallRecordings = vi.fn(async () => undefined);
    expect((await sweepCallMedia(store, { deleteCallRecordings }, NOW)).purged).toBe(0);
    expect(deleteCallRecordings).not.toHaveBeenCalled();
    expect((await sweepCallMedia(store, { deleteCallRecordings }, leaseUntil)).purged).toBe(1);
  });

  it('leaves a late recording attached to an expired call queued for another purge', async () => {
    const store = new MemoryStore();
    store.seedAccounts({ organizations: [org] });
    await store.createResident(resident());
    await store.addCalls([oldest()]);
    const again = new Date(NOW.getTime() + 1000);
    const deleteCallRecordings = vi.fn(async () => undefined).mockImplementationOnce(async () => {
      await store.updateCall('res-1', 'past', (c) => ({ ...c, extraAudioUris: [extra], mediaPurgeDueAt: again.toISOString() }));
    });
    expect((await sweepCallMedia(store, { deleteCallRecordings }, NOW)).purged).toBe(0);
    expect((await store.getCall('res-1', 'past'))?.mediaPurgeDueAt).toBe(again.toISOString());
    expect((await sweepCallMedia(store, { deleteCallRecordings }, again)).purged).toBe(1);
    expect((await store.getCall('res-1', 'past'))?.extraAudioUris).toBeUndefined();
  });

  it('does not publish a review that finishes after the expiry boundary', async () => {
    const { deps, reviewer, store } = await setup({ calls: [oldest()] });
    store.seedAccounts({ organizations: [{ ...org, callMediaRetention: setCallMediaRetention(undefined, 1, new Date(NOW.getTime() - 10)) }] });
    let current = new Date(NOW.getTime() - 10);
    deps.now = () => current;
    vi.spyOn(reviewer, 'review').mockImplementationOnce(async () => {
      current = NOW;
      return review();
    });
    expect(await analyzeCall(deps, { residentId: 'res-1', callId: 'past' })).toEqual({ outcome: 'done' });
    expect(reviewer.review).toHaveBeenCalledOnce();
    const saved = (await store.getCall('res-1', 'past'))!;
    expect(saved.analysis).toBeUndefined();
    expect(saved.analysisPending).toBe(false);
    expect(await store.listPendingOutbox(5)).toEqual([]);
  });
});

describe('recording bucket cleanup', () => {
  it('deletes every generation of the exact call objects, including unlinked reconnect segments', async () => {
    function object(name: string) { return { name, delete: vi.fn(async () => undefined) }; }
    const first = object('recordings/res-1/past-s1.wav');
    const previous = object(first.name);
    const unlinked = object('recordings/res-1/past-s3.wav');
    const collision = object('recordings/res-1/past-s3.wav.backup');
    const olderPath = object('legacy/res-1/past.wav');
    const getFiles = vi.fn(async ({ prefix }: { prefix: string; versions: boolean }) => prefix.endsWith('-s')
      ? [[first, previous, unlinked, collision]] : [[olderPath]]);
    const storage = { bucket: vi.fn(() => ({ getFiles })) } as unknown as Storage;
    const deletion = new GcsRecordingDeletion(storage, 'hachi-recordings');
    await deletion.deleteCallRecordings(oldest({ extraAudioUris: ['gs://hachi-recordings/legacy/res-1/past.wav'] }));
    expect(getFiles).toHaveBeenCalledWith({ prefix: 'recordings/res-1/past-s', versions: true });
    for (const file of [first, previous, unlinked, olderPath]) expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(collision.delete).not.toHaveBeenCalled();
    await expect(deletion.deleteCallRecordings(oldest({ audioUri: 'gs://another-bucket/important.wav' }))).rejects.toThrow(/outside the configured/);
  });
});
