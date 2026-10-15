import type { ExportSettings } from './worker.js';

export interface AnalyticsConfig extends ExportSettings {
  project: string; topic: string; port: number; publicBaseUrl: string; allowedCallers: string[];
}
function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number) {
  const value = Number(env[key] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv): AnalyticsConfig {
  const project = required(env, 'GOOGLE_CLOUD_PROJECT');
  const topic = required(env, 'ANALYTICS_TOPIC');
  if (!/^[a-zA-Z][a-zA-Z0-9._~+%-]{2,254}$/.test(topic)) throw new Error('ANALYTICS_TOPIC must be a topic ID');
  const publicBaseUrl = required(env, 'PUBLIC_BASE_URL').replace(/\/+$/, '');
  const url = new URL(publicBaseUrl);
  if (url.protocol !== 'https:' || url.origin !== publicBaseUrl) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin');
  const allowedCallers = required(env, 'ANALYTICS_INVOKER_SA').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowedCallers.length || allowedCallers.some((s) => !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(s))) {
    throw new Error('ANALYTICS_INVOKER_SA must list service account emails');
  }
  const orgIds = required(env, 'ANALYTICS_ORG_IDS').split(',').map((s) => s.trim()).filter(Boolean);
  if (!orgIds.length || orgIds.includes('*')) throw new Error('List specific ANALYTICS_ORG_IDS');
  const real = env.ANALYTICS_INCLUDE_REAL_DATA?.trim() || 'false';
  if (real !== 'true' && real !== 'false') throw new Error('ANALYTICS_INCLUDE_REAL_DATA must be true or false');
  return { project, topic, publicBaseUrl, allowedCallers, orgIds, includeRealData: real === 'true',
    port: integer(env, 'PORT', 8080, 65535), lookbackDays: integer(env, 'ANALYTICS_LOOKBACK_DAYS', 30, 90),
    pageSize: integer(env, 'ANALYTICS_PAGE_SIZE', 100, 500), maxPages: integer(env, 'ANALYTICS_MAX_PAGES', 5, 100) };
}
