import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reads the recordings bucket and defaults the port', () => {
    expect(loadConfig({ RECORDINGS_BUCKET: 'oct1-hachi-recordings' })).toEqual({
      port: 8080,
      recordingsBucket: 'oct1-hachi-recordings',
      corsOrigins: [],
    });
    expect(loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', WEB_ORIGINS: 'https://hachi.web.app, http://localhost:5173' }).corsOrigins).toEqual([
      'https://hachi.web.app',
      'http://localhost:5173',
    ]);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', WEB_ORIGINS: 'https://hachi.web.app/staff' })).toThrow(/without a path/);
    expect(loadConfig({ RECORDINGS_BUCKET: ' oct1-hachi-recordings ', PORT: '9000' }).port).toBe(9000);
  });

  it('fails fast on missing or invalid values', () => {
    expect(() => loadConfig({})).toThrow(/RECORDINGS_BUCKET is not set/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'gs://oct1-hachi-recordings' })).toThrow(/not a valid bucket/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'Upper-Case' })).toThrow(/not a valid bucket/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', PORT: 'abc' })).toThrow(/PORT is invalid/);
    expect(() => loadConfig({ RECORDINGS_BUCKET: 'ok-bucket', PORT: '70000' })).toThrow(/PORT is invalid/);
  });
});
