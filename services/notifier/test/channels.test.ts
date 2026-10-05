import { describe, expect, it, vi } from 'vitest';
import { alertTwiml, DeliveryError, FcmPush, SendGridEmail, TwilioSms, TwilioVoiceAlert } from '../src/channels.js';
import { entry } from './fixtures.js';

const twilio = { accountSid: 'AC123', apiKeySid: 'SK123', apiKeySecret: 'test-secret', apiBaseUrl: 'https://twilio.test' };

function fetchReturning(status: number, json: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(json), { status, headers }));
}

async function rejection(p: Promise<unknown>): Promise<DeliveryError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DeliveryError);
  return err as DeliveryError;
}

describe('TwilioSms', () => {
  const sms = (f: typeof fetch) => new TwilioSms({ ...twilio, from: '+15005550007', allowedPrefixes: ['+81'] }, f);

  it('posts the message with API key auth', async () => {
    const f = fetchReturning(201, { sid: 'SM1' });
    expect(await sms(f).send(entry())).toEqual({ providerId: 'SM1' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://twilio.test/2010-04-01/Accounts/AC123/Messages.json');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('SK123:test-secret').toString('base64')}`);
    const body = init!.body as URLSearchParams;
    expect(body.get('To')).toBe('+819000000002');
    expect(body.get('From')).toBe('+15005550007');
    expect(body.get('Body')).toContain('Please contact Maggie');
    expect(body.has('StatusCallback')).toBe(false);
  });

  it('asks Twilio for delivery reports on a URL that names the outbox entry, not the recipient', async () => {
    const f = fetchReturning(201, { sid: 'SM1' });
    const e = entry();
    await new TwilioSms({ ...twilio, statusCallbackBaseUrl: 'https://telephony.test', from: '+15005550007', allowedPrefixes: ['+81'] }, f).send(e);
    const body = f.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('StatusCallback')).toBe(`https://telephony.test/twilio/delivery-status?outboxId=${e.id}`);
    expect(body.get('StatusCallback')).not.toContain(e.address.slice(1));
  });

  it('refuses destinations outside the allowed countries without calling Twilio', async () => {
    const f = fetchReturning(201, { sid: 'SM1' });
    const err = await rejection(sms(f).send(entry({ address: '+14155550100' })));
    expect(err).toMatchObject({ retryable: false, code: 'destination_not_allowed' });
    expect(err.message).not.toContain('4155550100');
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [400, 21211, false],
    [500, 20500, true],
    [429, 20429, true],
    [401, 20003, true],
  ])('classifies HTTP %i as retryable=%s', async (status, code, retry) => {
    const err = await rejection(sms(fetchReturning(status, { code, message: 'nope' })).send(entry()));
    expect(err).toMatchObject({ retryable: retry, code: String(code) });
    expect(err.message).toBe(`Twilio ${status}: nope`);
  });

  it('retries network errors and handles non-JSON responses', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await rejection(sms(down).send(entry()))).toMatchObject({ retryable: true, message: expect.stringMatching(/ECONNRESET/) });
    const html = vi.fn(async () => new Response('<html>', { status: 502 }));
    expect(await rejection(sms(html).send(entry()))).toMatchObject({ retryable: true, message: 'Twilio 502: unknown error', code: undefined });
  });
});

describe('alertTwiml', () => {
  it('reads the message twice without links', () => {
    const xml = alertTwiml('[Hachi Immediate action] Maggie & Bob\nPlease call.\nDetails: https://app.example/family', 'Google.en-US-Neural2-F');
    expect(xml).not.toContain('https://');
    expect(xml.match(/<Say /g)).toHaveLength(2);
    expect(xml).toContain('Hachi Immediate action Maggie &amp; Bob Please call.');
    expect(xml).toContain('language="en-US"');
  });

  it('uses a Japanese voice for Japanese text', () => {
    const xml = alertTwiml('【Hachi 緊急】マギーさん\nケース：https://app.example/staff/cases/1', 'Google.en-US-Neural2-F');
    expect(xml).toContain('voice="Google.ja-JP-Neural2-B" language="ja-JP"');
    expect(xml).toContain('Hachi 緊急 マギーさん');
  });
});

