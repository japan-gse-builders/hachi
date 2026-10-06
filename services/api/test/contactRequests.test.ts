import type { ContactRequest } from '@hachi/core';
import { recordContactRequest, type OutboxEntry } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { groupNumber } from '../src/contactRequests.js';
import { makeResident, NOW, setup } from './helpers.js';

const asked = (over: Partial<ContactRequest> = {}): ContactRequest => ({
  who: 'my neighbour Susan',
  number: '+819011112222',
  confirmed: true,
  turn: 3,
  ...over,
});

async function held(request: Partial<ContactRequest> = {}) {
  const s = setup();
  const resident = makeResident('res-1');
  await s.store.createResident(resident);
  const entry = (await recordContactRequest(s.store, resident, 'call-1', asked(request), NOW))!;
  return { ...s, entry };
}

const decide = (app: ReturnType<typeof setup>['app'], id: string, token: string, decision: string) =>
  app.inject({ method: 'POST', url: `/api/contact-requests/${id}`, headers: { authorization: `Bearer ${token}` }, payload: { decision } });

describe('groupNumber', () => {
  it('groups a Japanese number the way it is read aloud', () => {
    expect(groupNumber('+819012345678')).toBe('+81 90 1234 5678');
  });

  it('leaves a number of another shape readable rather than wrong', () => {
    expect(groupNumber('+447700900123')).toBe('+4477 0090 0123');
  });
});

describe('contact requests the resident made by phone (NTF-05)', () => {
  it('shows staff what would be sent, to whom, and for whom', async () => {
    const { app, as, entry } = await held();
    const res = await app.inject({ method: 'GET', url: '/api/contact-requests', ...as('staff') });
    expect(res.statusCode).toBe(200);
    expect(res.json().requests).toEqual([
      {
        id: entry.id,
        residentId: 'res-1',
        residentName: 'Margaret Smith',
        requestedFor: 'my neighbour Susan',
        number: '+81 90 1111 2222',
        body: entry.body,
        requestedAt: NOW.toISOString(),
      },
    ]);
  });

  it('shows the resident\u2019s own family the request too, since they often know the number', async () => {
    const { app, as } = await held();
    const res = await app.inject({ method: 'GET', url: '/api/contact-requests', ...as('familyPhone') });
    expect(res.json().requests).toHaveLength(1);
  });

  it('shows nothing to someone who is not connected to the resident', async () => {
    const { app, as } = await held();
    const res = await app.inject({ method: 'GET', url: '/api/contact-requests', ...as('stranger') });
    expect(res.statusCode).toBe(200);
    expect(res.json().requests).toEqual([]);
  });

  it('queues the message once staff agree to it', async () => {
    const { app, store, entry } = await held();
    const res = await decide(app, entry.id, 'staff', 'approve');
    expect(res.json()).toEqual({ outcome: 'approved' });
    const after = (await store.getOutbox(entry.id))!;
    expect(after.status).toBe('pending');
    expect(after.approval).toEqual({ by: 'staff', uid: 'staff-1', at: NOW.toISOString(), decision: 'approved' });
  });

  it('lets the resident\u2019s family agree to it as well', async () => {
    const { app, store, entry } = await held();
    await decide(app, entry.id, 'familyEmail', 'approve');
    const after = (await store.getOutbox(entry.id))!;
    expect(after.status).toBe('pending');
    expect(after.approval?.by).toBe('family');
  });

  it('never sends a rejected message, and keeps who said no', async () => {
    const { app, store, entry } = await held();
    expect((await decide(app, entry.id, 'staff', 'reject')).json()).toEqual({ outcome: 'rejected' });
    const after = (await store.getOutbox(entry.id))!;
    expect(after.status).toBe('rejected');
    expect(after.approval?.decision).toBe('rejected');
  });

  it('keeps the first decision when a second one arrives', async () => {
    const { app, store, entry } = await held();
    await decide(app, entry.id, 'staff', 'reject');
    expect((await decide(app, entry.id, 'familyPhone', 'approve')).json()).toEqual({ outcome: 'already_decided' });
    expect((await store.getOutbox(entry.id))!.status).toBe('rejected');
  });

  it('will not let a stranger release a message about someone else\u2019s relative, and says no more than "not found"', async () => {
    const { app, as, store, entry } = await held();
    const notTheirs = await decide(app, entry.id, 'stranger', 'approve');
    const missing = await app.inject({ method: 'POST', url: '/api/contact-requests/none', ...as('staff'), payload: { decision: 'approve' } });
    expect(notTheirs.statusCode).toBe(404);
    expect(notTheirs.json()).toEqual(missing.json());
    expect((await store.getOutbox(entry.id))!.status).toBe('awaiting_approval');
  });

  it('refuses a decision it does not understand', async () => {
    const { app, entry } = await held();
    expect((await decide(app, entry.id, 'staff', 'maybe')).statusCode).toBe(400);
  });

  it('does not hold up a message to the family contact we already hold', async () => {
    const { store, entry } = await held({ who: 'my daughter Alice', number: undefined, confirmed: false });
    expect(entry.status).toBe('pending');
    expect(entry.recipient).toBe('family');
    const listed = await store.listOutboxAwaitingApproval(10);
    expect(listed).toEqual([]);
  });

  it('does not offer an alert for approval, only a contact request', async () => {
    const { app, as, store, entry } = await held();
    const alert: OutboxEntry = { ...entry, id: 'alert-1', kind: undefined, status: 'awaiting_approval' };
    await store.enqueueOutbox([alert]);
    const res = await app.inject({ method: 'GET', url: '/api/contact-requests', ...as('staff') });
    expect(res.json().requests.map((r: { id: string }) => r.id)).toEqual([entry.id]);
    expect((await decide(app, 'alert-1', 'staff', 'approve')).statusCode).toBe(404);
  });
});
