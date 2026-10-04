import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  PUBLIC_BASE_URL: 'https://hachi-notifier.example.run.app/',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_API_KEY_SID: 'SK123',
  TWILIO_API_KEY_SECRET: 'test-secret',
  TWILIO_SMS_FROM: '+19787559139',
  TWILIO_VOICE_FROM: '+18664289155',
  GOOGLE_CLOUD_PROJECT: 'hachi-test',
  TASKS_INVOKER_SA: 'hachi-tasks@hachi-test.iam.gserviceaccount.com',
};

describe('loadConfig', () => {
  it('applies defaults and leaves email off without SendGrid settings', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      port: 8080,
      publicBaseUrl: 'https://hachi-notifier.example.run.app',
      twilio: { smsFrom: '+19787559139', voiceFrom: '+18664289155', apiBaseUrl: 'https://api.twilio.com' },
      smsAllowedPrefixes: ['+81'],
      tasks: { project: 'hachi-test', location: 'asia-northeast1', queue: 'notifications' },
      allowedCallers: [base.TASKS_INVOKER_SA],
      maxAttempts: 8,
      leaseSec: 60,
      sweepAgeSec: 120,
    });
    expect(c.email).toBeUndefined();
    expect(c.twilio.statusCallbackBaseUrl).toBeUndefined();
  });

  it('sends delivery reports to the telephony service when configured', () => {
    const c = loadConfig({ ...base, STATUS_CALLBACK_BASE_URL: 'https://hachi-telephony.example.run.app/' });
    expect(c.twilio.statusCallbackBaseUrl).toBe('https://hachi-telephony.example.run.app');
    expect(() => loadConfig({ ...base, STATUS_CALLBACK_BASE_URL: 'http://plain.example' })).toThrow(/STATUS_CALLBACK_BASE_URL must use https/);
  });

  it('enables email when both the key and the sender are set', () => {
    expect(loadConfig({ ...base, SENDGRID_API_KEY: 'k' }).email).toBeUndefined();
    expect(loadConfig({ ...base, SENDGRID_API_KEY: 'k', EMAIL_FROM: 'alerts@example.org' }).email).toEqual({
      apiKey: 'k',
      from: 'alerts@example.org',
      fromName: 'Hachi',
    });
  });

  it('reads overrides', () => {
    const c = loadConfig({
      ...base,
      SMS_ALLOWED_PREFIXES: '+81, +1',
      TASK_CALLER_EMAILS: 'a@x.iam.gserviceaccount.com,b@x.iam.gserviceaccount.com',
      NOTIFY_QUEUE: 'n2',
      MAX_DELIVERY_ATTEMPTS: '5',
      EMAIL_FROM_NAME: 'Hachi Care',
      SENDGRID_API_KEY: 'k',
      EMAIL_FROM: 'alerts@example.org',
    });
    expect(c.smsAllowedPrefixes).toEqual(['+81', '+1']);
    expect(c.allowedCallers).toHaveLength(2);
    expect(c.tasks.queue).toBe('n2');
    expect(c.maxAttempts).toBe(5);
    expect(c.email?.fromName).toBe('Hachi Care');
  });

  it.each([
    [{ PUBLIC_BASE_URL: 'http://x.example' }, /https/],
    [{ PUBLIC_BASE_URL: 'nope' }, /valid URL/],
    [{ TWILIO_SMS_FROM: '978-755-9139' }, /TWILIO_SMS_FROM must be an E.164/],
    [{ TWILIO_VOICE_FROM: undefined }, /TWILIO_VOICE_FROM is not set/],
    [{ TWILIO_API_KEY_SECRET: '' }, /TWILIO_API_KEY_SECRET/],
    [{ EMAIL_FROM: 'not-an-email' }, /EMAIL_FROM/],
    [{ SMS_ALLOWED_PREFIXES: '81' }, /SMS_ALLOWED_PREFIXES/],
    [{ SMS_ALLOWED_PREFIXES: ' , ' }, /SMS_ALLOWED_PREFIXES/],
    [{ MAX_DELIVERY_ATTEMPTS: '0' }, /MAX_DELIVERY_ATTEMPTS/],
    [{ DELIVERY_LEASE_SEC: '5' }, /DELIVERY_LEASE_SEC/],
  ])('rejects %o', (override, error) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(error);
  });

  it('never echoes secrets in errors', () => {
    try {
      loadConfig({ ...base, PORT: 'x' });
    } catch (err) {
      expect((err as Error).message).not.toContain('test-secret');
    }
  });
});
