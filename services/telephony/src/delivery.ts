import type { DeliveryStatus } from '@hachi/core';

const MESSAGE_STATUS: Record<string, DeliveryStatus> = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
  canceled: 'canceled',
};

const CALL_STATUS: Record<string, DeliveryStatus> = {
  queued: 'queued',
  initiated: 'queued',
  ringing: 'ringing',
  'in-progress': 'answered',
  completed: 'answered',
  busy: 'busy',
  'no-answer': 'no_answer',
  failed: 'failed',
  canceled: 'canceled',
};

const MESSAGE_SID = /^(SM|MM)[0-9a-fA-F]{32}$/;
const CALL_SID = /^CA[0-9a-fA-F]{32}$/;
const ERROR_CODE = /^\d{1,6}$/;
const OUTBOX_ID = /^[a-f0-9]{64}$/;

export interface DeliveryCallback {
  providerId: string;
  status: DeliveryStatus;
  errorCode?: string;
}

export function parseOutboxId(query: unknown): string | null {
  const id = (query as { outboxId?: unknown } | null)?.outboxId;
  return typeof id === 'string' && OUTBOX_ID.test(id) ? id : null;
}

/** Reads a Twilio Messages or Calls status callback. Only the SID, status and error code are kept. */
export function parseDeliveryCallback(params: Record<string, string>): DeliveryCallback | null {
  const messageSid = params.MessageSid;
  const callSid = params.CallSid;
  let providerId: string;
  let status: DeliveryStatus | undefined;
  if (messageSid && MESSAGE_SID.test(messageSid)) {
    providerId = messageSid;
    status = MESSAGE_STATUS[params.MessageStatus ?? params.SmsStatus ?? ''];
  } else if (callSid && CALL_SID.test(callSid)) {
    providerId = callSid;
    status = CALL_STATUS[params.CallStatus ?? ''];
  } else {
    return null;
  }
  if (!status) return null;
  const code = params.ErrorCode;
  return { providerId, status, ...(code && ERROR_CODE.test(code) && code !== '0' ? { errorCode: code } : {}) };
}
