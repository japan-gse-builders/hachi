import type { CallAnalysis } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { call, makeResident, NOW, setup } from './helpers.js';

/** Issue #11: a call the model could not review must not look like a call in which nothing was wrong. */

const analysis = (overrides: Partial<CallAnalysis> = {}): CallAnalysis => ({
  at: '2026-10-01T01:10:00.000Z',
  turns: 2,
  intake: { date: '2026-10-01', status: 'unknown' },
  memory: { topics: [], plans: [], likes: [] },
  ...overrides,
});

const failedReview = () =>
  call({
    id: 'failed',
    summary: undefined,
    familySummary: undefined,
    analysis: analysis({ incomplete: [{ part: 'review', failure: 'model_unavailable' }], error: 'Gemini request failed: 503 RESOURCE_EXHAUSTED project-123' }),
  });

async function seeded() {
  const ctx = setup();
  await ctx.store.createResident(makeResident('res-1', { consent: { shareMood: true, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' } }));
  await ctx.store.addCalls([
    failedReview(),
    call({ id: 'fine', startedAt: '2026-09-30T01:00:00.000Z', analysis: analysis({ model: 'gemini-test' }) }),
  ]);
  return ctx;
}

describe('calls whose analysis did not finish (issue #11)', () => {
  it('are listed on the staff queue, apart from the cases and without an urgency', async () => {
    const { app, as } = await seeded();
    const body = (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json();
    expect(body.items).toEqual([]);
    expect(body.incomplete.items).toHaveLength(1);
    const item = body.incomplete.items[0];
    expect(item).toMatchObject({
      residentId: 'res-1',
      residentName: 'Margaret Smith',
      callId: 'failed',
      parts: ['review'],
      reasons: ['AI model temporarily unavailable'],
      reanalysisRequested: false,
    });
    expect(item.notChecked).toContain('Meals and drinks (R2)');
    expect(item.checked).toContain('(R1)');
    expect(item).not.toHaveProperty('urgency');
    expect(body.incomplete.note).toContain('not as fine');
  });

  it('never return the provider’s raw error text', async () => {
    const { app, as } = await seeded();
    for (const url of ['/api/queue', '/api/incomplete-analyses']) {
      const text = (await app.inject({ method: 'GET', url, ...as('staff') })).body;
      expect(text).not.toContain('RESOURCE_EXHAUSTED');
      expect(text).not.toContain('Gemini request failed');
    }
  });

  it('are listed for the residents page, localized server-side', async () => {
    const { app, as } = await seeded();
    const ja = (await app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...as('staff') })).json();
    expect(ja.items[0].reasons).toEqual(['AI モデルの一時的な障害']);
    expect(ja.items[0].notChecked).toContain('食事と水分（R2）');
  });

  it('include calls analysed before the categories existed, from their raw errors', async () => {
    const { app, store, as } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([call({ id: 'legacy', analysis: analysis({ voiceError: 'Not a WAV file' }) })]);
    const body = (await app.inject({ method: 'GET', url: '/api/incomplete-analyses?locale=en', ...as('staff') })).json();
    expect(body.items[0]).toMatchObject({ callId: 'legacy', parts: ['voice'], reasons: ['Unexpected error'] });
  });

  it('leave out fully analysed calls, imported history and calls older than a week', async () => {
    const { app, store, as } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([
      call({ id: 'ok', analysis: analysis() }),
      call({ id: 'imported', source: 'imported', analysis: analysis({ error: 'x' }) }),
      call({ id: 'old', startedAt: '2026-09-20T01:00:00.000Z', analysis: analysis({ error: 'x' }) }),
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...as('staff') })).json()).toEqual({ items: [], note: null });
  });

  it('are staff only', async () => {
    const { app, as } = await seeded();
    for (const who of ['familyPhone', null] as const) {
      const list = await app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...as(who) });
      expect(list.statusCode).toBe(who ? 403 : 401);
      const post = await app.inject({ method: 'POST', url: '/api/residents/res-1/calls/failed/reanalysis', ...as(who) });
      expect(post.statusCode).toBe(who ? 403 : 401);
    }
  });

  describe('family dashboard', () => {
    it('shows the notes as still to come, with no reason and nothing that reads as fine', async () => {
      const { app, as } = await seeded();
      const res = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard?locale=en', ...as('familyPhone') });
      const calls = res.json().calls as { startedAt: string; notesPending: boolean; summary: unknown; domains: unknown }[];
      const failed = calls.find((c) => c.startedAt === failedReview().startedAt && c.notesPending)!;
      expect(failed).toMatchObject({ notesPending: true, summary: null, domains: null });
      expect(calls.filter((c) => c.notesPending)).toHaveLength(1);
      expect(res.body).not.toContain('incomplete');
      expect(res.body).not.toContain('model_unavailable');
      expect(res.body).not.toContain('Gemini');
    });
  });

  describe('asking for a call to be analysed again', () => {
    const reanalyse = (ctx: Awaited<ReturnType<typeof seeded>>, callId = 'failed', residentId = 'res-1') =>
      ctx.app.inject({ method: 'POST', url: `/api/residents/${residentId}/calls/${callId}/reanalysis`, ...ctx.as('staff') });

    it('puts the call back to pending, records who asked, and shows it as requested', async () => {
      const ctx = await seeded();
      const res = await reanalyse(ctx);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'requested', requestedAt: NOW.toISOString() });
      const c = (await ctx.store.getCall('res-1', 'failed'))!;
      expect(c.analysisPending).toBe(true);
      expect(c.reanalysis).toEqual({ requestedAt: NOW.toISOString(), requestedBy: 'staff-1' });
      const list = (await ctx.app.inject({ method: 'GET', url: '/api/incomplete-analyses', ...ctx.as('staff') })).json();
      expect(list.items[0]).toMatchObject({ callId: 'failed', reanalysisRequested: true });
    });

    it('refuses a second request while the first is waiting', async () => {
      const ctx = await seeded();
      expect((await reanalyse(ctx)).statusCode).toBe(202);
      const again = await reanalyse(ctx);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toContain('already waiting');
    });

    it('refuses a call that was fully analysed', async () => {
      const ctx = await seeded();
      const res = await reanalyse(ctx, 'fine');
      expect(res.statusCode).toBe(409);
      expect((await ctx.store.getCall('res-1', 'fine'))!.analysisPending).toBe(false);
    });

    it('refuses while the resident’s calls are paused, since nothing would run it', async () => {
      const ctx = await seeded();
      await ctx.store.updateResident('res-1', (r) => ({ ...r, active: false }));
      expect((await reanalyse(ctx)).statusCode).toBe(409);
      expect((await ctx.store.getCall('res-1', 'failed'))!.analysisPending).toBe(false);
    });

    it('answers 404 for an unknown resident or call', async () => {
      const ctx = await seeded();
      expect((await reanalyse(ctx, 'nope')).statusCode).toBe(404);
      expect((await reanalyse(ctx, 'failed', 'res-x')).statusCode).toBe(404);
      expect((await reanalyse(ctx, 'bad.id')).statusCode).toBe(404);
    });
  });
});
