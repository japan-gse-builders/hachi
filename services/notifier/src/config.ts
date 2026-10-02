export interface NotifierConfig {
  port: number;
  /** HTTPS origin of this service; the OIDC audience of its tasks. */
  publicBaseUrl: string;
  twilio: {
    accountSid: string;
    apiKeySid: string;
    apiKeySecret: string;
    apiBaseUrl: string;
    smsFrom: string;
    voiceFrom: string;
  };
  /** SMS is only sent to numbers with these prefixes (Japan only during the MVP). */
  smsAllowedPrefixes: string[];
  sayVoice: string;
  /** Email is skipped until a SendGrid key and a verified sender are configured. */
  email?: { apiKey: string; from: string; fromName: string };
  tasks: {
    project: string;
    location: string;
    queue: string;
    invokerServiceAccount: string;
  };
  allowedCallers: string[];
  /** Attempts per entry before it is marked failed. */
  maxAttempts: number;
  /** A claimed entry is not taken over by another worker for this long. */
  leaseSec: number;
  /** The sweep only re-queues entries untouched for this long, so it does not race the normal retries. */
  sweepAgeSec: number;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function phone(env: NodeJS.ProcessEnv, name: string): string {
  const v = required(env, name);
  if (!E164.test(v)) throw new Error(`${name} must be an E.164 number such as +819012345678`);
  return v;
}

/** Secrets (TWILIO_*, SENDGRID_API_KEY) are injected by Cloud Run from Secret Manager; errors never echo them. */
export function loadConfig(env: NodeJS.ProcessEnv): NotifierConfig {
  const apiKey = env.SENDGRID_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (from && !EMAIL.test(from)) throw new Error('EMAIL_FROM is not a valid email address');
  const prefixes = (env.SMS_ALLOWED_PREFIXES ?? '+81').split(',').map((p) => p.trim()).filter(Boolean);
  if (!prefixes.length || prefixes.some((p) => !/^\+\d{1,4}$/.test(p))) throw new Error('SMS_ALLOWED_PREFIXES must be country codes such as +81');
  const invoker = required(env, 'TASKS_INVOKER_SA');
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    publicBaseUrl: httpsOrigin('PUBLIC_BASE_URL', required(env, 'PUBLIC_BASE_URL')),
    twilio: {
      accountSid: required(env, 'TWILIO_ACCOUNT_SID'),
      apiKeySid: required(env, 'TWILIO_API_KEY_SID'),
      apiKeySecret: required(env, 'TWILIO_API_KEY_SECRET'),
      apiBaseUrl: httpsOrigin('TWILIO_API_BASE_URL', env.TWILIO_API_BASE_URL?.trim() || 'https://api.twilio.com'),
      smsFrom: phone(env, 'TWILIO_SMS_FROM'),
      voiceFrom: phone(env, 'TWILIO_VOICE_FROM'),
    },
    smsAllowedPrefixes: prefixes,
    sayVoice: env.SAY_VOICE?.trim() || 'Google.en-US-Neural2-F',
    ...(apiKey && from ? { email: { apiKey, from, fromName: env.EMAIL_FROM_NAME?.trim() || 'Hachi' } } : {}),
    tasks: {
      project: required(env, 'GOOGLE_CLOUD_PROJECT'),
      location: env.TASKS_LOCATION?.trim() || 'asia-northeast1',
      queue: env.NOTIFY_QUEUE?.trim() || 'notifications',
      invokerServiceAccount: invoker,
    },
    allowedCallers: (env.TASK_CALLER_EMAILS?.trim() || invoker).split(',').map((e) => e.trim()).filter(Boolean),
    maxAttempts: int(env, 'MAX_DELIVERY_ATTEMPTS', 8, 1, 20),
    leaseSec: int(env, 'DELIVERY_LEASE_SEC', 60, 10, 600),
    sweepAgeSec: int(env, 'SWEEP_AGE_SEC', 120, 30, 3600),
  };
}
