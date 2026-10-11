import { parseGatewayPolicy, parseSpendSettings } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads the recordings bucket and defaults the port', () => {
    expect(loadConfig({ RECORDINGS_BUCKET: 'oct1-hachi-recordings' })).toEqual({
      port: 8080,
      recordingsBucket: 'oct1-hachi-recordings',
      corsOrigins: [],
      spend: parseSpendSettings({}),
      gateway: parseGatewayPolicy({}),
    });
    expect(loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', WEB_ORIGINS: 'https://hachi.web.app, http://localhost:5173' }).corsOrigins).toEqual([
      'https://hachi.web.app',
      'http://localhost:5173',
    ]);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', WEB_ORIGINS: 'https://hachi.web.app/staff' })).toThrow(/without a path/);
    expect(loadConfig({ RECORDINGS_BUCKET: ' oct1-hachi-recordings ', PORT: '9000' }).port).toBe(9000);
  });

  it('turns on staff calls only with a telephony URL, and then needs the task signer', () => {
    const env = { RECORDINGS_BUCKET: 'ok-bucket', GOOGLE_CLOUD_PROJECT: 'proj', TASKS_INVOKER_SA: 'hachi-tasks@proj.iam.gserviceaccount.com' };
    expect(loadConfig(env).calls).toBeUndefined();
    expect(loadConfig({ ...env, TELEPHONY_BASE_URL: 'https://tel.example.run.app/' }).calls).toEqual({
      telephonyBaseUrl: 'https://tel.example.run.app',
      project: 'proj',
      location: 'asia-northeast1',
      queue: 'outbound-calls',
      invokerServiceAccount: 'hachi-tasks@proj.iam.gserviceaccount.com',
      cooldownMs: 600_000,
    });
    expect(loadConfig({ ...env, TELEPHONY_BASE_URL: 'https://t.example', STAFF_CALL_COOLDOWN_MIN: '0' }).calls!.cooldownMs).toBe(0);
    expect(() => loadConfig({ ...env, TELEPHONY_BASE_URL: 'http://t.example' })).toThrow(/https/);
    expect(() => loadConfig({ ...env, TELEPHONY_BASE_URL: 'https://t.example', TASKS_INVOKER_SA: '' })).toThrow(/TASKS_INVOKER_SA/);
    expect(() => loadConfig({ ...env, TELEPHONY_BASE_URL: 'https://t.example', STAFF_CALL_COOLDOWN_MIN: '-1' })).toThrow(/COOLDOWN/);
  });

  it('fails fast on missing or invalid values', () => {
    expect(() => loadConfig({})).toThrow(/RECORDINGS_BUCKET is not set/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'gs://oct1-hachi-recordings' })).toThrow(/not a valid bucket/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'Upper-Case' })).toThrow(/not a valid bucket/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', PORT: 'abc' })).toThrow(/PORT is invalid/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', PORT: '70000' })).toThrow(/PORT is invalid/);
  });
});