describe('TwilioVoiceAlert', () => {
  it('places a short call that speaks the alert', async () => {
    const f = fetchReturning(201, { sid: 'CA1' });
    const voice = new TwilioVoiceAlert({ ...twilio, from: '+15005550006', sayVoice: 'Google.en-US-Neural2-F' }, f);
    expect(await voice.send(entry({ channel: 'voice' }))).toEqual({ providerId: 'CA1' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://twilio.test/2010-04-01/Accounts/AC123/Calls.json');
    const body = init!.body as URLSearchParams;
    expect(body.get('From')).toBe('+15005550006');
    expect(body.get('Twiml')).toContain('<Say');
    expect(body.get('TimeLimit')).toBe('120');
    expect(body.has('StatusCallback')).toBe(false);
  });

  it('reports the call outcome when a status callback origin is configured', async () => {
    const f = fetchReturning(201, { sid: 'CA1' });
    const e = entry({ channel: 'voice' });
    const cfg = { ...twilio, statusCallbackBaseUrl: 'https://telephony.test', from: '+15005550006', sayVoice: 'Google.en-US-Neural2-F' };
    await new TwilioVoiceAlert(cfg, f).send(e);
    const body = f.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('StatusCallback')).toBe(`https://telephony.test/twilio/delivery-status?outboxId=${e.id}`);
    expect(body.get('StatusCallbackMethod')).toBe('POST');
  });
});

describe('SendGridEmail', () => {
  const email = (f: typeof fetch) => new SendGridEmail({ apiKey: 'sg-test', from: 'alerts@example.org', fromName: 'Hachi', apiBaseUrl: 'https://sg.test' }, f);
  const mail = entry({ channel: 'email', address: 'alice@example.org' });

  it('sends a plain-text message without click tracking', async () => {
    const f = fetchReturning(202, {}, { 'x-message-id': 'MSG1' });
    expect(await email(f).send(mail)).toEqual({ providerId: 'MSG1' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://sg.test/v3/mail/send');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sg-test');
    const body = JSON.parse(init!.body as string);
    expect(body.personalizations).toEqual([{ to: [{ email: 'alice@example.org' }] }]);
    expect(body.from).toEqual({ email: 'alerts@example.org', name: 'Hachi' });
    expect(body.subject).toBe(mail.subject);
    expect(body.content).toEqual([{ type: 'text/plain', value: mail.body }]);
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
  });

  it('works without a message id', async () => {
    expect(await email(fetchReturning(202, {})).send(mail)).toEqual({});
  });

  it('classifies errors', async () => {
    expect(await rejection(email(fetchReturning(400, { errors: [{ message: 'bad address' }] })).send(mail))).toMatchObject({
      retryable: false,
      code: '400',
      message: 'SendGrid 400: bad address',
    });
    expect(await rejection(email(fetchReturning(503, {})).send(mail))).toMatchObject({ retryable: true, message: 'SendGrid 503: unknown error' });
  });

  it('uses the public API by default', async () => {
    const f = fetchReturning(202, {});
    await new SendGridEmail({ apiKey: 'k', from: 'a@b.co', fromName: 'Hachi' }, f).send(mail);
    expect(f.mock.calls[0]![0]).toBe('https://api.sendgrid.com/v3/mail/send');
  });
});

describe('FcmPush', () => {
  const push = entry({ channel: 'push', address: 'fcm-token', recipient: 'staff' });

  it('sends a notification that opens the linked page', async () => {
    const send = vi.fn(async () => 'projects/p/messages/1');
    expect(await new FcmPush(send).send(push)).toEqual({ providerId: 'projects/p/messages/1' });
    expect(send).toHaveBeenCalledWith({
      token: 'fcm-token',
      notification: { title: push.subject, body: '[Hachi Immediate action] Maggie reported sudden symptoms.\nPlease contact Maggie right away.' },
      data: { caseId: 'case-1', urgency: 'emergency' },
      webpush: { fcmOptions: { link: 'https://app.example/family' } },
    });
  });

  it('omits the link when there is none', async () => {
    const send = vi.fn(async (_m: unknown) => 'id');
    await new FcmPush(send).send({ ...push, body: 'No link here' });
    expect(send.mock.calls[0]![0]).not.toHaveProperty('webpush');
  });

  it('gives up on dead tokens and retries other errors', async () => {
    const fail = (code?: string) => new FcmPush(async () => Promise.reject(Object.assign(new Error('fcm error'), code ? { code } : {})));
    expect(await rejection(fail('messaging/registration-token-not-registered').send(push))).toMatchObject({ retryable: false });
    expect(await rejection(fail('messaging/internal-error').send(push))).toMatchObject({ retryable: true });
    expect(await rejection(fail().send(push))).toMatchObject({ retryable: true, message: 'FCM: fcm error' });
  });
});
