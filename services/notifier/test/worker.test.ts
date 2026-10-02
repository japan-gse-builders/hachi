import { describe, expect, it, vi } from 'vitest';
import { DeliveryError } from '../src/channels.js';
import { deliver, parseSendInput, sweep } from '../src/worker.js';
import { entry, FakeSender, NOW, permanent, retryable, setup } from './fixtures.js';

const e = entry();

describe('parseSendInput', () => {
  it('accepts only a SHA-256 outbox id', () => {
    expect(parseSendInput({ outboxId: e.id })).toBe(e.id);
    expect(parseSendInput({ outboxId: '../etc' })).toBeNull();
    expect(parseSendInput({ outboxId: 5 })).toBeNull();
    expect(parseSendInput(null)).toBeNull();
  });
});

describe('deliver', () => {
  it('sends, marks the entry sent and records it on the case (NTF-04)', async () => {
    const { store, sms, deps } = await setup();
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'sent', providerId: 'P1' });
    expect(sms.sent.map((s) => s.address)).toEqual(['+819000000002']);

    const saved = (await store.getOutbox(e.id))!;
    expect(saved).toMatchObject({ status: 'sent', attempts: 1, sentAt: NOW.toISOString(), providerId: 'P1' });
    expect(saved.leaseUntil).toBeUndefined();
    expect((await store.getCase('case-1'))!.notifications).toEqual([
      { recipient: 'family', channel: 'sms', address: '+819000000002', sentAt: NOW.toISOString() },
    ]);
  });

  it('never sends a finished entry again', async () => {
    const { store, sms, deps } = await setup();
    await deliver(deps, e.id);
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'done', status: 'sent' });
    expect(sms.sent).toHaveLength(1);
    expect((await store.getCase('case-1'))!.notifications).toHaveLength(1);
  });

  it('repairs the case record when it was not written the first time', async () => {
    const { store, deps } = await setup();
    const mutate = vi.spyOn(store, 'mutateCase').mockRejectedValueOnce(new Error('contention'));
    await expect(deliver(deps, e.id)).rejects.toThrow(/contention/);
    expect((await store.getOutbox(e.id))!.status).toBe('sent');
    mutate.mockRestore();
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'done', status: 'sent' });
    expect((await store.getCase('case-1'))!.notifications).toHaveLength(1);
  });

  it('still marks the entry sent when its case is gone', async () => {
    const { store, deps } = await setup({ entries: [entry({ caseId: 'deleted' })] });
    expect((await deliver(deps, e.id)).outcome).toBe('sent');
    expect((await store.getOutbox(e.id))!.status).toBe('sent');
  });

  it('reports a busy lease so a concurrent duplicate does not send twice', async () => {
    const { store, sms, deps, advance } = await setup();
    let release!: () => void;
    const slow = new FakeSender();
    vi.spyOn(slow, 'send').mockImplementation(() => new Promise((r) => (release = () => r({ providerId: 'slow' }))));
    deps.senders.sms = slow;
    const first = deliver(deps, e.id);
    await vi.waitFor(() => expect(slow.send).toHaveBeenCalled());
    deps.senders.sms = sms;
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'busy' });
    release();
    expect((await first).outcome).toBe('sent');

    // An expired lease (the worker crashed) can be taken over.
    await store.updateOutbox(e.id, (x) => ({ ...x, status: 'pending', leaseUntil: NOW.toISOString() }));
    advance(61);
    expect((await deliver(deps, e.id)).outcome).toBe('sent');
    expect(sms.sent).toHaveLength(1);
  });

  it('asks for a retry on temporary errors, then gives up after the attempt limit', async () => {
    const { store, sms, deps } = await setup();
    sms.failWith(retryable(), retryable(), retryable());
    expect((await deliver(deps, e.id)).outcome).toBe('retry');
    const afterFirst = (await store.getOutbox(e.id))!;
    expect(afterFirst).toMatchObject({ status: 'pending', attempts: 1, lastError: { code: '20500', retryable: true } });
    expect(afterFirst.leaseUntil).toBeUndefined();
    expect((await deliver(deps, e.id)).outcome).toBe('retry');
    expect(await deliver(deps, e.id)).toMatchObject({ outcome: 'failed', error: { retryable: true } });
    expect((await store.getOutbox(e.id))!).toMatchObject({ status: 'failed', attempts: 3 });
    expect((await store.getCase('case-1'))!.notifications).toEqual([]);
  });

  it('fails permanent errors immediately', async () => {
    const { store, sms, deps } = await setup();
    sms.failWith(permanent());
    expect(await deliver(deps, e.id)).toMatchObject({ outcome: 'failed', error: { code: '21211', retryable: false } });
    expect((await store.getOutbox(e.id))!.status).toBe('failed');
  });

  it('treats unexpected errors as temporary', async () => {
    const { sms, deps } = await setup();
    sms.failWith(new Error('socket hang up'), 'weird');
    expect(await deliver(deps, e.id)).toMatchObject({ outcome: 'retry', error: { message: 'socket hang up', retryable: true } });
    expect(await deliver(deps, e.id)).toMatchObject({ outcome: 'retry', error: { message: 'weird' } });
    expect((await deliver(deps, e.id)).outcome).toBe('sent');
  });

  it('skips channels that are not configured', async () => {
    const { store, deps } = await setup({ entries: [entry({ channel: 'email', address: 'alice@example.org' })], senders: {} });
    const id = entry({ channel: 'email', address: 'alice@example.org' }).id;
    expect(await deliver(deps, id)).toMatchObject({ outcome: 'skipped', error: { code: 'channel_disabled' } });
    expect((await store.getOutbox(id))!.status).toBe('skipped');
  });

  it('skips destinations that are not enabled', async () => {
    const { store, sms, deps } = await setup();
    sms.failWith(new DeliveryError('not enabled', false, 'destination_not_allowed'));
    expect((await deliver(deps, e.id)).outcome).toBe('skipped');
    expect((await store.getOutbox(e.id))!.status).toBe('skipped');
  });

  it('handles unknown ids and store failures', async () => {
    const { store, deps } = await setup();
    expect(await deliver(deps, 'f'.repeat(64))).toEqual({ outcome: 'not_found' });
    vi.spyOn(store, 'updateOutbox').mockRejectedValueOnce(new Error('firestore down'));
    await expect(deliver(deps, e.id)).rejects.toThrow(/firestore down/);
  });

  it('reports skipped and failed entries as done on a duplicate task', async () => {
    const { deps, sms } = await setup();
    sms.failWith(permanent());
    await deliver(deps, e.id);
    expect(await deliver(deps, e.id)).toEqual({ outcome: 'done', status: 'failed' });
  });
});

