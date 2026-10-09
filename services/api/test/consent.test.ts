import { hasCallConsent, PRIVACY_NOTICE } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeSigner, FakeVerifier, makeResident, NOW, residentInput, setup } from './helpers.js';

const answer = { accepted: true, noticeVersion: PRIVACY_NOTICE.version };

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
    const app = buildApp({ store, verifier: new FakeVerifier(), signer: fakeSigner, now: () => clock.now, newId: () => 'res-1' });
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
