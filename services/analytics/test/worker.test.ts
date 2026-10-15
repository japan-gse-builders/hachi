import { describe, expect, it, vi } from 'vitest';
import { callEvent } from '../src/events.js';
import { exportCalls } from '../src/worker.js';
import { call, NOW, setup, snapshot } from './fixtures.js';

describe('analytics export', () => {
  it('publishes once, then only meaningful changes; unrelated writes do not produce more events', async () => {
    const { deps, events, source } = setup();
    expect(await exportCalls(deps)).toMatchObject({ published: 1, caughtUp: true });
    source.snapshots[0]!.call.streams = 2;
    source.snapshots[0]!.revision = '001792032000.000000002';
    expect(await exportCalls(deps)).toMatchObject({ published: 0, unchanged: 1 });
    source.snapshots[0]!.call.analysisPending = true;
    expect(await exportCalls(deps)).toMatchObject({ published: 1 });
    expect(events).toHaveLength(2);
    expect(events[1]!.analysis_state).toBe('pending');
  });
  it('retries a failed send without advancing the page, without republishing successful calls', async () => {
    const { deps, events, source } = setup([snapshot(), snapshot({ call: call({ id: 'c-2' }) })]);
    const publish = vi.spyOn(deps.publisher, 'publish');
    publish.mockResolvedValueOnce().mockRejectedValueOnce(new Error('outage'));
    expect(await exportCalls(deps)).toMatchObject({ published: 1, failed: 1, caughtUp: false });
    expect(source.savedCursor).toBeNull();
    expect(await exportCalls(deps)).toMatchObject({ published: 1, unchanged: 1, failed: 0, caughtUp: true });
    expect(events).toHaveLength(1);
    expect(source.receipts.size).toBe(2);
  });
  it('reuses the same event ID if publication succeeded but saving the receipt failed', async () => {
    const { deps, source, events } = setup();
    vi.spyOn(source, 'markPublished').mockRejectedValueOnce(new Error('database outage'));
    expect((await exportCalls(deps)).failed).toBe(1);
    expect((await exportCalls(deps)).published).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(events[1]);
  });
  it('does not let an older snapshot overwrite a newer receipt', async () => {
    const { deps, source, events } = setup();
    const row = callEvent(source.snapshots[0]!)!;
    source.receipts.set(row.event.call_key, { fingerprint: 'newer-value', revision: '001792032000.000000002' });
    expect((await exportCalls(deps)).unchanged).toBe(1);
    expect(events).toHaveLength(0);
    expect(source.receipts.get(row.event.call_key)?.fingerprint).toBe('newer-value');
  });
  it('requires both organization opt-in and synthetic data by default', async () => {
    const { deps, events } = setup([snapshot(), snapshot({ orgId: 'other' }),
      snapshot({ synthetic: false, call: call({ id: 'real' }) }),
      snapshot({ synthetic: false, call: call({ id: 'demo', synthetic: true }) })]);
    expect(await exportCalls(deps)).toMatchObject({ published: 2, excluded: 2 });
    expect(events.every((e) => e.synthetic)).toBe(true);
    deps.settings.includeRealData = true;
    expect(await exportCalls(deps)).toMatchObject({ published: 1, unchanged: 2, excluded: 1 });
    expect(events.at(-1)?.synthetic).toBe(false);
  });
  it('bounds scans, resumes at the exact cursor for equal call times, then revisits updates', async () => {
    const { deps, source, events } = setup(Array.from({ length: 5 }, (_, i) => snapshot({ call: call({ id: `c-${i}` }) })));
    deps.settings.pageSize = 2; deps.settings.maxPages = 1;
    expect(await exportCalls(deps)).toMatchObject({ scanned: 2, caughtUp: false });
    expect(source.savedCursor?.path).toBe('residents/r-1/calls/c-1');
    expect(await exportCalls(deps)).toMatchObject({ scanned: 2, caughtUp: false });
    expect(await exportCalls(deps)).toMatchObject({ scanned: 1, caughtUp: true });
    expect(source.savedCursor).toBeNull();
    expect(new Set(events.map((e) => e.call_key)).size).toBe(5);
    expect(await exportCalls(deps)).toMatchObject({ published: 0, unchanged: 2 });
  });
  it('excludes old, imported and nonterminal calls', async () => {
    const { deps, events } = setup([
      snapshot({ call: call({ startedAt: '2020-01-01T00:00:00.000Z' }) }),
      snapshot({ call: call({ id: 'i', source: 'imported' }) }),
      snapshot({ call: call({ id: 's', status: 'scheduled' }) }),
    ]);
    expect(await exportCalls(deps)).toMatchObject({ scanned: 2, excluded: 2, caughtUp: true });
    expect(events).toHaveLength(0);
  });
  it('does not block later calls on a malformed source and exports it after correction', async () => {
    const { deps, source } = setup([snapshot({ revision: 'invalid' }), snapshot({ call: call({ id: 'c-2' }) })]);
    expect(await exportCalls(deps)).toMatchObject({ invalid: 1, published: 1, failed: 0, caughtUp: true });
    source.snapshots[0]!.revision = '001792032000.000000001';
    expect(await exportCalls(deps)).toMatchObject({ invalid: 0, published: 1, unchanged: 1, caughtUp: true });
  });
  it('stops within the request time budget and resumes the partial page next time', async () => {
    const { deps, events, source } = setup([snapshot(), snapshot({ call: call({ id: 'c-2' }) })]);
    let time = NOW.getTime(); deps.now = () => new Date(time);
    vi.spyOn(deps.publisher, 'publish').mockImplementationOnce(async (e) => { events.push(e); time += 240_000; });
    expect(await exportCalls(deps)).toMatchObject({ published: 1, caughtUp: false });
    expect(source.savedCursor).toBeNull();
    expect(await exportCalls(deps)).toMatchObject({ published: 1, unchanged: 1, caughtUp: true });
  });
});
