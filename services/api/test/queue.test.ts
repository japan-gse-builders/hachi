import { describe, expect, it } from 'vitest';
import { makeResident, setup, storedCase } from './helpers.js';

describe('issue #17: queue overview and person context', () => {
  it('counts open cases, includes closed cases only on request, and retains open priority', async () => {
    const { app, as, store } = setup();
    await store.createResident({ ...makeResident('res-1', { householdNotes: 'Neighbour visits weekly' }), synthetic: true });
    await store.createResident(makeResident('res-2', { active: false }));
    for (const c of [storedCase({ id: 'monitor', autoUrgency: 'watch' }), storedCase({ id: 'attention', rule: 'R1', autoUrgency: 'emergency' }), storedCase({ id: 'closed', status: 'closed', rule: 'R3', autoUrgency: 'emergency' })]) await store.putCase(c);
    const open = (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json();
    expect(open.summary).toEqual({ needsAttention: 1, monitor: 1, residents: 2 });
    expect(open.items.map((i: { caseId: string }) => i.caseId)).toEqual(['attention', 'monitor']);
    expect(open.items[0]).toMatchObject({ householdNotes: 'Neighbour visits weekly', synthetic: true });
    expect(open.items[0].residentFacts).toContain('Lives alone');
    const closed = (await app.inject({ method: 'GET', url: '/api/queue?locale=en&includeClosed=true', ...as('staff') })).json();
    expect(closed.items).toHaveLength(3);
    expect(closed.summary).toEqual(open.summary);
    expect(closed.items.filter((i: { status: string }) => i.status !== 'closed')).toEqual(open.items);
    const detail = (await app.inject({ method: 'GET', url: '/api/cases/attention?locale=en', ...as('staff') })).json();
    expect(detail.resident.staff).toMatchObject({ name: 'Tanaka', phone: '+81300000000' });
    expect(detail.resident.synthetic).toBe(true);
  });

  it('reports zero attention positively and keeps closed-query access staff-only', async () => {
    const { app, as } = setup();
    const empty = (await app.inject({ method: 'GET', url: '/api/queue?locale=en', ...as('staff') })).json();
    expect(empty.summary).toEqual({ needsAttention: 0, monitor: 0, residents: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/queue?includeClosed=yes', ...as('staff') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/queue?includeClosed=true', ...as('familyPhone') })).statusCode).toBe(403);
  });
});
