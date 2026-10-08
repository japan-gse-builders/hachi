import { parseSpendSettings, type Locale, type SpendSettings } from '@hachi/core';

export interface AnalyzerConfig {
  port: number;
  /** HTTPS origin of this service; the OIDC audience of its tasks. */
  publicBaseUrl: string;
  project: string;
  gemini: { location: string; model: string };
  /** Staff/family web app origin for links in notifications. */
  appBaseUrl: string;
  /** Language of the staff summary. Family summaries and detection texts are always English. */
  staffLocale: Locale;
  /** Notification worker origin; without it the worker's sweep sends the notifications. */
  notifierBaseUrl?: string;
  tasks: {
    location: string;
    queue: string;
    notifyQueue: string;
    invokerServiceAccount: string;
  };
  allowedCallers: string[];
  /** A claimed call is not taken over by another worker for this long. */
  leaseSec: number;
  /** Wait this long after the conversation ends, in case the media stream reconnects. */
  settleSec: number;
  /** After this many failed model attempts the call is analysed with the rule-based checks only. */
  modelAttempts: number;
  spend: SpendSettings;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const v = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return v;
}

function httpsOrigin(name: string, value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (u.protocol !== 'https:') throw new Error(`${name} must use https://`);
  return value.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv): AnalyzerConfig {
  const project = required(env, 'GOOGLE_CLOUD_PROJECT');
  const invoker = required(env, 'TASKS_INVOKER_SA');
  const notifier = env.NOTIFIER_BASE_URL?.trim();
  const staffLocale = env.STAFF_LOCALE?.trim() || 'en';
  if (staffLocale !== 'ja' && staffLocale !== 'en') throw new Error('STAFF_LOCALE must be ja or en');
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    publicBaseUrl: httpsOrigin('PUBLIC_BASE_URL', required(env, 'PUBLIC_BASE_URL')),
    project,
    gemini: {
      location: env.GEMINI_LOCATION?.trim() || 'global',
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    },
    appBaseUrl: httpsOrigin('APP_BASE_URL', env.APP_BASE_URL?.trim() || `https://${project}.web.app`),
    staffLocale,
    ...(notifier ? { notifierBaseUrl: httpsOrigin('NOTIFIER_BASE_URL', notifier) } : {}),
    tasks: {
      location: env.TASKS_LOCATION?.trim() || 'asia-northeast1',
      queue: env.ANALYSIS_QUEUE?.trim() || 'call-analysis',
      notifyQueue: env.NOTIFY_QUEUE?.trim() || 'notifications',
      invokerServiceAccount: invoker,
    },
    allowedCallers: (env.TASK_CALLER_EMAILS?.trim() || invoker).split(',').map((e) => e.trim()).filter(Boolean),
    leaseSec: int(env, 'ANALYSIS_LEASE_SEC', 300, 60, 1800),
    settleSec: int(env, 'ANALYSIS_SETTLE_SEC', 60, 0, 600),
    modelAttempts: int(env, 'MODEL_ATTEMPTS', 4, 1, 10),
    spend: parseSpendSettings(env),
  };
}
