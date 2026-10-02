import { createHmac, timingSafeEqual } from 'node:crypto';

export class TelephonyError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'TelephonyError';
  }
}

export interface PlaceCallRequest {
  to: string;
  from: string;
  twiml: string;
  statusCallbackUrl?: string;
  ringTimeoutSec: number;
  maxCallSec: number;
}

export interface TelephonyProvider {
  placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }>;
}

export interface TwilioCredentials {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  apiBaseUrl: string;
}

type FetchFn = typeof fetch;

/** Minimal Twilio REST client: one endpoint, no SDK, so cold starts stay small. */
export class TwilioVoice implements TelephonyProvider {
  constructor(
    private readonly creds: TwilioCredentials,
    private readonly fetchFn: FetchFn = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    const body = new URLSearchParams({
      To: req.to,
      From: req.from,
      Twiml: req.twiml,
      Timeout: String(req.ringTimeoutSec),
      TimeLimit: String(req.maxCallSec),
    });
    if (req.statusCallbackUrl) {
      body.set('StatusCallback', req.statusCallbackUrl);
      body.set('StatusCallbackMethod', 'POST');
      for (const e of ['initiated', 'ringing', 'answered', 'completed']) body.append('StatusCallbackEvent', e);
    }

    const url = `${this.creds.apiBaseUrl}/2010-04-01/Accounts/${this.creds.accountSid}/Calls.json`;
    const auth = Buffer.from(`${this.creds.apiKeySid}:${this.creds.apiKeySecret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new TelephonyError(`Twilio request failed: ${(err as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (res.ok && json.sid) return { providerCallId: json.sid };
    const retryable = res.status >= 500 || res.status === 429;
    throw new TelephonyError(`Twilio ${res.status}: ${json.message ?? 'unknown error'}`, retryable, json.code?.toString());
  }
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export interface TwimlInput {
  residentId: string;
  callId: string;
  preferredName: string;
  streamUrl?: string;
  /** Required with streamUrl. */
  streamToken?: string;
  /** Twilio fetches this when the media stream ends; required with streamUrl. */
  afterStreamUrl?: string;
  sayVoice: string;
}

/**
 * Bridges the call to the Voice Gateway. When the gateway closes the stream, Twilio continues
 * with <Redirect>, so this service decides what happens next (hang up, emergency bridge, reconnect).
 */
export function streamTwiml(i: Required<Pick<TwimlInput, 'residentId' | 'callId' | 'streamUrl' | 'streamToken' | 'afterStreamUrl'>>): string {
  return (
    `<Response><Connect><Stream url="${escapeXml(i.streamUrl)}">` +
    `<Parameter name="residentId" value="${escapeXml(i.residentId)}"/>` +
    `<Parameter name="callId" value="${escapeXml(i.callId)}"/>` +
    `<Parameter name="streamToken" value="${escapeXml(i.streamToken)}"/>` +
    `</Stream></Connect>` +
    `<Redirect method="POST">${escapeXml(i.afterStreamUrl)}</Redirect></Response>`
  );
}

/**
 * With a Voice Gateway URL the call is bridged to it over a bidirectional Media Stream.
 * Without one, a short test message is played (still disclosing that this is an AI, CNV-02).
 */
export function buildCallTwiml(i: TwimlInput): string {
  if (i.streamUrl && i.streamToken && i.afterStreamUrl) {
    return streamTwiml({ ...i, streamUrl: i.streamUrl, streamToken: i.streamToken, afterStreamUrl: i.afterStreamUrl });
  }
  const text =
    `Hello ${i.preferredName}. This is Hachi, an AI assistant, calling to check in on you. ` +
    'This is a test call, so there is nothing you need to do. Have a lovely day. Goodbye.';
  return `<Response><Say voice="${escapeXml(i.sayVoice)}" language="en-US">${escapeXml(text)}</Say></Response>`;
}

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)).
 * The algorithm is fixed by Twilio; we only verify it, in constant time.
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function isValidTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
