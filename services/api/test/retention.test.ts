import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { call, makeResident, NOW, said, setup, storedCase, wellbeing } from './helpers.js';

const expiry = NOW.toISOString();
const startedAt = '2026-09-30T03:00:00Z';
const callPath = '/api/residents/res-1/calls/call-1';

async function seeded(recordings?: NonNullable<Parameters<typeof setup>[0]>['recordings']) {
  const clock = { now: new Date(NOW.getTime() - 5000) };
  const ctx = setup({ now: () => clock.now, ...(recordings ? { recordings } : {}) });
  const { app, as, store } = ctx;
  await store.createResident(makeResident('res-1'));
  await store.addCalls([call({ startedAt, wellbeing: wellbeing(said('food.ate_little')) })]);
  await store.putCase(storedCase());
  const set = (days: number, staff = 'admin') => app.inject({
    method: 'PATCH', url: '/api/organization', ...as(staff), payload: { callMediaRetentionDays: days },
  });
  expect((await set(1)).statusCode).toBe(200);
  return { ...ctx, set, clock };
}

describe('staff call media retention', () => {
  it('checks expiry on fresh reads before the cleanup worker runs', async () => {
    const open = vi.fn(async () => Readable.from(['fictional WAV']));
    const { app, as, clock, store } = await seeded({ open });
    const get = (url: string, staff = 'staff') => app.inject({ method: 'GET', url, ...as(staff) });
    expect((await get(callPath + '/recording', 'outsider')).statusCode).toBe(404);
    expect((await get(callPath + '/transcript', 'familyEmail')).statusCode).toBe(403);
    expect(open).not.toHaveBeenCalled();

    const recording = await get(callPath + '/recording');
    expect(recording.statusCode).toBe(200);
    expect(recording.headers['cache-control']).toBe('no-store');
    expect(recording.headers['content-type']).toContain('audio/wav');
    expect(recording.body).toBe('fictional WAV');
    expect((await get(callPath + '/transcript')).json().transcript).toHaveLength(2);
    const detail = (await get('/api/cases/case-1')).json();
    expect(detail.detections[0].evidence[0]).toMatchObject({ quote: 'I only had a biscuit', media: { expired: false, expiresAt: expiry }, recordingAvailable: true });

    clock.now = new Date(NOW.getTime() - 1);
    expect((await get(callPath + '/transcript')).statusCode).toBe(200);
    clock.now = NOW;
    for (const suffix of ['/transcript', '/recording']) {
      const res = await get(callPath + suffix);
      expect(res.statusCode).toBe(410);
      expect(res.json().reason).toBe('media_expired');
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect((await store.getCall('res-1', 'call-1'))?.transcript).toHaveLength(2);
    const expired = await get('/api/cases/case-1');
    expect(expired.body).not.toContain('I only had a biscuit');
    expect(expired.json().detections[0].evidence[0]).toMatchObject({ quote: '', recordingAvailable: false, media: { expired: true } });
    expect(expired.json().calls[0]).toMatchObject({ hasTranscript: false, media: { expired: true }, wellbeing: { tags: [{ quote: null }] } });
    const retry = await app.inject({ method: 'POST', url: callPath + '/reanalysis', ...as('staff') });
    expect(retry.statusCode).toBe(410);
    const changed = await app.inject({ method: 'PATCH', url: '/api/cases/case-1', ...as('staff'), payload: { status: 'in_progress' } });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).not.toContain('I only had a biscuit');
  });

  it('checks expiry again if the storage read takes the request past the deadline', async () => {
    const stream = Readable.from(['never delivered']);
    const open = vi.fn(async () => {
      clock.now = NOW;
      return stream;
    });
    const { app, as, clock } = await seeded({ open });
    const response = await app.inject({ method: 'GET', url: callPath + '/recording', ...as('staff') });
    expect(response.statusCode).toBe(410);
    expect(response.body).not.toContain('never delivered');
    expect(stream.destroyed).toBe(true);
  });

  it('only lets admins set retention, and keeps expired media closed if the period is extended', async () => {
    const { app, as, clock, set, store } = await seeded();
    expect((await set(100, 'otherStaff')).statusCode).toBe(403);
    expect((await set(0)).statusCode).toBe(400);
    expect((await set(1.5)).statusCode).toBe(400);
    expect((await store.getOrganization('org-2'))?.callMediaRetention).toBeUndefined();
    clock.now = NOW;
    expect((await set(90)).json().callMediaRetentionDays).toBe(90);
    const old = await app.inject({ method: 'GET', url: callPath + '/transcript', ...as('staff') });
    expect(old.statusCode).toBe(410);
    const org = await app.inject({ method: 'GET', url: '/api/organization', ...as('otherStaff') });
    expect(org.json().callMediaRetentionDays).toBe(90);
  });

  it('looks up the source date of excerpts beyond the case history window', async () => {
    const { app, as, clock, store } = await seeded();
    await store.addCalls(Array.from({ length: 121 }, (_, i) => call({
      id: `recent-${i}`, startedAt: '2026-10-01T01:00:00.000Z',
    })));
    const get = () => app.inject({ method: 'GET', url: '/api/cases/case-1', ...as('staff') });
    expect((await get()).json().detections[0].evidence[0]).toMatchObject({ quote: 'I only had a biscuit', media: { expired: false } });
    clock.now = NOW;
    expect((await get()).json().detections[0].evidence[0]).toMatchObject({ quote: '', media: { expired: true } });
  });

  it('keeps derived features from an expired backdated import without storing its transcript', async () => {
    const { app, as, store, clock } = await seeded();
    clock.now = NOW;
    const res = await app.inject({
      method: 'POST', url: '/api/residents/res-1/calls/import', ...as('staff'),
      payload: { calls: [{ startedAt: '2026-09-25T01:00:00.000Z', endedAt: '2026-09-25T01:04:00.000Z', transcript: call().transcript }] },
    });
    expect(res.statusCode).toBe(201);
    const imported = (await store.listCalls('res-1')).find((c) => c.source === 'imported')!;
    expect(imported).toMatchObject({ mediaExpiredAt: expect.any(String), speech: { features: expect.any(Object) } });
    expect(imported.transcript).toBeUndefined();
  });
});
