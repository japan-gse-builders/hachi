export interface GatewayConfig {
  port: number;
  project: string;
  gemini: {
    /** The Live model is not offered in Tokyo; us-central1 is the closest supported region. */
    location: string;
    model: string;
    voice: string;
  };
  recordingsBucket: string;
  /** Telephony service origin; emergency-transfer tasks are sent there. */
  telephonyBaseUrl: string;
  /** Staff/family web app origin for links in notifications. */
  appBaseUrl: string;
  /** Notification worker origin; emergency SMS/email are queued there immediately (NTF-01). */
  notifierBaseUrl?: string;
  /** Analysis worker origin; finished calls are queued there. */
  analyzerBaseUrl?: string;
  tasks: {
    location: string;
    emergencyQueue: string;
    notifyQueue: string;
    analysisQueue: string;
    invokerServiceAccount: string;
  };
  /** The AI wraps up shortly before this and hangs up at it. */
  maxConversationSec: number;
  silence: {
    /** Quiet for this long after Hachi finishes speaking and it checks whether they are still there. */
    promptSec: number;
    /** How many times it checks before accepting that nobody is answering. */
    prompts: number;
  };
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

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const project = required(env, 'GOOGLE_CLOUD_PROJECT');
  const bucket = required(env, 'RECORDINGS_BUCKET');
  const notifier = env.NOTIFIER_BASE_URL?.trim();
  const analyzer = env.ANALYZER_BASE_URL?.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('RECORDINGS_BUCKET is not a valid bucket name');
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    project,
    gemini: {
      location: env.GEMINI_LOCATION?.trim() || 'us-central1',
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.8-live',
      voice: env.GEMINI_VOICE?.trim() || 'Aoede',
    },
    recordingsBucket: bucket,
    telephonyBaseUrl: httpsOrigin('TELEPHONY_BASE_URL', required(env, 'TELEPHONY_BASE_URL')),
    appBaseUrl: httpsOrigin('APP_BASE_URL', env.APP_BASE_URL?.trim() || `https://${project}.web.app`),
    ...(notifier ? { notifierBaseUrl: httpsOrigin('NOTIFIER_BASE_URL', notifier) } : {}),
    ...(analyzer ? { analyzerBaseUrl: httpsOrigin('ANALYZER_BASE_URL', analyzer) } : {}),
    tasks: {
      location: env.TASKS_LOCATION?.trim() || 'asia-northeast1',
      emergencyQueue: env.EMERGENCY_QUEUE?.trim() || 'emergency-calls',
      notifyQueue: env.NOTIFY_QUEUE?.trim() || 'notifications',
      analysisQueue: env.ANALYSIS_QUEUE?.trim() || 'call-analysis',
      invokerServiceAccount: required(env, 'TASKS_INVOKER_SA'),
    },
    maxConversationSec: int(env, 'MAX_CONVERSATION_SEC', 480, 90, 900),
    silence: {
      // Long enough that an older adult who needs a moment to find their words is not cut off, short
      // enough that a call nobody is answering does not bill eight minutes of live audio.
      promptSec: int(env, 'SILENCE_PROMPT_SEC', 12, 5, 120),
      prompts: int(env, 'SILENCE_PROMPTS', 2, 1, 5),
    },
  };
}
