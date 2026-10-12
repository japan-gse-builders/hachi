import { MemoryStore } from '@hachi/store';
import { describe, expect, it } from 'vitest';
import { NoResponseService } from '../src/noResponse.js';
import { resident } from './fixtures.js';

describe('immediate R1 no-response flags', () => {
  it('records observed silence, creates normal notifications and is safe to retry', async () => {
    const store = new MemoryStore(), r = resident();
    await store.createResident(r);
    const tasks: { name: string; path: string }[] = [];
    const notifications = { async enqueue(task: { name: string; path: string }) { tasks.push(task); return 'created' as const; } };
    const service = new NoResponseService({ store, notifications, appBaseUrl: 'https://app.example', newId: () => 'no-response-case' });
    const input = { resident: r, kind: 'silent_after_greeting' as const, at: '2026-10-13T01:00:00.000Z' };
    expect(await service.flag(input)).toBe('no-response-case');
    expect(await service.flag(input)).toBe('no-response-case');
    const cases = await store.listCasesByResident(r.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ rule: 'R1', autoUrgency: 'emergency' });
    expect(cases[0]!.detections[0]).toMatchObject({ noResponse: 'silent_after_greeting', evidence: [] });
    expect(cases[0]!.detections[0]!.summary).toContain('cause is unknown');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.path === '/tasks/send')).toBe(true);
    const outbox = await store.listOutboxByCase('no-response-case');
    expect(new Set(outbox.map((e) => e.id)).size).toBe(outbox.length);
  });
});
