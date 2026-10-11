import { ANALYZE_CALL_PATH, SEND_NOTIFICATION_PATH } from '@hachi/cloud';
import type { Turn } from '@hachi/core';
import { NotFoundError } from '@hachi/store';
import { describe, expect, it, vi } from 'vitest';
import { ReviewError } from '../src/model.js';
import { analyzeCall, parseAnalyzeInput, sweep } from '../src/worker.js';
import { call, rejected, resident, review, setup, TRANSCRIPT, unavailable } from './fixtures.js';

const ref = { residentId: 'res-1', callId: '2026-10-02-1' };
const breathless: Turn[] = [...TRANSCRIPT, { speaker: 'resident', text: "Actually I can't breathe very well.", startMs: 18000, endMs: 21000 }];
const poor = review({ intake: { status: 'poor', fluids: 'unknown', reportedPoorDays: 0, evidenceTurns: [3] } });
const starving = review({ intake: { status: 'poor', fluids: 'unknown', reportedPoorDays: 3, evidenceTurns: [3] } });

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
    await expect(analyzeCall(deps, ref)).resolves.toEqual({ outcome: 'analyzed', rules: [], model: true, incomplete: [] });
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c).toMatchObject({ analysisPending: false, summary: review().staffSummary, familySummary: review().familySummary });
    expect(c.wellbeing).toMatchObject({ domains: { body: 'concern', food: 'concern', mood: 'good', sleep: 'unmentioned' }, headline: review().headline });
    expect(c.wellbeing!.tags.map((t) => t.id)).toEqual(['body.tired', 'mood.looking_forward', 'food.ate_little']);
    expect(c.analysis).toMatchObject({ model: 'gemini-test', turns: 4, memory: review().memory });
    expect(c.speech).toBeDefined();
    expect(c.analysisLease).toBeUndefined();
    expect(reviewer.inputs[0]).toMatchObject({ preferredName: 'Maggie', staffLocale: 'en' });
  });

  it('looks for set-question answers only in the daily call, not in one staff asked for (issue #13)', async () => {
    const daily = await setup();
    await analyzeCall(daily.deps, ref);
    expect(daily.reviewer.inputs[0]!.items!.length).toBeGreaterThan(0);
    const extra = await setup({ calls: [call({ trigger: 'staff', requestedBy: 'staff-1' })] });
    await analyzeCall(extra.deps, ref);
    expect(extra.reviewer.inputs[0]!.items).toEqual([]);
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

  describe('a resident asking for someone to ring them (CNV-15, NTF-05)', () => {
    const ASKED: Turn[] = [
      ...TRANSCRIPT,
      { speaker: 'agent', text: 'Would you like me to tell your family or a friend that you would like a phone call?', startMs: 17500, endMs: 21000 },
      { speaker: 'resident', text: 'Yes, my neighbour Susan, on 090 1111 2222.', startMs: 21200, endMs: 25000 },
    ];
    const requested = (who: string, confirmed = true) => review({ contactRequest: { who, confirmed, turn: 5 } });
    const asking = (over = {}) => ({ calls: [call({ transcript: ASKED, ...over })] });

    it('texts the family contact we hold as soon as the call is analysed', async () => {
      const { deps, store, notifications, reviewer } = await setup(asking());
      reviewer.next(requested('my daughter Alice'));
      await analyzeCall(deps, ref);
      const [queued] = await store.listPendingOutbox(10);
      expect(queued).toMatchObject({ kind: 'contact_request', recipient: 'family', address: '+819000000002', status: 'pending' });
      expect(notifications.tasks.map((t) => t.path)).toEqual([SEND_NOTIFICATION_PATH]);
    });

    it('holds a number the resident read out, and asks the notifier to send nothing', async () => {
      const { deps, store, notifications, reviewer } = await setup(asking());
      reviewer.next(requested('my neighbour Susan'));
      await analyzeCall(deps, ref);
      const [waiting] = await store.listOutboxAwaitingApproval(10);
      expect(waiting).toMatchObject({ recipient: 'contact', address: '+819011112222', requestedFor: 'my neighbour Susan' });
      expect(await store.listPendingOutbox(10)).toEqual([]);
      expect(notifications.tasks).toEqual([]);
    });

    it('keeps the request on the call even when there is no one to text', async () => {
      const { deps, store, reviewer } = await setup({ ...asking(), resident: resident({ family: undefined, familyLookup: [] }) });
      reviewer.next(requested('my daughter Alice', false));
      await analyzeCall(deps, ref);
      expect((await store.getCall('res-1', ref.callId))!.analysis!.contactRequest).toMatchObject({ who: 'my daughter Alice' });
      expect(await store.listPendingOutbox(10)).toEqual([]);
      expect(await store.listOutboxAwaitingApproval(10)).toEqual([]);
    });

    it('does not text anyone about a call that was imported from the past', async () => {
      const { deps, store, reviewer } = await setup(asking({ source: 'imported' }));
      reviewer.next(requested('my daughter Alice'));
      await analyzeCall(deps, ref);
      expect(await store.listPendingOutbox(10)).toEqual([]);
    });

    it('texts once when the analysis runs twice', async () => {
      const { deps, store, reviewer } = await setup(asking());
      reviewer.next(requested('my daughter Alice'), requested('my daughter Alice'));
      await analyzeCall(deps, ref);
      await store.updateCall('res-1', ref.callId, (c) => ({ ...c, analysisPending: true }));
      await analyzeCall(deps, ref);
      expect(await store.listPendingOutbox(10)).toHaveLength(1);
    });
  });

  describe('telling family that more company would be welcome', () => {
    const CONSENTED = resident({ consent: { shareMood: true, recordedAt: '2026-08-01T00:00:00.000Z', recordedBy: 'staff-1' } });
    /** Every UCLA item answered "often", which is the top of the scale. */
    const lonely = review({
      answers: ['uls3.companionship', 'uls3.left_out', 'uls3.isolated'].map((itemId) => ({ itemId, answer: 'Often', turn: 1 })),
    });

    it('texts and emails the family once the resident has agreed their mood may be shared', async () => {
      const { deps, store, notifications, reviewer } = await setup({ resident: CONSENTED });
      reviewer.next(lonely);
      await analyzeCall(deps, ref);
      const queued = await store.listPendingOutbox(10);
      expect(queued.map((e) => e.channel).sort()).toEqual(['email', 'sms']);
      expect(queued.every((e) => e.kind === 'loneliness' && e.recipient === 'family')).toBe(true);
      expect(notifications.tasks).toHaveLength(2);
    });

    it('tells the family nothing when the resident has not agreed to it', async () => {
      const { deps, store, reviewer } = await setup();
      reviewer.next(lonely);
      await analyzeCall(deps, ref);
      expect(await store.listPendingOutbox(10)).toEqual([]);
    });

    it('tells the family nothing while the screen is incomplete', async () => {
      const { deps, store, reviewer } = await setup({ resident: CONSENTED });
      reviewer.next(review({ answers: [{ itemId: 'uls3.left_out', answer: 'Often', turn: 1 }] }));
      await analyzeCall(deps, ref);
      expect(await store.listPendingOutbox(10)).toEqual([]);
    });

    it('does not tell them twice in one rotation', async () => {
      const { deps, store, reviewer } = await setup({ resident: CONSENTED });
      reviewer.next(lonely, lonely);
      await analyzeCall(deps, ref);
      await store.updateCall('res-1', ref.callId, (c) => ({ ...c, analysisPending: true }));
      await analyzeCall(deps, ref);
      expect(await store.listPendingOutbox(10)).toHaveLength(2);
    });
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
    await expect(analyzeCall(deps, ref, 2)).resolves.toEqual({
      outcome: 'analyzed',
      rules: ['R1'],
      model: false,
      incomplete: [{ part: 'review', failure: 'model_unavailable' }],
      errors: ['Gemini request failed: 503'],
    });
    const c = (await store.getCall('res-1', ref.callId))!;
    expect(c.summary).toBeUndefined();
    expect(c.analysis).toMatchObject({
      error: 'Gemini request failed: 503',
      intake: { status: 'unknown' },
      incomplete: [{ part: 'review', failure: 'model_unavailable' }],
    });
    expect(c.analysisPending).toBe(false);
  });

  it('does not retry permanent model errors', async () => {
    const { deps, reviewer } = await setup({ calls: [call({ transcript: breathless })] });
    reviewer.next(rejected());
    await expect(analyzeCall(deps, ref)).resolves.toMatchObject({
      outcome: 'analyzed',
      rules: ['R1'],
      model: false,
      incomplete: [{ part: 'review', failure: 'model_rejected' }],
    });
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
    await expect(analyzeCall(deps, ref)).resolves.toEqual({ outcome: 'analyzed', rules: [], model: false, incomplete: [] });
    expect(reviewer.inputs).toHaveLength(0);
    // Nobody spoke, so there was nothing to review: not a gap staff need to chase.
    const analysis = (await store.getCall('res-1', ref.callId))!.analysis!;
    expect(analysis).toMatchObject({ turns: 1, intake: { status: 'unknown' } });
    expect(analysis.incomplete).toBeUndefined();
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
      expect(c.analysis!.incomplete).toEqual([{ part: 'voice', failure: 'recording_missing' }]);
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
      const unreadable = (await broken.store.getCall('res-1', ref.callId))!.analysis!;
      expect(unreadable.voiceError).toContain('Not a WAV');
      expect(unreadable.incomplete).toEqual([{ part: 'voice', failure: 'recording_unreadable' }]);

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

  describe('a call the model could not review (issue #11)', () => {
    it('records the failure as a category, not only as the raw message', async () => {
      const { deps, store, reviewer } = await setup();
      reviewer.next(new ReviewError('Gemini output does not match the schema: intake', true, 'invalid_output'));
      await analyzeCall(deps, ref, 3);
      const a = (await store.getCall('res-1', ref.callId))!.analysis!;
      expect(a.incomplete).toEqual([{ part: 'review', failure: 'model_invalid_output' }]);
      expect(a.error).toContain('does not match the schema');
    });

    it('files errors that are not from Gemini as unknown, after the retries run out', async () => {
      const { deps, store, reviewer } = await setup();
      reviewer.next(new Error('socket hang up'));
      await analyzeCall(deps, ref, 3);
      expect((await store.getCall('res-1', ref.callId))!.analysis!.incomplete).toEqual([{ part: 'review', failure: 'unknown' }]);
    });

    it('fills in what was missing when staff ask for it to be analysed again', async () => {
      const { deps, store, reviewer } = await setup();
      reviewer.next(rejected());
      await analyzeCall(deps, ref);
      expect((await store.getCall('res-1', ref.callId))!.summary).toBeUndefined();

      await store.updateCall('res-1', ref.callId, (c) => ({
        ...c,
        analysisPending: true,
        reanalysis: { requestedAt: '2026-10-02T03:00:00.000Z', requestedBy: 'staff-1' },
      }));
      expect((await analyzeCall(deps, ref)).outcome).toBe('analyzed');
      const c = (await store.getCall('res-1', ref.callId))!;
      expect(c.summary).toEqual(review().staffSummary);
      expect(c.analysis!.incomplete).toBeUndefined();
      expect(c.analysis!.error).toBeUndefined();
      expect(c.analysisPending).toBe(false);
    });

    it('does not raise again what staff already closed for this call', async () => {
      const { deps, store, reviewer, advance } = await setup({ calls: [call({ transcript: breathless })] });
      reviewer.next(rejected());
      expect(await analyzeCall(deps, ref)).toMatchObject({ rules: ['R1'] });
      const [first] = await store.listCasesByResident('res-1');
      await store.mutateCase(first!.id, (c) => ({ case: { ...c, status: 'closed' }, events: [] }));

      advance(600);
      await store.updateCall('res-1', ref.callId, (c) => ({
        ...c,
        analysisPending: true,
        reanalysis: { requestedAt: deps.now().toISOString(), requestedBy: 'staff-1' },
      }));
      advance(60);
      await expect(analyzeCall(deps, ref)).resolves.toMatchObject({ outcome: 'analyzed', rules: [], model: true });
      expect(await store.listCasesByResident('res-1')).toHaveLength(1);
      expect((await store.getCall('res-1', ref.callId))!.summary).toEqual(review().staffSummary);
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

  it('names a staff-requested pass after the request, so an earlier sweep task cannot swallow it', async () => {
    const { deps, queue } = await setup({
      calls: [
        old('a', {
          analysis: { at: '2026-10-02T02:01:00.000Z', turns: 4, intake: { date: '2026-10-02', status: 'unknown' }, memory: { topics: [], plans: [], likes: [] } },
          reanalysis: { requestedAt: '2026-10-02T02:30:15.123Z', requestedBy: 'staff-1' },
        }),
      ],
    });
    await sweep(deps);
    expect(queue.tasks.map((t) => t.name)).toEqual(['analyze-res-1-a-reanalysis-20261002023015123-2026100203']);
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
