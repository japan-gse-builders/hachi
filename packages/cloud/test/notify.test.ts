import { describe, expect, it } from 'vitest';
import { ANALYZE_CALL_PATH, analysisTask, notificationTask, requestDelivery, SEND_NOTIFICATION_PATH, type EnqueueRequest, type TaskQueue } from '../src/index.js';

describe('analysisTask', () => {
  it('names the task after the call and pass', () => {
    expect(analysisTask('res-1', '2026-10-02-0', 's1')).toEqual({
      name: 'analyze-res-1-2026-10-02-0-s1',
      path: ANALYZE_CALL_PATH,
      body: { residentId: 'res-1', callId: '2026-10-02-0' },
    });
    const at = new Date('2026-10-02T03:00:00Z');
    expect(analysisTask('r', 'c', 'k', at).scheduleAt).toBe(at);
  });
});

describe('notificationTask', () => {
  it('names the task after the entry and attempt', () => {
    expect(notificationTask('abc')).toEqual({ name: 'outbox-abc-a0', path: SEND_NOTIFICATION_PATH, body: { outboxId: 'abc' } });
    expect(notificationTask('abc', 3).name).toBe('outbox-abc-a3');
  });
});

describe('requestDelivery', () => {
  it('queues every entry and reports failures without throwing', async () => {
    const seen: EnqueueRequest[] = [];
    const queue: TaskQueue = {
      async enqueue(req) {
        if (req.name.includes('bad')) throw new Error('unavailable');
        seen.push(req);
        return 'created';
      },
    };
    expect(await requestDelivery(queue, ['a', 'bad', 'b'])).toEqual({ queued: 2, errors: ['unavailable'] });
    expect(seen.map((r) => r.name)).toEqual(['outbox-a-a0', 'outbox-b-a0']);
    expect(await requestDelivery(queue, [])).toEqual({ queued: 0, errors: [] });
  });

  it('reports non-Error rejections', async () => {
    const queue: TaskQueue = { enqueue: () => Promise.reject('nope') };
    expect((await requestDelivery(queue, ['a'])).errors).toEqual(['nope']);
  });
});
