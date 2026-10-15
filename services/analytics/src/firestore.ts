import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import type { CallRecord } from '@hachi/store';
import type { CallSnapshot } from './events.js';
import type { AnalyticsSource, Cursor, Published } from './worker.js';

const FIELDS = ['id', 'residentId', 'source', 'synthetic', 'status', 'channel', 'startedAt', 'endedAt',
  'durationSec', 'trigger', 'attempt', 'analysisPending', 'analysis.at', 'analysis.incomplete',
  'analysis.error', 'analysis.voiceError', 'conversation.noResponseEscalated', 'emergency.at'];

/** Cross-resident pagination includes paused patients; only the configured organizations export. */
export class FirestoreAnalyticsSource implements AnalyticsSource {
  constructor(private readonly db: Firestore, private readonly stream: string) {}
  private state() { return this.db.collection('analyticsState').doc(this.stream); }
  private receipt(key: string) { return this.state().collection('published').doc(key); }
  async cursor(): Promise<Cursor | null> {
    return (await this.state().get()).data()?.cursor as Cursor | null ?? null;
  }
  async saveCursor(cursor: Cursor | null) { await this.state().set({ cursor }, { merge: true }); }
  async published(key: string): Promise<Published | null> {
    return (await this.receipt(key).get()).data() as Published | undefined ?? null;
  }
  async markPublished(key: string, value: Published) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.receipt(key);
      const previous = (await tx.get(ref)).data() as Published | undefined;
      if (!previous || previous.revision <= value.revision) tx.set(ref, value);
    });
  }
  async page(since: string, cursor: Cursor | null, limit: number) {
    let query = this.db.collectionGroup('calls').where('startedAt', '>=', since)
      .orderBy('startedAt').orderBy(FieldPath.documentId()).select(...FIELDS).limit(limit);
    if (cursor) query = query.startAfter(cursor.startedAt, this.db.doc(cursor.path));
    const page = await query.get();
    const calls = page.docs.filter((d) => /^residents\/[^/]+\/calls\/[^/]+$/.test(d.ref.path));
    const refs = [...new Map(calls.map((d) => [d.ref.parent.parent!.path, d.ref.parent.parent!])).values()];
    const residents = refs.length ? await this.db.getAll(...refs, { fieldMask: ['orgId', 'synthetic'] }) : [];
    const byPath = new Map(residents.map((r) => [r.ref.path, r.data()]));
    const snapshots: CallSnapshot[] = [];
    for (const doc of calls) {
      const resident = byPath.get(doc.ref.parent.parent!.path);
      if (!resident?.orgId) continue;
      const call = doc.data() as CallRecord;
      snapshots.push({ call: { ...call, id: doc.id, residentId: doc.ref.parent.parent!.id },
        orgId: resident.orgId as string, synthetic: resident.synthetic === true,
        revision: `${String(doc.updateTime.seconds).padStart(12, '0')}.${String(doc.updateTime.nanoseconds).padStart(9, '0')}`,
        updatedAt: doc.updateTime.toDate().toISOString() });
    }
    const last = page.docs.at(-1);
    return { snapshots, next: page.size === limit && last ? { startedAt: last.get('startedAt') as string, path: last.ref.path } : null };
  }
}
