import { expect, it } from 'vitest';
import { dispatchDueCalls } from '../../telephony/src/calls.js';
import { makeDeps } from '../../telephony/test/fixtures.js';
import { makeResident, setup } from './helpers.js';

it('uses a saved per-patient time on the next scheduler scan without changing other patients or queuing twice', async () => {
  const { app, store, as } = setup();
  const { deps, queue, clock } = makeDeps();
  deps.store = store;
  await store.createResident(makeResident('res-1'));
  await store.createResident(makeResident('res-2'));
  try {
    const response = await app.inject({ method: 'PATCH', url: '/api/residents/res-1', ...as('staff'), payload: { callTime: '14:30' } });
    expect(response.statusCode).toBe(200);
    // Original 10:00 slot now belongs to res-2 only.
    expect(await dispatchDueCalls(deps)).toMatchObject({ enqueued: 1 });
    expect(queue.tasks.map((t) => t.body)).toEqual([{ residentId: 'res-2', localDate: '2026-10-02', attempt: 0 }]);
    clock.now = new Date('2026-10-02T05:30:30Z'); // 14:30 JST
    expect(await dispatchDueCalls(deps)).toMatchObject({ enqueued: 1 });
    expect(queue.tasks.at(-1)?.body).toEqual({ residentId: 'res-1', localDate: '2026-10-02', attempt: 0 });
    expect(await dispatchDueCalls(deps)).toMatchObject({ enqueued: 0, alreadyQueued: 1 });
    expect(queue.tasks).toHaveLength(2);
  } finally { await app.close(); }
});