describe('sweep', () => {
  const a = entry();
  const b = entry({ channel: 'email', address: 'alice@example.org' });

  it('re-queues pending entries that have been untouched for a while', async () => {
    const { queue, deps, advance } = await setup({ entries: [a, b] });
    expect(await sweep(deps)).toEqual({ queued: 0, errors: [] });
    advance(121);
    expect(await sweep(deps)).toEqual({ queued: 2, errors: [] });
    expect(queue.tasks.map((t) => t.name).sort()).toEqual([`outbox-${a.id}-a0`, `outbox-${b.id}-a0`].sort());
    expect(await sweep(deps)).toEqual({ queued: 2, errors: [] });
    expect(queue.tasks).toHaveLength(2);
  });

  it('uses a new task name after a failed attempt and leaves leased or finished entries alone', async () => {
    const { store, sms, queue, deps, advance } = await setup({ entries: [a, b] });
    sms.failWith(retryable());
    await deliver(deps, a.id);
    await store.updateOutbox(b.id, (x) => ({ ...x, leaseUntil: new Date(NOW.getTime() + 600_000).toISOString() }));
    advance(121);
    await sweep(deps);
    expect(queue.tasks.map((t) => t.name)).toEqual([`outbox-${a.id}-a1`]);

    await deliver(deps, a.id);
    advance(121);
    queue.tasks.length = 0;
    await sweep(deps);
    expect(queue.tasks).toEqual([]);
  });

  it('reports queue errors', async () => {
    const { queue, deps, advance } = await setup();
    queue.fail = true;
    advance(121);
    const r = await sweep(deps);
    expect(r.queued).toBe(0);
    expect(r.errors[0]).toMatch(/tasks unavailable/);
  });

  it('reports non-Error rejections', async () => {
    const { queue, deps, advance } = await setup();
    vi.spyOn(queue, 'enqueue').mockRejectedValue('nope');
    advance(121);
    expect((await sweep(deps)).errors[0]).toMatch(/nope/);
  });
});
