import type { ItemAnswer } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { call, makeResident, NOW, setup, storedCase } from './helpers.js';

/** NOW is 2026-10-01 in Tokyo, which is the date every answer below is dated to. */
const TODAY = '2026-10-01';

const answer = (itemId: string, option: number, date = TODAY): ItemAnswer => ({ date, itemId, option });

async function withAnswers(answers: ItemAnswer[], residentOverrides: Record<string, unknown> = {}) {
  const s = setup();
  await s.store.createResident(makeResident('res-1', residentOverrides));
  await s.store.putCase(storedCase());
  await s.store.addCalls([
    call({
      analysis: { at: NOW.toISOString(), turns: 2, intake: { date: TODAY, status: 'normal' }, memory: { topics: [], plans: [], likes: [] }, answers },
    }),
  ]);
  const res = await s.app.inject({ method: 'GET', url: '/api/cases/case-1', ...s.as('staff') });
  return { ...s, screening: res.json().screening };
}

const domain = (screening: { domains: { domain: string }[] }, name: string) => screening.domains.find((d) => d.domain === name)!;

describe('what the set questions add up to, for staff', () => {
  it('shows a denominator for every domain, and refuses to call an empty one clean', async () => {
    const { screening } = await withAnswers([]);
    expect(domain(screening, 'oral')).toMatchObject({ label: 'Eating and swallowing', answered: 0, of: 3, flagged: 0, meets: null });
    expect(screening.overall).toMatchObject({ answered: 0, of: 20, flagged: 0, meets: null });
  });

  it('rules a domain out once too few items are left to reach its own threshold', async () => {
    const answers = [answer('kcl.chewing', 1), answer('kcl.choking', 1)];
    expect(domain((await withAnswers(answers)).screening, 'oral')).toMatchObject({ answered: 2, flagged: 0, meets: false });
  });

  it('names the item it cannot ask over the phone instead of quietly dropping it', async () => {
    const { screening } = await withAnswers([answer('kcl.weight_loss', 0)]);
    // Item 12 of the Kihon Checklist is a body-mass index, which no telephone call can produce.
    expect(domain(screening, 'nutrition')).toMatchObject({ answered: 1, of: 2, flagged: 1, missing: [12] });
  });

  it('leaves a domain unsettled when the answers could still go either way', async () => {
    const { screening } = await withAnswers([answer('kcl.chewing', 0)]);
    expect(domain(screening, 'oral')).toMatchObject({ answered: 1, flagged: 1, meets: null });
  });

  it('settles a domain as met once enough of its items are flagged', async () => {
    const { screening } = await withAnswers([answer('kcl.chewing', 0), answer('kcl.choking', 0)]);
    expect(domain(screening, 'oral')).toMatchObject({ flagged: 2, meets: true });
  });

  it('reports an instrument as unreadable until all of its items are answered', async () => {
    const { screening } = await withAnswers([answer('phq2.down', 3)]);
    const phq = screening.instruments.find((i: { instrument: string }) => i.instrument === 'PHQ-2');
    expect(phq).toMatchObject({ score: 3, answered: 1, of: 2, positive: null });
  });

  it('reports an instrument against its own published cutoff once it is complete', async () => {
    const { screening } = await withAnswers([answer('phq2.down', 3), answer('phq2.interest', 0)]);
    const phq = screening.instruments.find((i: { instrument: string }) => i.instrument === 'PHQ-2');
    expect(phq).toMatchObject({ score: 3, answered: 2, of: 2, positive: true });
  });

  it('says plainly whether the family may be told how the resident is in themselves', async () => {
    const { screening } = await withAnswers([]);
    expect(screening.shareMood).toBe(false);
    expect(screening.loneliness.status).toBe('incomplete');
  });
});

describe('recording what the resident agreed to', () => {
  it('keeps who heard it and when, not just the answer', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const res = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { shareMood: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().consent).toEqual({ shareMood: true, recordedAt: NOW.toISOString(), recordedBy: 'staff-1' });
  });

  it('can be taken back, and the withdrawal is recorded the same way', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { shareMood: true } });
    await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { shareMood: false } });
    expect((await store.getResident('res-1'))!.consent).toMatchObject({ shareMood: false, recordedBy: 'staff-1' });
  });

  it('leaves consent alone when a patch is about something else', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { shareMood: true } });
    await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callTime: '11:00' } });
    expect((await store.getResident('res-1'))!.consent?.shareMood).toBe(true);
  });

  it('is not something family can set for the resident', async () => {
    const { app, as, store } = setup();
    await store.createResident(makeResident('res-1'));
    const res = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('familyPhone'), payload: { shareMood: true } });
    expect(res.statusCode).toBe(403);
    expect((await store.getResident('res-1'))!.consent).toBeUndefined();
  });
});
