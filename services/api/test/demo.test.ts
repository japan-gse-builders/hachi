import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@hachi/store';
import { buildApp, ORG_HEADER } from '../src/app.js';
import { buildDemoData, DEMO_SEED } from '../src/demo.js';
import { demoDocuments, missingDemoDocuments } from '../src/demo-seed.js';

const NOW = new Date('2026-10-15T00:00:00Z'); // Some of today's call slots have not happened yet.

describe('fictional companies', () => {
  it('builds three independent teams with varied patient schedules and past call histories', () => {
    const data = buildDemoData(NOW);
    expect(data.organizations).toHaveLength(3);
    expect(data.memberships).toHaveLength(12);
    expect(data.residents).toHaveLength(15);
    expect(data.calls).toHaveLength(105);
    for (const org of data.organizations) {
      const team = data.memberships.filter((m) => m.orgId === org.id);
      const patients = data.residents.filter((r) => r.orgId === org.id);
      expect(team.map((m) => m.role)).toEqual(['owner', 'admin', 'member', 'member']);
      expect(patients).toHaveLength(5);
      expect(new Set(patients.map((r) => r.callTime)).size).toBe(5);
      for (const patient of patients) {
        expect(team.some((m) => m.uid === patient.owner?.uid)).toBe(true);
        expect(patient.staff.uid).toBe(patient.owner?.uid);
        const history = data.calls.filter((c) => c.residentId === patient.id);
        expect(history).toHaveLength(7);
        expect(history.every((c) => Date.parse(c.endedAt!) <= NOW.getTime())).toBe(true);
      }
    }
    expect(data.cases).toHaveLength(9);
    expect(data.cases.every((c) => data.residents.some((r) => r.id === c.residentId && r.orgId === c.orgId))).toBe(true);
    // Healthy patients have history without fabricated triage cases.
    expect(data.residents.filter((r) => !data.cases.some((c) => c.residentId === r.id))).toHaveLength(6);
    const paths = demoDocuments(data).map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps hosted demo records away from real people and outbound processing', () => {
    const data = buildDemoData(NOW);
    expect(data.organizations.every((o) => !o.verifiedAt)).toBe(true);
    expect(data.memberships.every((m) => m.email.endsWith('.example.invalid') && !m.phone && !m.sms)).toBe(true);
    expect(data.residents.every((r) => r.synthetic && !r.phone && !r.staff.phone && !r.family && !r.familyLookup.length)).toBe(true);
    expect(data.calls.every((c) => c.synthetic && c.source === 'imported' && !c.analysisPending && !c.audioUri)).toBe(true);
    expect(data.cases.every((c) => c.notifications.length === 0)).toBe(true);
  });

  it('gives an existing presenter access without replacing any original team member', () => {
    const data = buildDemoData(NOW, { uid: 'presenter', email: 'presenter@example.invalid' });
    expect(data.memberships.filter((m) => m.uid === 'presenter').map((m) => m.role)).toEqual(['admin', 'admin', 'admin']);
    expect(data.memberships.filter((m) => m.role === 'owner')).toHaveLength(3);
    const owner = buildDemoData(NOW, { uid: 'demo-sakura-1', email: 'aiko.tanaka@sakura.example.invalid' });
    expect(owner.memberships.filter((m) => m.uid === 'demo-sakura-1')).toHaveLength(3);
    expect(owner.memberships.find((m) => m.uid === 'demo-sakura-1' && m.orgId === 'demo-company-sakura')?.role).toBe('owner');
  });

  it('preserves edited demo schedules on repeat seeds and refuses collisions with unrelated records', () => {
    const documents = demoDocuments(buildDemoData(NOW));
    const path = 'residents/demo-sakura-patient-1';
    const existing = new Map([[path, { demoSeed: DEMO_SEED, callTime: '16:45' }]]);
    const missing = missingDemoDocuments(documents, existing);
    expect(missing).toHaveLength(documents.length - 1);
    expect(missing.some((d) => d.path === path)).toBe(false);
    expect(existing.get(path)?.callTime).toBe('16:45');
    expect(missingDemoDocuments(documents, new Map(documents.map((d) => [d.path, d.data])))).toEqual([]);
    expect(() => missingDemoDocuments(documents, new Map([[path, { name: 'Existing patient' }]]))).toThrow('Refusing to seed');
  });

  it('keeps company data separate and lets assigned staff save only their own patients’ schedules', async () => {
    const data = buildDemoData(NOW);
    const store = new MemoryStore();
    store.seedAccounts(data);
    for (const r of data.residents) await store.createResident(r);
    const app = buildApp({ store, now: () => NOW, signer: { sign: async () => '' }, verifier: {
      verify: async (uid) => {
        const member = data.memberships.find((m) => m.uid === uid);
        if (!member) throw new Error('Unknown demo user');
        return { uid, email: member.email, emailVerified: true };
      },
    } });
    const headers = { authorization: 'Bearer demo-sakura-3', [ORG_HEADER]: 'demo-company-sakura' };
    try {
      const list = await app.inject({ method: 'GET', url: '/api/residents', headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().residents.map((r: { orgId: string }) => r.orgId)).toEqual(Array(5).fill('demo-company-sakura'));
      const url = '/api/residents/demo-sakura-patient-3';
      const saved = await app.inject({ method: 'PATCH', url, headers, payload: { callTime: '16:45' } });
      expect(saved.statusCode).toBe(200);
      expect((await store.getResident('demo-sakura-patient-3'))?.callTime).toBe('16:45');
      expect((await store.getResident('demo-sakura-patient-1'))?.callTime).toBe('08:30');
      const forbidden = await app.inject({ method: 'PATCH', url: '/api/residents/demo-sakura-patient-1', headers, payload: { callTime: '16:45' } });
      expect(forbidden.statusCode).toBe(403);
      const otherCompany = await app.inject({ method: 'GET', url: '/api/residents', headers: { ...headers, [ORG_HEADER]: 'demo-company-midori' } });
      expect(otherCompany.statusCode).toBe(403);
      const invalid = await app.inject({ method: 'PATCH', url, headers, payload: { callTime: '24:00' } });
      expect(invalid.statusCode).toBe(400);
      expect((await store.getResident('demo-sakura-patient-3'))?.callTime).toBe('16:45');
    } finally { await app.close(); }
  });
});
