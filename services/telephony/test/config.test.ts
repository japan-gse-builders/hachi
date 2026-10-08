import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const env = {
    PUBLIC_BASE_URL: 'https://telephony.example.run.app/',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'key-secret-value',
    TWILIO_AUTH_TOKEN: 'auth-token-value',
    TWILIO_VOICE_FROM: '+15005550006',
    GOOGLE_CLOUD_PROJECT: 'hachi-prod',
    TASKS_INVOKER_SA: 'tasks@hachi-prod.iam.gserviceaccount.com',
    TASK_CALLER_EMAILS: 'Tasks@hachi-prod.iam.gserviceaccount.com, scheduler@hachi-prod.iam.gserviceaccount.com',
  };

  it('applies defaults', () => {
    const c = loadConfig(env);
    expect(c.publicBaseUrl).toBe('https://telephony.example.run.app');
    expect(c.twilio.apiBaseUrl).toBe('https://api.twilio.com');
    expect(c.voiceStreamUrl).toBeUndefined();
    expect(c.tasks).toMatchObject({ location: 'asia-northeast1', callQueue: 'outbound-calls' });
    expect(c.allowedCallers).toEqual(['tasks@hachi-prod.iam.gserviceaccount.com', 'scheduler@hachi-prod.iam.gserviceaccount.com']);
    expect(c).toMatchObject({ port: 8080, ringTimeoutSec: 30, maxCallSec: 1200, maxAttempts: 3, retryDelaySec: 180, dispatchLookbackMin: 10 });
    expect(c.sayVoice).toBe('Google.en-US-Neural2-F');
    expect(c.gateway).toEqual({ transientFailures: 3, cooldownMs: 900_000 });
  });

  it('reads optional settings', () => {
    const c = loadConfig({
      ...env,
      VOICE_STREAM_URL: 'wss://gw.example/stream',
      MAX_CALL_SEC: '300',
      TWILIO_API_BASE_URL: 'https://api.tokyo.us1.twilio.com',
      GATEWAY_COOLDOWN_SEC: '600',
    });
    expect(c.voiceStreamUrl).toBe('wss://gw.example/stream');
    expect(c.maxCallSec).toBe(300);
    expect(c.twilio.apiBaseUrl).toBe('https://api.tokyo.us1.twilio.com');
    expect(c.gateway.cooldownMs).toBe(600_000);
  });

  it('fails fast without echoing secret values', () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ TWILIO_AUTH_TOKEN: '' }, /TWILIO_AUTH_TOKEN is not set/],
      [{ TWILIO_VOICE_FROM: '0120-000-000' }, /E\.164/],
      [{ TWILIO_ACCOUNT_SID: 'ACnope' }, /Account SID/],
      [{ TWILIO_API_KEY_SID: 'SKnope' }, /API key SID/],
      [{ PUBLIC_BASE_URL: 'http://insecure.example' }, /must use https/],
      [{ PUBLIC_BASE_URL: 'not a url' }, /not a valid URL/],
      [{ VOICE_STREAM_URL: 'https://gw.example' }, /must use wss/],
      [{ MAX_CALL_SEC: '99999' }, /MAX_CALL_SEC/],
      [{ GATEWAY_COOLDOWN_SEC: '0' }, /GATEWAY_COOLDOWN_SEC/],
      [{ GATEWAY_TRANSIENT_FAILURES: '0' }, /GATEWAY_TRANSIENT_FAILURES/],
      [{ RING_TIMEOUT_SEC: 'abc' }, /RING_TIMEOUT_SEC/],
    ];
    for (const [patch, re] of cases) {
      let message = '';
      try {
        loadConfig({ ...env, ...patch });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(re);
      expect(message).not.toContain('key-secret-value');
      expect(message).not.toContain('auth-token-value');
    }
  });
});
