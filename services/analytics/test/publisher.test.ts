import { describe, expect, it, vi } from 'vitest';
import type { Topic } from '@google-cloud/pubsub';
import { callEvent } from '../src/events.js';
import { PubSubEventPublisher } from '../src/publisher.js';
import { snapshot } from './fixtures.js';

describe('Pub/Sub event publisher', () => {
  it('publishes JSON compatible with the BigQuery table schema and awaits acknowledgement', async () => {
    const publishMessage = vi.fn().mockResolvedValue('message-1');
    const publisher = new PubSubEventPublisher({ publishMessage } as unknown as Pick<Topic, 'publishMessage'>);
    const event = callEvent(snapshot())!.event;
    await publisher.publish(event);
    expect(publishMessage).toHaveBeenCalledWith({ json: event,
      attributes: { event_type: 'call.outcome.v1', event_id: event.event_id } });
    publishMessage.mockRejectedValueOnce(new Error('unavailable'));
    await expect(publisher.publish(event)).rejects.toThrow('unavailable');
  });
});
