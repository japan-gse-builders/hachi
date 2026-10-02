import { describe, expect, it, vi } from 'vitest';
import { CloudTasksQueue, GoogleOidcVerifier } from '../src/index.js';

describe('CloudTasksQueue', () => {
  const opts = {
    project: 'p',
    location: 'asia-northeast1',
    queue: 'outbound-calls',
    targetBaseUrl: 'https://t.example',
    serviceAccountEmail: 'tasks@p.iam.gserviceaccount.com',
  };
  type CreateTask = ReturnType<typeof vi.fn<(req: Record<string, any>) => Promise<unknown>>>;
  const client = (createTask: CreateTask) => ({
    createTask,
    queuePath: (p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
    taskPath: (p: string, l: string, q: string, t: string) => `projects/${p}/locations/${l}/queues/${q}/tasks/${t}`,
  });

  it('creates an OIDC-authenticated HTTP task with a deterministic name', async () => {
    const createTask: CreateTask = vi.fn(async () => [{}]);
    const q = new CloudTasksQueue(client(createTask) as never, opts);
    await expect(q.enqueue({ name: 'call-r-2026-10-02-0', path: '/tasks/place-call', body: { a: 1 }, scheduleAt: new Date(10_500) })).resolves.toBe('created');
    const arg = createTask.mock.calls[0]![0];
    expect(arg.parent).toBe('projects/p/locations/asia-northeast1/queues/outbound-calls');
    expect(arg.task.name).toBe('projects/p/locations/asia-northeast1/queues/outbound-calls/tasks/call-r-2026-10-02-0');
    expect(arg.task.scheduleTime).toEqual({ seconds: 10 });
    expect(arg.task.httpRequest).toMatchObject({
      httpMethod: 'POST',
      url: 'https://t.example/tasks/place-call',
      oidcToken: { serviceAccountEmail: 'tasks@p.iam.gserviceaccount.com', audience: 'https://t.example' },
    });
    expect(JSON.parse(Buffer.from(arg.task.httpRequest.body).toString())).toEqual({ a: 1 });
  });

  it('omits scheduleTime for immediate tasks', async () => {
    const createTask: CreateTask = vi.fn(async () => [{}]);
    await new CloudTasksQueue(client(createTask) as never, opts).enqueue({ name: 'n', path: '/x', body: {} });
    expect(createTask.mock.calls[0]![0].task.scheduleTime).toBeUndefined();
  });

  it('reports duplicates as "exists" and rethrows other errors', async () => {
    const dup: CreateTask = vi.fn(async () => Promise.reject(Object.assign(new Error('exists'), { code: 6 })));
    await expect(new CloudTasksQueue(client(dup) as never, opts).enqueue({ name: 'n', path: '/x', body: {} })).resolves.toBe('exists');
    const down: CreateTask = vi.fn(async () => Promise.reject(Object.assign(new Error('unavailable'), { code: 14 })));
    await expect(new CloudTasksQueue(client(down) as never, opts).enqueue({ name: 'n', path: '/x', body: {} })).rejects.toThrow('unavailable');
  });
});

describe('GoogleOidcVerifier', () => {
  const make = (payload: Record<string, unknown> | undefined, fail = false) => {
    const verifyIdToken = vi.fn(async () => (fail ? Promise.reject(new Error('bad sig')) : { getPayload: () => payload }));
    return { verifyIdToken, v: new GoogleOidcVerifier({ verifyIdToken } as never, 'https://t.example', ['Tasks@p.iam.gserviceaccount.com']) };
  };

  it('accepts tokens from allowed service accounts for this audience', async () => {
    const { v, verifyIdToken } = make({ email: 'tasks@p.iam.gserviceaccount.com', email_verified: true });
    await expect(v.verify('Bearer tok')).resolves.toBeUndefined();
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok', audience: 'https://t.example' });
  });

  it('rejects missing, invalid, unverified or unknown callers', async () => {
    await expect(make({}).v.verify(undefined)).rejects.toThrow(/Missing/);
    await expect(make({}).v.verify('Basic x')).rejects.toThrow(/Missing/);
    await expect(make(undefined, true).v.verify('Bearer tok')).rejects.toThrow('bad sig');
    await expect(make({ email: 'tasks@p.iam.gserviceaccount.com', email_verified: false }).v.verify('Bearer t')).rejects.toThrow(/not allowed/);
    await expect(make({ email: 'evil@x.com', email_verified: true }).v.verify('Bearer t')).rejects.toThrow(/not allowed/);
    await expect(make(undefined).v.verify('Bearer t')).rejects.toThrow(/not allowed/);
  });
});
