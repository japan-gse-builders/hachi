import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  GOOGLE_CLOUD_PROJECT: 'hachi-test',
  RECORDINGS_BUCKET: 'hachi-recordings',
  TELEPHONY_BASE_URL: 'https://telephony.example.run.app/',
  TASKS_INVOKER_SA: 'hachi-tasks@hachi-test.iam.gserviceaccount.com',
};

describe('loadConfig', () => {
  it('keeps automatic turn detection at its defaults unless explicitly configured', () => {
    expect(loadConfig(base).gemini.activityDetection).toBeUndefined();
    expect(loadConfig({ ...base, LIVE_SILENCE_MS: ' ', LIVE_END_OF_SPEECH_SENSITIVITY: '' }).gemini.activityDetection).toBeUndefined();
    expect(loadConfig({ ...base, LIVE_SILENCE_MS: '2500', LIVE_END_OF_SPEECH_SENSITIVITY: 'low' }).gemini.activityDetection).toEqual({
      silenceDurationMs: 2500, endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
    });
    expect(loadConfig({ ...base, LIVE_END_OF_SPEECH_SENSITIVITY: 'HIGH' }).gemini.activityDetection).toEqual({ endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH' });
  });

  it.each(['499', '2501', '850.5', 'no', 'Infinity'])('rejects LIVE_SILENCE_MS=%s', (value) => {
    expect(() => loadConfig({ ...base, LIVE_SILENCE_MS: value })).toThrow(/LIVE_SILENCE_MS/);
  });

  it('validates sensitivity and the stepped silence intervals', () => {
    expect(() => loadConfig({ ...base, LIVE_END_OF_SPEECH_SENSITIVITY: 'medium' })).toThrow(/must be low or high/);
    expect(loadConfig({ ...base, SILENCE_PROMPT_INTERVALS_SEC: '3:6:10' }).silence).toEqual({ promptSec: 10, prompts: 3, intervalsSec: [3, 6, 10] });
    for (const value of ['0:4:5', '2.5::5', '2.5:4:121', 'no', '1:2:3:4:5:6']) {
      expect(() => loadConfig({ ...base, SILENCE_PROMPT_INTERVALS_SEC: value })).toThrow(/SILENCE_PROMPT_INTERVALS_SEC/);
    }
    expect(() => loadConfig({ ...base, SILENCE_PROMPT_INTERVALS_SEC: '2.5:4:5', SILENCE_PROMPTS: '2' })).toThrow(/not both/);
  });
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      project: 'hachi-test',
      gemini: { location: 'us-central1', model: 'gemini-3.8-live', voice: 'Aoede' },
      recordingsBucket: 'hachi-recordings',
      telephonyBaseUrl: 'https://telephony.example.run.app',
      appBaseUrl: 'https://hachi-test.web.app',
      tasks: { location: 'asia-northeast1', emergencyQueue: 'emergency-calls', notifyQueue: 'notifications', analysisQueue: 'call-analysis', invokerServiceAccount: base.TASKS_INVOKER_SA },
      maxConversationSec: 480,
      silence: { promptSec: 5, prompts: 3, intervalsSec: [2.5, 4, 5] },
      gateway: { transientFailures: 3, cooldownMs: 900_000, probeStaleMs: 3_600_000 },
    });
  });

  it('reads overrides', () => {
    const c = loadConfig({
      ...base,
      PORT: '9000',
      GEMINI_LOCATION: 'us',
      GEMINI_MODEL: 'other-model',
      GEMINI_VOICE: 'Kore',
      APP_BASE_URL: 'https://app.example.org',
      TASKS_LOCATION: 'us-central1',
      EMERGENCY_QUEUE: 'urgent',
      MAX_CONVERSATION_SEC: '600',
      SILENCE_PROMPT_SEC: '20',
      SILENCE_PROMPTS: '1',
      NOTIFIER_BASE_URL: 'https://notifier.example/',
      NOTIFY_QUEUE: 'n2',
      ANALYZER_BASE_URL: 'https://analyzer.example/',
      ANALYSIS_QUEUE: 'a2',
    });
    expect(c.notifierBaseUrl).toBe('https://notifier.example');
    expect(c.analyzerBaseUrl).toBe('https://analyzer.example');
    expect(c.tasks.notifyQueue).toBe('n2');
    expect(c.tasks.analysisQueue).toBe('a2');
    expect(c.port).toBe(9000);
    expect(c.gemini).toEqual({ location: 'us', model: 'other-model', voice: 'Kore' });
    expect(c.appBaseUrl).toBe('https://app.example.org');
    expect(c.tasks.location).toBe('us-central1');
    expect(c.tasks.emergencyQueue).toBe('urgent');
    expect(c.maxConversationSec).toBe(600);
    expect(c.silence).toEqual({ promptSec: 20, prompts: 1 });
  });

  it('leaves the forced drop out unless it names a resident and a delay', () => {
    // Absent, not false: every deployment that is not being tested must not carry the field at all.
    expect(loadConfig(base).forcedLiveDrop).toBeUndefined();
    expect(loadConfig({ ...base, FORCE_LIVE_DROP: '  ' }).forcedLiveDrop).toBeUndefined();
    expect(loadConfig({ ...base, FORCE_LIVE_DROP: 'test-02102026160456:20' }).forcedLiveDrop).toEqual({
      residentId: 'test-02102026160456',
      afterSec: 20,
    });
  });

  it.each([['20'], ['res-1'], ['res-1:'], ['res-1:4'], ['res-1:121'], [':20'], ['res 1:20'], ['res-1:20:30']])(
    'refuses to start on FORCE_LIVE_DROP=%s rather than quietly doing nothing',
    (value) => {
      expect(() => loadConfig({ ...base, FORCE_LIVE_DROP: value })).toThrow(/FORCE_LIVE_DROP/);
    },
  );

  it.each([
    [{ GOOGLE_CLOUD_PROJECT: '' }, /GOOGLE_CLOUD_PROJECT/],
    [{ RECORDINGS_BUCKET: undefined }, /RECORDINGS_BUCKET is not set/],
    [{ RECORDINGS_BUCKET: 'Bad_Bucket!' }, /not a valid bucket/],
    [{ TELEPHONY_BASE_URL: 'http://telephony.example' }, /https/],
    [{ TELEPHONY_BASE_URL: 'not a url' }, /valid URL/],
    [{ APP_BASE_URL: 'http://app.example' }, /APP_BASE_URL must use https/],
    [{ NOTIFIER_BASE_URL: 'http://notifier.example' }, /NOTIFIER_BASE_URL must use https/],
    [{ ANALYZER_BASE_URL: 'http://analyzer.example' }, /ANALYZER_BASE_URL must use https/],
    [{ TASKS_INVOKER_SA: ' ' }, /TASKS_INVOKER_SA/],
    [{ PORT: '0' }, /PORT/],
    [{ MAX_CONVERSATION_SEC: '60' }, /MAX_CONVERSATION_SEC/],
    [{ MAX_CONVERSATION_SEC: '1000' }, /MAX_CONVERSATION_SEC/],
    [{ MAX_CONVERSATION_SEC: '5.5' }, /MAX_CONVERSATION_SEC/],
  ])('rejects %o', (override, error) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(error);
  });
});
