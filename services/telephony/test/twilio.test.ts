import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCallTwiml, computeTwilioSignature, isValidTwilioSignature, TelephonyError, TwilioVoice } from '../src/twilio.js';

const CREDS = {
  accountSid: `AC${'a'.repeat(32)}`,
  apiKeySid: `SK${'b'.repeat(32)}`,
  apiKeySecret: 'key-secret',
  apiBaseUrl: 'https://api.twilio.com',
};

const REQ = {
  to: '+819000000001',
  from: '+15005550006',
  twiml: '<Response/>',
  statusCallbackUrl: 'https://t.example/twilio/status?residentId=r&callId=c',
  ringTimeoutSec: 30,
  maxCallSec: 480,
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('TwilioVoice.placeCall', () => {
  it('posts the call with API key auth and all parameters', async () => {
    const fetchFn = respond(201, { sid: 'CA123', status: 'queued' });
    await expect(new TwilioVoice(CREDS, fetchFn as unknown as typeof fetch).placeCall(REQ)).resolves.toEqual({ providerCallId: 'CA123' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${CREDS.accountSid}/Calls.json`);
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from(`${CREDS.apiKeySid}:key-secret`).toString('base64')}`,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = init.body as URLSearchParams;
    expect(body.get('To')).toBe('+819000000001');
    expect(body.get('From')).toBe('+15005550006');
    expect(body.get('Twiml')).toBe('<Response/>');
    expect(body.get('StatusCallback')).toBe(REQ.statusCallbackUrl);
    expect(body.get('Timeout')).toBe('30');
    expect(body.get('TimeLimit')).toBe('480');
    expect(body.getAll('StatusCallbackEvent')).toEqual(['initiated', 'ringing', 'answered', 'completed']);
  });

  it('omits status callbacks when none is requested', async () => {
    const fetchFn = respond(201, { sid: 'CA9' });
    const { statusCallbackUrl: _omit, ...req } = REQ;
    await new TwilioVoice(CREDS, fetchFn as unknown as typeof fetch).placeCall(req);
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.has('StatusCallback')).toBe(false);
    expect(body.has('StatusCallbackEvent')).toBe(false);
  });

  it('classifies client errors as permanent and keeps the Twilio error code', async () => {
    const client = new TwilioVoice(CREDS, respond(400, { code: 21219, message: 'unverified' }) as unknown as typeof fetch);
    const err = await client.placeCall(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelephonyError);
    expect(err).toMatchObject({ retryable: false, code: '21219', message: 'Twilio 400: unverified' });
  });

  it('classifies server errors and rate limiting as temporary', async () => {
    for (const status of [500, 503, 429]) {
      const client = new TwilioVoice(CREDS, respond(status, {}) as unknown as typeof fetch);
      await expect(client.placeCall(REQ)).rejects.toMatchObject({ retryable: true, message: `Twilio ${status}: unknown error` });
    }
  });

  it('treats a success without a SID or an unreadable body as an error', async () => {
    const noSid = new TwilioVoice(CREDS, respond(201, {}) as unknown as typeof fetch);
    await expect(noSid.placeCall(REQ)).rejects.toMatchObject({ retryable: false });
    const badJson = vi.fn(async () => new Response('<html>', { status: 502 }));
    await expect(new TwilioVoice(CREDS, badJson as unknown as typeof fetch).placeCall(REQ)).rejects.toMatchObject({ retryable: true });
  });

  it('treats network errors and timeouts as temporary', async () => {
    const fetchFn = vi.fn(async () => Promise.reject(new Error('ECONNRESET')));
    await expect(new TwilioVoice(CREDS, fetchFn as unknown as typeof fetch).placeCall(REQ)).rejects.toMatchObject({
      retryable: true,
      message: 'Twilio request failed: ECONNRESET',
    });
  });
});

describe('buildCallTwiml', () => {
  it('connects a media stream with call identifiers, then hands control back to this service', () => {
    expect(
      buildCallTwiml({
        residentId: 'r1',
        callId: 'c1',
        preferredName: 'Maggie',
        streamUrl: 'wss://g.example/stream',
        streamToken: 'tok',
        afterStreamUrl: 'https://t.example/twilio/after-stream?residentId=r1&callId=c1',
        sayVoice: 'v',
      }),
    ).toBe(
      '<Response><Connect><Stream url="wss://g.example/stream"><Parameter name="residentId" value="r1"/>' +
        '<Parameter name="callId" value="c1"/><Parameter name="streamToken" value="tok"/></Stream></Connect>' +
        '<Redirect method="POST">https://t.example/twilio/after-stream?residentId=r1&amp;callId=c1</Redirect></Response>',
    );
  });

  it('plays a test message that discloses the AI, escaping user-provided text', () => {
    const xml = buildCallTwiml({ residentId: 'r1', callId: 'c1', preferredName: `<Bob & "Al">`, sayVoice: 'Google.en-US-Neural2-F' });
    expect(xml).toContain('<Say voice="Google.en-US-Neural2-F" language="en-US">');
    expect(xml).toContain('Hello &lt;Bob &amp; &quot;Al&quot;&gt;.');
    expect(xml).toContain('an AI assistant');
    expect(xml).not.toContain('<Bob');
  });
});

describe('Twilio webhook signatures', () => {
  const url = 'https://t.example/twilio/status?residentId=r&callId=c';
  const params = { CallSid: 'CA1', CallStatus: 'completed', AccountSid: 'AC1' };
  // Independent reference implementation of Twilio's documented algorithm.
  const reference = createHmac('sha1', 'secret')
    .update(`${url}AccountSidAC1CallSidCA1CallStatuscompleted`)
    .digest('base64');

  it('matches the documented algorithm', () => {
    expect(computeTwilioSignature('secret', url, params)).toBe(reference);
  });

  it('accepts a valid signature and rejects tampering', () => {
    expect(isValidTwilioSignature('secret', url, params, reference)).toBe(true);
    expect(isValidTwilioSignature('secret', url, { ...params, CallStatus: 'failed' }, reference)).toBe(false);
    expect(isValidTwilioSignature('secret', `${url}&x=1`, params, reference)).toBe(false);
    expect(isValidTwilioSignature('other', url, params, reference)).toBe(false);
    expect(isValidTwilioSignature('secret', url, params, undefined)).toBe(false);
    expect(isValidTwilioSignature('secret', url, params, 'short')).toBe(false);
  });
});
