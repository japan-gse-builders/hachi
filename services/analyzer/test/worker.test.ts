import { ANALYZE_CALL_PATH, SEND_NOTIFICATION_PATH } from '@hachi/cloud';
import type { Turn } from '@hachi/core';
import { NotFoundError } from '@hachi/store';
import { describe, expect, it, vi } from 'vitest';
import { analyzeCall, parseAnalyzeInput, sweep } from '../src/worker.js';
import { call, rejected, resident, review, setup, TRANSCRIPT, unavailable } from './fixtures.js';

const ref = { residentId: 'res-1', callId: '2026-10-02-1' };
const breathless: Turn[] = [...TRANSCRIPT, { speaker: 'resident', text: "Actually I can't breathe very well.", startMs: 18000, endMs: 21000 }];
const poor = review({ intake: { status: 'poor', reportedPoorDays: 0, evidenceTurns: [3] } });
const starving = review({ intake: { status: 'poor', reportedPoorDays: 3, evidenceTurns: [3] } });

describe('parseAnalyzeInput', () => {
  it('accepts only well-formed ids', () => {
    expect(parseAnalyzeInput(ref)).toEqual(ref);
    for (const body of [null, {}, { residentId: 'res-1' }, { residentId: 'res/1', callId: 'c' }, { residentId: 'r', callId: '' }, { residentId: 1, callId: 'c' }]) {
      expect(parseAnalyzeInput(body)).toBeNull();
    }
  });
});

