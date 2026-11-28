import { hasCallConsent, PRIVACY_NOTICE } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { call, FakeVerifier, makeResident, NOW, residentInput, setup, wellbeing } from './helpers.js';

const answer = { accepted: true, noticeVersion: PRIVACY_NOTICE.version };

describe('independent consent withdrawal', () => {
  it('stops call approval and records who withdrew it while family sharing still works', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([call()]);
    const withdraw = (who: string) => app.inject({
      method: 'PATCH', url: '/api/residents/res-1', ...as(who), payload: { withdrawCallConsent: true },
    });
    expect((await withdraw('otherStaff')).statusCode).toBe(403);
    expect((await withdraw('outsider')).statusCode).toBe(404);
    const saved = (await withdraw('admin')).json();
    expect(saved.callConsent).toMatchObject({
      accepted: false, recordedBy: 'staff-1',
      lastWithdrawal: { by: 'staff-3', name: 'Ito', at: NOW.toISOString(), revision: 1 },
    });
    expect(saved.consent).toMatchObject({ shareMood: true });
    expect(await store.listAudit('org-1', { limit: 1 })).toEqual([
      expect.objectContaining({ actor: expect.objectContaining({ uid: 'staff-3' }), at: NOW.toISOString(), detail: expect.objectContaining({ withdrawal: 'calls' }) }),
    ]);
    const dashboard = (await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyEmail') })).json();
    expect(dashboard.nextCallAt).toBeNull();
    expect(dashboard.calls[0].summary).toMatchObject({ health: 'A little tired' });
    expect((await withdraw('staff')).json().callConsent).toEqual(saved.callConsent);
    const approve = (payload: object) => app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload });
    expect((await approve({ callConsent: answer })).statusCode).toBe(409);
    expect((await approve({ callConsent: { ...answer, revision: 1 } })).json().callConsent).toMatchObject({
      accepted: true, lastWithdrawal: saved.callConsent.lastWithdrawal,
    });
    expect((await withdraw('admin')).statusCode).toBe(409);
    expect((await approve({ withdrawCallConsent: true, callConsentRevision: 1 })).json().callConsent).toMatchObject({
      accepted: false, lastWithdrawal: { revision: 2 },
    });
  });

  it('withholds historic summaries, generated headlines and mood without stopping calls', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await store.addCalls([call({ wellbeing: wellbeing([{ id: 'mood.lonely', turn: 1, basis: 'said', confidence: 0.99 }], 'Private headline') })]);
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload });
    const saved = (await patch({ shareMood: false })).json();
    expect(saved.consent).toMatchObject({ shareMood: false, lastWithdrawal: { by: 'staff-1', at: NOW.toISOString(), revision: 1 } });
    expect(saved.callConsent.accepted).toBe(true);
    const response = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyEmail') });
    expect(response.json()).toMatchObject({ nextCallAt: expect.any(String), glance: { shareMood: false, latest: { headline: null, domains: { mood: 'unmentioned' } } } });
    expect(response.json().calls[0]).toMatchObject({ connected: true, summary: null, headline: null, tags: [] });
    expect(response.body).not.toContain('Private headline');
    expect((await patch({ shareMood: true })).statusCode).toBe(409);
    expect((await patch({ shareMood: true, familySharingRevision: 1 })).json().consent).toMatchObject({
      shareMood: true, lastWithdrawal: saved.consent.lastWithdrawal,
    });
  });

  it('preserves a family withdrawal through fresh call approval', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload });
    expect((await patch({ callConsent: answer, withdrawCallConsent: true })).statusCode).toBe(400);
    await patch({ shareMood: false });
    await patch({ withdrawCallConsent: true });
    const res = await patch({ callConsent: { ...answer, revision: 1 } });
    expect(res.json()).toMatchObject({ callConsent: { accepted: true }, consent: { shareMood: false } });
  });
});

