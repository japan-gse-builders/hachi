/** Operator-only Firestore seed. Existing documents, including edited demo records, are preserved. */
import type { Firestore } from 'firebase-admin/firestore';
import { membershipId } from '@hachi/store';
import { DEMO_SEED, type DemoData } from './demo.js';

export interface DemoDocument { path: string; data: Record<string, unknown> }

export function demoDocuments(data: DemoData): DemoDocument[] {
  const doc = (path: string, value: object): DemoDocument => ({ path, data: { ...value, demoSeed: DEMO_SEED } });
  return [
    ...data.organizations.map((o) => doc(`organizations/${o.id}`, o)),
    ...data.memberships.map((m) => doc(`memberships/${membershipId(m.orgId, m.uid)}`, m)),
    ...data.residents.map((r) => doc(`residents/${r.id}`, r)),
    ...data.calls.map((c) => doc(`residents/${c.residentId}/calls/${c.id}`, c)),
    ...data.cases.map((c) => doc(`cases/${c.id}`, c)),
  ];
}

/** Check every collision before preparing any writes. Never adopt an unrelated existing record. */
export function missingDemoDocuments(documents: DemoDocument[], existing: Map<string, Record<string, unknown>>): DemoDocument[] {
  for (const { path } of documents) {
    const stored = existing.get(path);
    if (stored && stored.demoSeed !== DEMO_SEED) throw new Error(`Refusing to seed: ${path} already exists without this demo's marker.`);
  }
  return documents.filter(({ path }) => !existing.has(path));
}

export async function seedDemoCompanies(db: Firestore, data: DemoData): Promise<{ created: number; preserved: number }> {
  const documents = demoDocuments(data);
  return db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...documents.map(({ path }) => db.doc(path)));
    const existing = new Map(snapshots.filter((s) => s.exists).map((s) => [s.ref.path, s.data()!]));
    const missing = missingDemoDocuments(documents, existing);
    for (const { path, data: value } of missing) tx.create(db.doc(path), value);
    return { created: missing.length, preserved: documents.length - missing.length };
  });
}
