import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { FirestoreAnalyticsSource } from '../src/firestore.js';
import { call } from './fixtures.js';

function fixture() {
  const residentRef = { path: 'residents/r-1', id: 'r-1' };
  const doc = { id: 'c-1', ref: { path: 'residents/r-1/calls/c-1', parent: { parent: residentRef } },
    data: () => call({ id: 'untrusted', residentId: 'untrusted' }), get: () => call().startedAt,
    updateTime: { seconds: 1792032000, nanoseconds: 1, toDate: () => new Date('2026-10-15T02:00:00Z') } };
  const query = { where: vi.fn(), orderBy: vi.fn(), select: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: [doc], size: 1 }) };
  for (const method of ['where', 'orderBy', 'select', 'limit', 'startAfter'] as const) query[method].mockReturnValue(query);
  const state = { get: vi.fn().mockResolvedValue({ data: () => undefined }), set: vi.fn(), collection: vi.fn(), doc: vi.fn() };
  state.collection.mockReturnValue(state); state.doc.mockReturnValue(state);
  const tx = { get: vi.fn().mockResolvedValue({ data: () => undefined }), set: vi.fn() };
  const db = { collectionGroup: vi.fn().mockReturnValue(query), collection: vi.fn().mockReturnValue(state),
    doc: vi.fn((path: string) => ({ path })), runTransaction: vi.fn(async (fn) => fn(tx)),
    getAll: vi.fn().mockResolvedValue([{ ref: residentRef, data: () => ({ orgId: 'org-1', synthetic: true, active: false }) }]) };
  const source = new FirestoreAnalyticsSource(db as unknown as Firestore, 'test-topic');
  return { source, db, query, state, tx, doc };
}

describe('Firestore analytics boundary', () => {
  it('paginates by time and document path; includes paused patients and projects only needed fields', async () => {
    const { source, db, query } = fixture();
    const since = '2026-10-01T00:00:00.000Z';
    const first = await source.page(since, null, 1);
    expect(first.snapshots[0]).toMatchObject({ orgId: 'org-1', synthetic: true,
      call: { id: 'c-1', residentId: 'r-1' }, revision: '001792032000.000000001' });
    expect(db.collectionGroup).toHaveBeenCalledWith('calls');
    expect(query.where).toHaveBeenCalledExactlyOnceWith('startedAt', '>=', since);
    expect(query.orderBy).toHaveBeenCalledWith(FieldPath.documentId());
    const selected = query.select.mock.calls[0]!;
    for (const field of ['transcript', 'summary', 'audioUri', 'streamToken', 'emergency']) expect(selected).not.toContain(field);
    expect(db.getAll.mock.calls[0]?.at(-1)).toEqual({ fieldMask: ['orgId', 'synthetic'] });
    expect(first.next).toEqual({ startedAt: call().startedAt, path: 'residents/r-1/calls/c-1' });
    await source.page(since, first.next, 2);
    expect(query.startAfter).toHaveBeenCalledWith(call().startedAt, { path: 'residents/r-1/calls/c-1' });
  });
  it('skips deleted/unowned residents and unrelated collections without losing scan progress', async () => {
    const { source, db, query, doc } = fixture();
    db.getAll.mockResolvedValueOnce([{ ref: { path: 'residents/r-1' }, data: () => undefined }]);
    expect((await source.page('2026-10-01', null, 1)).snapshots).toHaveLength(0);
    query.get.mockResolvedValueOnce({ docs: [{ ...doc, ref: { path: 'other/o/calls/c', parent: { parent: { path: 'other/o' } } } }], size: 1 });
    const unrelated = await source.page('2026-10-01', null, 1);
    expect(unrelated.snapshots).toHaveLength(0);
    expect(unrelated.next?.path).toBe('other/o/calls/c');
    expect(db.getAll).toHaveBeenCalledTimes(1);
    query.get.mockResolvedValueOnce({ docs: [], size: 0 });
    expect((await source.page('2026-10-01', null, 1)).next).toBeNull();
  });
  it('stores receipts outside care records and prevents older workers from overwriting them', async () => {
    const { source, state, tx, db } = fixture();
    const newest = { fingerprint: 'new', revision: '001792032000.000000002' };
    expect(await source.cursor()).toBeNull();
    expect(await source.published('key')).toBeNull();
    await source.markPublished('key', newest);
    expect(tx.set).toHaveBeenCalledWith(state, newest);
    tx.set.mockClear();
    tx.get.mockResolvedValueOnce({ data: () => newest });
    await source.markPublished('key', { fingerprint: 'old', revision: '001792032000.000000001' });
    expect(tx.set).not.toHaveBeenCalled();
    await source.saveCursor(null);
    expect(state.set).toHaveBeenCalledWith({ cursor: null }, { merge: true });
    expect(db.collection.mock.calls.every(([collection]) => collection === 'analyticsState')).toBe(true);
  });
});
