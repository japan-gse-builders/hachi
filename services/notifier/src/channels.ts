import type { ContactChannel } from '@hachi/core';
import type { OutboxEntry } from '@hachi/store';

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

export interface ChannelSender {
  /** Throws DeliveryError; any other error is treated as retryable. */
  send(entry: OutboxEntry): Promise<{ providerId?: string }>;
}

export type Senders = Partial<Record<ContactChannel, ChannelSender>>;

type FetchFn = typeof fetch;
const TIMEOUT_MS = 10_000;

async function request(fetchFn: FetchFn, provider: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new DeliveryError(`${provider} request failed: ${(err as Error).message}`, true);
  }
}

/** 401/403 are configuration problems that a fixed secret resolves, so they are retried too. */
const retryableStatus = (status: number) => status >= 500 || status === 429 || status === 401 || status === 403;

export interface TwilioRestConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  apiBaseUrl: string;
}

async function twilioPost(cfg: TwilioRestConfig, fetchFn: FetchFn, resource: string, body: URLSearchParams): Promise<string> {
  const url = `${cfg.apiBaseUrl}/2010-04-01/Accounts/${cfg.accountSid}/${resource}.json`;
  const auth = Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString('base64');
  const res = await request(fetchFn, 'Twilio', url, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
  if (res.ok && json.sid) return json.sid;
  throw new DeliveryError(`Twilio ${res.status}: ${json.message ?? 'unknown error'}`, retryableStatus(res.status), json.code?.toString());
}

export class TwilioSms implements ChannelSender {
  constructor(
    private readonly cfg: TwilioRestConfig & { from: string; allowedPrefixes: string[] },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(e: OutboxEntry): Promise<{ providerId: string }> {
    if (!this.cfg.allowedPrefixes.some((p) => e.address.startsWith(p))) {
      throw new DeliveryError(`SMS to ${e.address.slice(0, 3)}… is not enabled`, false, 'destination_not_allowed');
    }
    const providerId = await twilioPost(this.cfg, this.fetchFn, 'Messages', new URLSearchParams({ To: e.address, From: this.cfg.from, Body: e.body }));
    return { providerId };
  }
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Links cannot be read aloud usefully; the spoken alert keeps everything else and repeats once. */
export function alertTwiml(body: string, sayVoice: string): string {
  const text = body
    .split('\n')
    .filter((line) => !/https?:\/\//.test(line))
    .join(' ')
    .replace(/[【】[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/.test(text);
  const voice = japanese ? 'Google.ja-JP-Neural2-B' : sayVoice;
  const say = `<Say voice="${escapeXml(voice)}" language="${japanese ? 'ja-JP' : 'en-US'}">${escapeXml(text)}</Say>`;
  return `<Response><Pause length="1"/>${say}<Pause length="2"/>${say}</Response>`;
}

/** NTF-01: automated voice alert for emergencies detected outside the live bridge. */
export class TwilioVoiceAlert implements ChannelSender {
  constructor(
    private readonly cfg: TwilioRestConfig & { from: string; sayVoice: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(e: OutboxEntry): Promise<{ providerId: string }> {
    const body = new URLSearchParams({
      To: e.address,
      From: this.cfg.from,
      Twiml: alertTwiml(e.body, this.cfg.sayVoice),
      Timeout: '45',
      TimeLimit: '120',
    });
    return { providerId: await twilioPost(this.cfg, this.fetchFn, 'Calls', body) };
  }
}

export class SendGridEmail implements ChannelSender {
  constructor(
    private readonly cfg: { apiKey: string; from: string; fromName: string; apiBaseUrl?: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(e: OutboxEntry): Promise<{ providerId?: string }> {
    const res = await request(this.fetchFn, 'SendGrid', `${this.cfg.apiBaseUrl ?? 'https://api.sendgrid.com'}/v3/mail/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: e.address }] }],
        from: { email: this.cfg.from, name: this.cfg.fromName },
        subject: e.subject,
        content: [{ type: 'text/plain', value: e.body }],
        // Links go straight to the app, not through a click-tracking redirect.
        tracking_settings: { click_tracking: { enable: false, enable_text: false } },
      }),
    });
    if (res.ok) {
      const id = res.headers.get('x-message-id');
      return id ? { providerId: id } : {};
    }
    const json = (await res.json().catch(() => ({}))) as { errors?: { message?: string }[] };
    throw new DeliveryError(`SendGrid ${res.status}: ${json.errors?.[0]?.message ?? 'unknown error'}`, retryableStatus(res.status), String(res.status));
  }
}

export interface PushMessage {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  webpush?: { fcmOptions: { link: string } };
}

/** Tokens that will never work again; anything else from FCM is retried. */
const PERMANENT_FCM = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

export class FcmPush implements ChannelSender {
  constructor(private readonly sendFn: (m: PushMessage) => Promise<string>) {}

  async send(e: OutboxEntry): Promise<{ providerId: string }> {
    const link = e.body.match(/https:\/\/\S+/)?.[0];
    const message: PushMessage = {
      token: e.address,
      notification: { title: e.subject, body: e.body.split('\n').filter((l) => !l.includes('https://')).join('\n') },
      data: { caseId: e.caseId, urgency: e.urgency },
      ...(link ? { webpush: { fcmOptions: { link } } } : {}),
    };
    try {
      return { providerId: await this.sendFn(message) };
    } catch (err) {
      const code = (err as { code?: string }).code;
      throw new DeliveryError(`FCM: ${(err as Error).message}`, !(code && PERMANENT_FCM.has(code)), code);
    }
  }
}