describe('analyzeCall', () => {
  it('analyses a finished call and clears the pending flag', async () => {
    const { deps, store, reviewer } = await setup();
    await expect(analyzeCall(deps, ref)).resolves.toEqual({ outcome: 'analyzed', rules: [], model: true });
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c).toMatchObject({ analysisPending: false, summary: review().staffSummary, familySummary: review().familySummary });
    expect(c.analysis).toMatchObject({ model: 'gemini-test', turns: 4, memory: review().memory });
    expect(c.speech).toBeDefined();
    expect(c.analysisLease).toBeUndefined();
    expect(reviewer.inputs[0]).toMatchObject({ preferredName: 'Maggie', staffLocale: 'en' });
  });

  it('opens a case, queues notifications and asks the notifier to send them', async () => {
    const { deps, store, notifications, reviewer } = await setup();
    reviewer.next(starving);
    await expect(analyzeCall(deps, ref)).resolves.toMatchObject({ outcome: 'analyzed', rules: ['R2'] });
    const [c] = await store.listCasesByResident('res-1');
    expect(c).toMatchObject({ rule: 'R2', autoUrgency: 'urgent' });
    const outbox = await store.listOutboxByCase(c!.id);
    expect(outbox.length).toBeGreaterThan(0);
    expect(notifications.tasks.map((t) => t.path)).toEqual(outbox.map(() => SEND_NOTIFICATION_PATH));
  });

  it('leaves notifications to the notifier sweep when no queue is configured', async () => {
    const { deps, store, reviewer } = await setup({ notifications: false });
    reviewer.next(starving);
    await analyzeCall(deps, ref);
    const [c] = await store.listCasesByResident('res-1');
    const outbox = await store.listOutboxByCase(c!.id);
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.every((e) => e.status === 'pending')).toBe(true);
  });

  it('does not repeat a detection for the same call', async () => {
    const { deps, store, reviewer } = await setup();
    reviewer.next(poor, poor);
    await analyzeCall(deps, ref);
    await store.updateCall('res-1', ref.callId, (c) => ({ ...c, analysisPending: true }));
    await expect(analyzeCall(deps, ref)).resolves.toMatchObject({ rules: [] });
    const [c] = await store.listCasesByResident('res-1');
    expect(c!.detections).toHaveLength(1);
  });

  it('is a no-op for analysed, unknown or busy calls', async () => {
    const { deps, store } = await setup();
    expect(await analyzeCall(deps, { residentId: 'res-1', callId: 'nope' })).toEqual({ outcome: 'not_found' });
    await store.updateCall('res-1', ref.callId, (c) => ({ ...c, analysisLease: '2099-01-01T00:00:00.000Z' }));
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'busy' });
    await store.updateCall('res-1', ref.callId, (c) => ({ ...c, analysisPending: false }));
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'done' });
  });

  it('reports done when another worker finished between the read and the claim', async () => {
    const { deps, store } = await setup();
    const update = store.updateCall.bind(store);
    vi.spyOn(store, 'updateCall').mockImplementationOnce(async (r, c, fn) => {
      await update(r, c, (x) => ({ ...x, analysisPending: false }));
      return update(r, c, fn);
    });
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'done' });
  });

  it('waits for a possible stream reconnect before analysing', async () => {
    const { deps, advance, reviewer } = await setup({ calls: [call({ conversation: { endedBy: 'agent', at: '2026-10-02T02:59:30.000Z' } })] });
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'retry', reason: 'settling' });
    expect(reviewer.inputs).toHaveLength(0);
    advance(31);
    expect((await analyzeCall(deps, ref)).outcome).toBe('analyzed');
  });

  it('retries temporary model failures, then falls back to the rule-based checks', async () => {
    const { deps, store, reviewer } = await setup({ calls: [call({ transcript: breathless })] });
    reviewer.next(unavailable(), unavailable(), unavailable());
    expect(await analyzeCall(deps, ref, 0)).toMatchObject({ outcome: 'retry', reason: 'Gemini request failed: 503' });
    expect((await store.getCall('res-1', ref.callId))!.analysisLease).toBeUndefined();
    expect(await analyzeCall(deps, ref, 1)).toMatchObject({ outcome: 'retry' });
    await expect(analyzeCall(deps, ref, 2)).resolves.toEqual({ outcome: 'analyzed', rules: ['R1'], model: false });
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c.summary).toBeUndefined();
    expect(c.analysis).toMatchObject({ error: 'Gemini request failed: 503', intake: { status: 'unknown' } });
    expect(c.analysisPending).toBe(false);
  });

  it('does not retry permanent model errors', async () => {
    const { deps, reviewer } = await setup({ calls: [call({ transcript: breathless })] });
    reviewer.next(rejected());
    await expect(analyzeCall(deps, ref)).resolves.toEqual({ outcome: 'analyzed', rules: ['R1'], model: false });
  });

  it('treats unexpected reviewer errors as temporary', async () => {
    const { deps, reviewer } = await setup();
    reviewer.next(new Error('socket hang up'));
    expect(await analyzeCall(deps, ref)).toMatchObject({ outcome: 'retry', reason: 'socket hang up' });
    vi.spyOn(reviewer, 'review').mockRejectedValueOnce('down');
    expect(await analyzeCall(deps, ref)).toMatchObject({ outcome: 'retry', reason: 'down' });
  });

  it('skips the model when the resident said nothing', async () => {
    const { deps, store, reviewer } = await setup({ calls: [call({ transcript: [TRANSCRIPT[0]!] })] });
    await expect(analyzeCall(deps, ref)).resolves.toEqual({ outcome: 'analyzed', rules: [], model: false });
    expect(reviewer.inputs).toHaveLength(0);
    expect((await store.getCall('res-1', ref.callId))!.analysis).toMatchObject({ turns: 1, intake: { status: 'unknown' } });
    const empty = await setup({ calls: [call({ transcript: undefined as never })] });
    expect((await analyzeCall(empty.deps, ref)).outcome).toBe('analyzed');
  });

  it('keeps the call pending when a reconnected stream added turns meanwhile', async () => {
    const { deps, store, reviewer } = await setup();
    vi.spyOn(reviewer, 'review').mockImplementationOnce(async () => {
      await store.updateCall('res-1', ref.callId, (c) => ({ ...c, transcript: breathless }));
      return review();
    });
    await analyzeCall(deps, ref);
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c.analysis!.turns).toBe(4);
    expect(c.analysisPending).toBe(true);
    expect(c.analysisLease).toBeUndefined();
  });

  it('finishes calls of deleted residents without analysing them', async () => {
    const { deps, store, reviewer } = await setup({ resident: null });
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'done' });
    expect((await store.getCall('res-1', ref.callId))!.analysisPending).toBe(false);
    expect(reviewer.inputs).toHaveLength(0);
  });

  it('releases the call when storing the result fails', async () => {
    const { deps, store } = await setup();
    vi.spyOn(store, 'listCalls').mockRejectedValueOnce(new Error('firestore down'));
    await expect(analyzeCall(deps, ref)).rejects.toThrow('firestore down');
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c).toMatchObject({ analysisPending: true });
    expect(c.analysisLease).toBeUndefined();
  });

  describe('speech from the recording', () => {
    const recorded = () => call({ audioUri: 'gs://rec/res-1/2026-10-02-1.wav' });

    it('measures response time and repairs from the audio', async () => {
      const { deps, store, recordings, listener } = await setup({ calls: [recorded()], voice: true });
      expect((await analyzeCall(deps, ref)).outcome).toBe('analyzed');
      expect(recordings.reads).toEqual(['gs://rec/res-1/2026-10-02-1.wav']);
      expect(listener.heard).toHaveLength(1);
      const c = (await store.getCall('res-1', ref.callId))!;
      expect(c.speech).toMatchObject({ measuredFrom: 'audio', features: { responseLatencyMs: 1000 } });
      expect(c.speech!.examples!.map((e) => e.kind)).toEqual(['slow_response', 'slow_response', 'false_start', 'repetition']);
      expect(c.analysis!.voiceError).toBeUndefined();
    });

    it('excludes the call from R3 when the model hears a poor line', async () => {
      const { deps, store, listener } = await setup({ calls: [recorded()], voice: true });
      listener.fallback = { ...listener.fallback, audioQuality: 0.2 };
      await analyzeCall(deps, ref);
      expect((await store.getCall('res-1', ref.callId))!.speech!.exclusionReasons).toContain('poor_audio');
    });

    it('retries when the recording cannot be fetched, then measures only the words', async () => {
      const { deps, store, recordings } = await setup({ calls: [recorded()], voice: true });
      recordings.results.push(new Error('storage 503'), new Error('storage 503'), new Error('storage 503'));
      expect(await analyzeCall(deps, ref, 0)).toEqual({ outcome: 'retry', reason: 'storage 503' });
      expect((await store.getCall('res-1', ref.callId))!.analysisLease).toBeUndefined();
      expect((await analyzeCall(deps, ref, 1)).outcome).toBe('retry');
      expect((await analyzeCall(deps, ref, 2)).outcome).toBe('analyzed');
      const c = (await store.getCall('res-1', ref.callId))!;
      expect(c.speech).toMatchObject({ measuredFrom: 'text_only', features: { responseLatencyMs: null, repairRate: null } });
      expect(c.analysis!.voiceError).toBe('storage 503');
    });

    it('retries a listening outage but not an unreadable file or a rejected request', async () => {
      const outage = await setup({ calls: [recorded()], voice: true });
      outage.listener.results.push(unavailable());
      expect(await analyzeCall(outage.deps, ref, 0)).toMatchObject({ outcome: 'retry' });
      expect((await analyzeCall(outage.deps, ref, 1)).outcome).toBe('analyzed');
      expect((await outage.store.getCall('res-1', ref.callId))!.speech!.measuredFrom).toBe('audio');

      const broken = await setup({ calls: [recorded()], voice: true });
      broken.recordings.fallback = Buffer.from('not audio');
      expect((await analyzeCall(broken.deps, ref, 0)).outcome).toBe('analyzed');
      expect((await broken.store.getCall('res-1', ref.callId))!.analysis!.voiceError).toContain('Not a WAV');

      const both = await setup({ calls: [recorded()], voice: true });
      both.reviewer.next(rejected());
      both.recordings.results.push(new Error('storage 503'));
      expect(await analyzeCall(both.deps, ref, 0)).toEqual({ outcome: 'retry', reason: 'storage 503' });

      const refused = await setup({ calls: [recorded()], voice: true });
      refused.listener.results.push(rejected());
      expect((await analyzeCall(refused.deps, ref, 0)).outcome).toBe('analyzed');
      expect((await refused.store.getCall('res-1', ref.callId))!.speech!.measuredFrom).toBe('text_only');
    });

    it('uses the transcript for imported history and skips calls without audio or answers', async () => {
      const imported = await setup({ calls: [call({ source: 'imported', audioUri: 'gs://rec/x.wav' })], voice: true });
      await analyzeCall(imported.deps, ref);
      expect(imported.recordings.reads).toHaveLength(0);
      expect((await imported.store.getCall('res-1', ref.callId))!.speech!.measuredFrom).toBe('transcript');

      const noAudio = await setup({ voice: true });
      await analyzeCall(noAudio.deps, ref);
      expect((await noAudio.store.getCall('res-1', ref.callId))!.speech!.measuredFrom).toBe('text_only');

      const silent = await setup({ calls: [call({ audioUri: 'gs://rec/x.wav', transcript: [TRANSCRIPT[0]!] })], voice: true });
      await analyzeCall(silent.deps, ref);
      expect(silent.recordings.reads).toHaveLength(0);
    });
  });

  it('reports not_found when the call disappears during analysis', async () => {
    const { deps, store } = await setup();
    vi.spyOn(store, 'listCalls').mockRejectedValueOnce(new NotFoundError('call'));
    expect(await analyzeCall(deps, ref)).toEqual({ outcome: 'not_found' });
  });
});

