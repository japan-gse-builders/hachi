import type { CloudTasksClient } from '@google-cloud/tasks';

export interface EnqueueRequest {
  /** Deterministic task id; a duplicate id is reported as 'exists' instead of creating a second task. */
  name: string;
  path: string;
  body: unknown;
  scheduleAt?: Date;
}

export interface TaskQueue {
  enqueue(req: EnqueueRequest): Promise<'created' | 'exists'>;
}

/** gRPC ALREADY_EXISTS */
const ALREADY_EXISTS = 6;

export class CloudTasksQueue implements TaskQueue {
  constructor(
    private readonly client: Pick<CloudTasksClient, 'createTask' | 'queuePath' | 'taskPath'>,
    private readonly opts: { project: string; location: string; queue: string; targetBaseUrl: string; serviceAccountEmail: string },
  ) {}

  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    const { project, location, queue, targetBaseUrl, serviceAccountEmail } = this.opts;
    try {
      await this.client.createTask({
        parent: this.client.queuePath(project, location, queue),
        task: {
          name: this.client.taskPath(project, location, queue, req.name),
          ...(req.scheduleAt ? { scheduleTime: { seconds: Math.floor(req.scheduleAt.getTime() / 1000) } } : {}),
          httpRequest: {
            httpMethod: 'POST',
            url: `${targetBaseUrl}${req.path}`,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify(req.body)),
            oidcToken: { serviceAccountEmail, audience: targetBaseUrl },
          },
        },
      });
      return 'created';
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return 'exists';
      throw err;
    }
  }
}
