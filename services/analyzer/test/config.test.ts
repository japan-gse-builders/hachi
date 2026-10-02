import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  PUBLIC_BASE_URL: 'https://hachi-analyzer.example.run.app/',
  GOOGLE_CLOUD_PROJECT: 'hachi-test',
  TASKS_INVOKER_SA: 'hachi-tasks@hachi-test.iam.gserviceaccount.com',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      publicBaseUrl: 'https://hachi-analyzer.example.run.app',
      project: 'hachi-test',
      gemini: { location: 'global', model: 'gemini-3.8-flash' },
      appBaseUrl: 'https://hachi-test.web.app',
      staffLocale: 'en',
      tasks: { location: 'asia-northeast1', queue: 'call-analysis', notifyQueue: 'notifications', invokerServiceAccount: base.TASKS_INVOKER_SA },
      allowedCallers: [base.TASKS_INVOKER_SA],
      leaseSec: 300,
      settleSec: 60,
      modelAttempts: 4,
    });
  });

  it('reads overrides', () => {
    const c = loadConfig({
      ...base,
      PORT: '9000',
      GEMINI_LOCATION: 'asia-northeast1',
      GEMINI_MODEL: 'gemini-3.8-pro',
      APP_BASE_URL: 'https://app.example',
      STAFF_LOCALE: 'ja',
      NOTIFIER_BASE_URL: 'https://notifier.example/',
      ANALYSIS_QUEUE: 'q',
      NOTIFY_QUEUE: 'n',
      TASKS_LOCATION: 'us-central1',
      TASK_CALLER_EMAILS: 'a@x.iam.gserviceaccount.com, b@x.iam.gserviceaccount.com',
      ANALYSIS_LEASE_SEC: '120',
      ANALYSIS_SETTLE_SEC: '0',
      MODEL_ATTEMPTS: '2',
    });
    expect(c).toMatchObject({
      port: 9000,
      gemini: { location: 'asia-northeast1', model: 'gemini-3.8-pro' },
      appBaseUrl: 'https://app.example',
      staffLocale: 'ja',
      notifierBaseUrl: 'https://notifier.example',
      tasks: { location: 'us-central1', queue: 'q', notifyQueue: 'n' },
      allowedCallers: ['a@x.iam.gserviceaccount.com', 'b@x.iam.gserviceaccount.com'],
      leaseSec: 120,
      settleSec: 0,
      modelAttempts: 2,
    });
  });

  it('rejects missing or invalid settings', () => {
    for (const name of ['PUBLIC_BASE_URL', 'GOOGLE_CLOUD_PROJECT', 'TASKS_INVOKER_SA'] as const) {
      expect(() => loadConfig({ ...base, [name]: '' })).toThrow(`${name} is not set`);
    }
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'http://x.example' })).toThrow('https');
    expect(() => loadConfig({ ...base, NOTIFIER_BASE_URL: 'not a url' })).toThrow('not a valid URL');
    expect(() => loadConfig({ ...base, STAFF_LOCALE: 'fr' })).toThrow('STAFF_LOCALE');
    expect(() => loadConfig({ ...base, MODEL_ATTEMPTS: '0' })).toThrow('MODEL_ATTEMPTS');
    expect(() => loadConfig({ ...base, ANALYSIS_LEASE_SEC: '1.5' })).toThrow('ANALYSIS_LEASE_SEC');
  });
});