describe('privacy notice and first-use approval', () => {
  it('serves the shared notice without signing in, while resident data stays protected', async () => {
    const { app } = setup();
    const notice = await app.inject({ method: 'GET', url: '/privacy-notice' });
    expect(notice.statusCode).toBe(200);
    expect(notice.json()).toEqual(PRIVACY_NOTICE);
    expect((await app.inject({ method: 'GET', url: '/api/residents' })).statusCode).toBe(401);
  });

  it('saves a resident while approval is pending, without implying consent', async () => {
    const { app, as, store } = setup();
    const response = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() });
    expect(response.statusCode).toBe(201);
    expect(response.json().callConsent).toBeUndefined();
    expect(response.json().consent).toBeUndefined();
    expect(hasCallConsent((await store.getResident(response.json().id))?.callConsent)).toBe(false);
  });

  it('records who heard the answer and when, using the server identity and clock', async () => {
    const { app, as, store } = setup();
    const response = await app.inject({
      method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput({ callConsent: answer }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().callConsent).toEqual({ ...answer, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
    expect(response.json().consent).toEqual({ shareMood: true, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
    expect(hasCallConsent((await store.getResident(response.json().id))?.callConsent)).toBe(true);
  });

  it('starts a new resident’s baseline and screening rotation at approval, even weeks after saving details', async () => {
    const { store, as } = setup();
    const clock = { now: NOW };
    const app = buildApp({ store, verifier: new FakeVerifier(), now: () => clock.now, newId: () => 'res-1' });
    const pending = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput() });
    expect(pending.json().serviceStartPending).toBe(true);
    clock.now = new Date(NOW.getTime() + 40 * 86_400_000);
    const approved = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer } });
    expect(approved.json().serviceStartedAt).toBe(clock.now.toISOString());
    expect(approved.json().serviceStartPending).toBeUndefined();
    clock.now = new Date(clock.now.getTime() + 86_400_000);
    const resubmitted = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer } });
    expect(resubmitted.json().serviceStartedAt).toBe(approved.json().serviceStartedAt);
  });

  it('preserves the service start for existing residents and explicitly dated historical imports', async () => {
    const { app, as, store } = setup();
    const date = '2026-09-01T00:00:00.000Z';
    await store.createResident(makeResident('res-1', { callConsent: undefined, serviceStartedAt: date }));
    const approved = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().serviceStartedAt).toBe(date);
  });

  it.each([
    { ...answer, accepted: false },
    { ...answer, noticeVersion: 'old-notice' },
    { ...answer, recordedBy: 'someone-else' },
    { ...answer, recordedAt: '2020-01-01T00:00:00.000Z' },
    { noticeVersion: PRIVACY_NOTICE.version },
    null,
  ])('rejects invalid or forged approvals on create and update: %j', async (callConsent) => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', { callConsent: undefined }));
    const create = await app.inject({ method: 'POST', url: '/api/residents', ...as('staff'), payload: residentInput({ callConsent }) });
    const patch = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent } });
    expect(create.statusCode).toBe(400);
    expect(patch.statusCode).toBe(400);
    expect((await store.getResident('res-1'))?.callConsent).toBeUndefined();
  });

  it('lets only staff record a pending resident’s approval', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', { callConsent: undefined }));
    const request = { method: 'PATCH' as const, url: '/api/residents/res-1', payload: { callConsent: answer } };
    expect((await app.inject({ ...request, ...as('familyEmail') })).statusCode).toBe(403);
    const saved = await app.inject({ ...request, ...as('staff') });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().callConsent).toEqual({ ...answer, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
    expect(saved.json().consent).toEqual({ shareMood: true, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
  });

  it.each([undefined, { shareMood: false, recordedAt: '2026-10-01T00:00:00.000Z', recordedBy: 'original-staff' }])(
    'does not expand an existing call approval or its family sharing on resubmission: %j', async (consent) => {
      const { app, as, store } = setup();
      const original = { ...answer, noticeVersion: '2026-10-09.1', recordedAt: '2026-10-01T00:00:00.000Z', recordedBy: 'original-staff' };
      await store.createResident({ ...makeResident('res-1'), callConsent: original, consent });
      const saved = await app.inject({
        method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().callConsent).toEqual(original);
      expect(saved.json().consent).toEqual(consent);
    },
  );

  it('preserves an earlier sharing opt-out when first call approval is recorded', async () => {
    const { app, as, store } = setup();
    const consent = { shareMood: false, recordedAt: '2026-10-01T00:00:00.000Z', recordedBy: 'original-staff' };
    await store.createResident({ ...makeResident('res-1', { callConsent: undefined }), consent });
    const saved = await app.inject({
      method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().callConsent).toEqual({ ...answer, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
    expect(saved.json().consent).toEqual(consent);
  });

  it('honours an explicit sharing opt-out in the same request as first call approval', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', { callConsent: undefined }));
    const saved = await app.inject({
      method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callConsent: answer, shareMood: false },
    });
    expect(saved.statusCode).toBe(200);
    expect(hasCallConsent(saved.json().callConsent)).toBe(true);
    expect(saved.json().consent).toEqual({ shareMood: false, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
  });

  it('preserves the original approval through later updates, mood sharing and resubmissions', async () => {
    const { app, as, store } = setup();
    const original = { ...answer, noticeVersion: '2026-10-01', recordedAt: '2026-10-01T00:00:00.000Z', recordedBy: 'original-staff' };
    await store.createResident({ ...makeResident('res-1'), callConsent: original });
    const updated = await app.inject({
      method: 'PATCH', url: '/api/residents/res-1', ...as('staff'),
      payload: { callConsent: answer, shareMood: true, callTime: '11:00' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().callConsent).toEqual(original);
    expect(updated.json().consent).toMatchObject({ shareMood: true, recordedBy: 'staff-1' });
    expect(hasCallConsent(updated.json().callConsent)).toBe(true);
  });

  it('shows no next call or missed-check-in warning for a pending resident', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1', { callConsent: undefined }));
    const dashboard = await app.inject({ method: 'GET', url: '/api/family/residents/res-1/dashboard', ...as('familyEmail') });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().nextCallAt).toBeNull();
    const queue = await app.inject({ method: 'GET', url: '/api/queue', ...as('staff') });
    expect(queue.json().unreached.items).toEqual([]);
  });
});
