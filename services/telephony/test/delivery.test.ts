import { describe, expect, it } from 'vitest';
import { parseDeliveryCallback, parseOutboxId } from '../src/delivery.js';

const SM = 'SM0123456789abcdef0123456789abcdef';
const CA = 'CA0123456789ABCDEF0123456789ABCDEF';

describe('parseDeliveryCallback', () => {
  it.each([
    ['queued', 'queued'],
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['undelivered', 'undelivered'],
    ['failed', 'failed'],
  ])('maps SMS status %s', (twilio, status) => {
    expect(parseDeliveryCallback({ MessageSid: SM, MessageStatus: twilio, To: '+819000000002' })).toEqual({ providerId: SM, status });
  });

  it('keeps the carrier error code and nothing else from the callback', () => {
    expect(parseDeliveryCallback({ MessageSid: SM, MessageStatus: 'undelivered', ErrorCode: '30007', To: '+819000000002', From: '+1' })).toEqual({
      providerId: SM,
      status: 'undelivered',
      errorCode: '30007',
    });
    expect(parseDeliveryCallback({ MessageSid: SM, SmsStatus: 'sent', ErrorCode: '0' })).toEqual({ providerId: SM, status: 'sent' });
    expect(parseDeliveryCallback({ MessageSid: SM, MessageStatus: 'failed', ErrorCode: '<script>' })).toEqual({ providerId: SM, status: 'failed' });
  });

  it.each([
    ['completed', 'answered'],
    ['in-progress', 'answered'],
    ['ringing', 'ringing'],
    ['no-answer', 'no_answer'],
    ['busy', 'busy'],
    ['canceled', 'canceled'],
  ])('maps call status %s', (twilio, status) => {
    expect(parseDeliveryCallback({ CallSid: CA, CallStatus: twilio })).toEqual({ providerId: CA, status });
  });

  it('rejects unknown statuses and malformed SIDs', () => {
    expect(parseDeliveryCallback({ MessageSid: SM, MessageStatus: 'mystery' })).toBeNull();
    expect(parseDeliveryCallback({ MessageSid: SM })).toBeNull();
    expect(parseDeliveryCallback({ CallSid: CA })).toBeNull();
    expect(parseDeliveryCallback({ MessageSid: 'SM123', MessageStatus: 'sent' })).toBeNull();
    expect(parseDeliveryCallback({})).toBeNull();
  });
});

describe('parseOutboxId', () => {
  it('accepts only a SHA-256 outbox id', () => {
    expect(parseOutboxId({ outboxId: 'a'.repeat(64) })).toBe('a'.repeat(64));
    expect(parseOutboxId({ outboxId: '../x' })).toBeNull();
    expect(parseOutboxId({ outboxId: ['a'.repeat(64)] })).toBeNull();
    expect(parseOutboxId(null)).toBeNull();
  });
});