describe('sweep', () => {
  const old = (id: string, extra = {}) => call({ id, conversation: { endedBy: 'agent', at: '2026-10-02T02:00:00.000Z' }, ...extra });

  it('queues pending calls whose task was lost', async () => {
    const { deps, queue, store } = await setup({
      calls: [
        old('a'),
        old('b', { analysisPending: false }),
        old('c', { analysisLease: '2099-01-01T00:00:00.000Z' }),
        call({ id: 'd', conversation: { endedBy: 'agent', at: '2026-10-02T02:58:00.000Z' } }),
        call({ id: 'e', source: 'imported', conversation: undefined as never, createdAt: '2026-10-01T00:00:00.000Z' }),
      ],
    });
    await store.createResident(resident({ id: 'res-2', active: false }));
    await store.addCalls([call({ id: 'x', residentId: 'res-2' })]);
    expect(await sweep(deps)).toEqual({ queued: 2, errors: [] });
    expect(queue.tasks.map((t) => [t.name, t.path, t.body]).sort()).toEqual([
      ['analyze-res-1-a-sweep-2026100203', ANALYZE_CALL_PATH, { residentId: 'res-1', callId: 'a' }],
      ['analyze-res-1-e-sweep-2026100203', ANALYZE_CALL_PATH, { residentId: 'res-1', callId: 'e' }],
    ]);
  });

  it('stops after the batch is full and uses the end time when there is no conversation record', async () => {
    const ended = call({ id: 'a', conversation: undefined as never, endedAt: '2026-10-02T01:00:00.000Z' });
    delete ended.conversation;
    const { deps, store, queue } = await setup({ calls: [ended] });
    await store.createResident(resident({ id: 'res-2', phone: '+819000000099', familyLookup: ['+819000000099'] }));
    await store.addCalls([old('b', { residentId: 'res-2' })]);
    expect((await sweep(deps, { limit: 1 })).queued).toBe(1);
    expect(queue.tasks).toHaveLength(1);
  });

  it('caps the batch and reports enqueue failures', async () => {
    const { deps, queue } = await setup({ calls: [old('a'), old('b'), old('c')] });
    expect((await sweep(deps, { limit: 2 })).queued).toBe(2);
    queue.fail = true;
    const r = await sweep(deps, { minAgeSec: 0 });
    expect(r.queued).toBe(0);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toContain('tasks unavailable');
  });
});
