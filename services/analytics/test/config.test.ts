import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const env = { GOOGLE_CLOUD_PROJECT: 'demo-hachi', ANALYTICS_TOPIC: 'hachi-call-outcomes-v1',
  PUBLIC_BASE_URL: 'https://analytics.example.run.app',
  ANALYTICS_INVOKER_SA: 'hachi-analytics-scheduler@demo-hachi.iam.gserviceaccount.com', ANALYTICS_ORG_IDS: 'org-1, org-2' };
describe('analytics configuration', () => {
  it('defaults to synthetic-only, bounded scans with explicit organization access', () => {
    expect(loadConfig(env)).toMatchObject({ orgIds: ['org-1', 'org-2'], includeRealData: false,
      pageSize: 100, maxPages: 5, lookbackDays: 30, port: 8080 });
    expect(loadConfig({ ...env, ANALYTICS_INCLUDE_REAL_DATA: 'true' }).includeRealData).toBe(true);
  });
  it.each(Object.keys(env))('requires %s', (key) => {
    expect(() => loadConfig({ ...env, [key]: '' })).toThrow();
  });
  it.each([
    ['ANALYTICS_ORG_IDS', '*'], ['ANALYTICS_ORG_IDS', ','], ['ANALYTICS_INVOKER_SA', ','],
    ['ANALYTICS_INVOKER_SA', 'person@example.com'], ['ANALYTICS_TOPIC', 'projects/p/topics/t'],
    ['PUBLIC_BASE_URL', 'http://example.com'], ['PUBLIC_BASE_URL', 'https://example.com/tasks/export'],
    ['ANALYTICS_INCLUDE_REAL_DATA', 'yes'], ['ANALYTICS_LOOKBACK_DAYS', '91'],
    ['ANALYTICS_PAGE_SIZE', '0'], ['ANALYTICS_MAX_PAGES', '1.5'], ['PORT', '65536'],
  ])('rejects invalid %s = %s', (key, value) => {
    expect(() => loadConfig({ ...env, [key!]: value })).toThrow();
  });
});
