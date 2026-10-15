import type { PublishOptions, Topic } from '@google-cloud/pubsub';
import type { CallEvent } from './events.js';
import type { EventPublisher } from './worker.js';

// The durable scan retries on the next invocation; don't hold a Cloud Run request open
// through the SDK's longer automatic retry window.
export const publisherOptions: PublishOptions = { batching: { maxMessages: 1 }, gaxOpts: { timeout: 10_000, retry: null } };

export class PubSubEventPublisher implements EventPublisher {
  constructor(private readonly topic: Pick<Topic, 'publishMessage'>) {}
  async publish(event: CallEvent): Promise<void> {
    await this.topic.publishMessage({ json: event, attributes: { event_type: 'call.outcome.v1', event_id: event.event_id } });
  }
}
