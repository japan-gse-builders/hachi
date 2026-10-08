import { parseSpendSettings, type SpendSettings } from '@hachi/core';

export interface TelephonyConfig {
  port: number;
  /** Public HTTPS origin of this service; used for webhook URLs and signature checks. */
  publicBaseUrl: string;
  twilio: {
    accountSid: string;
    apiKeySid: string;
    apiKeySecret: string;
    authToken: string;
    voiceFrom: string;
    apiBaseUrl: string;
  };
  /** wss:// URL of the Voice Gateway. Until it exists, calls play a short test message. */
  voiceStreamUrl?: string;
  sayVoice: string;
  tasks: {
    project: string;
    location: string;
    callQueue: string;
    /** Service account Cloud Tasks uses to sign OIDC tokens when calling this service. */
    invokerServiceAccount: string;
  };
  /** Service accounts allowed to call /tasks/* (Cloud Scheduler and Cloud Tasks). */
  allowedCallers: string[];
  ringTimeoutSec: number;
  /**
   * Hard cap on the whole phone call, including an emergency bridge to family or staff.
   * The conversation itself is kept short by the Voice Gateway.
   */
  maxCallSec: number;
  maxAttempts: number;
  retryDelaySec: number;
  dispatchLookbackMin: number;
  /**
   * The conversation length the Voice Gateway enforces. Mirrored here only to reserve the right
   * amount of budget before dialing; the gateway remains the one that acts on it.
   */
  maxConversationSec: number;
  spend: SpendSettings;
}

const E164 = /^\+[1-9]\d{7,14}$/;

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

function httpsUrl(name: string, value: string, protocol: 'https:' | 'wss:'): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (u.protocol !== protocol) throw new Error(`${name} must use ${protocol.replace(':', '')}://`);
  return value.replace(/\/+$/, '');
}

/** Secrets (TWILIO_*) are injected by Cloud Run from Secret Manager; error messages never echo them. */
export function loadConfig(env: NodeJS.ProcessEnv): TelephonyConfig {
  const voiceFrom = required(env, 'TWILIO_VOICE_FROM');
  if (!E164.test(voiceFrom)) throw new Error('TWILIO_VOICE_FROM must be in E.164 format');
  const accountSid = required(env, 'TWILIO_ACCOUNT_SID');
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new Error('TWILIO_ACCOUNT_SID does not look like an Account SID');
  const apiKeySid = required(env, 'TWILIO_API_KEY_SID');
  if (!/^SK[0-9a-fA-F]{32}$/.test(apiKeySid)) throw new Error('TWILIO_API_KEY_SID does not look like an API key SID');
  const stream = env.VOICE_STREAM_URL?.trim();
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    publicBaseUrl: httpsUrl('PUBLIC_BASE_URL', required(env, 'PUBLIC_BASE_URL'), 'https:'),
    twilio: {
      accountSid,
      apiKeySid,
      apiKeySecret: required(env, 'TWILIO_API_KEY_SECRET'),
      authToken: required(env, 'TWILIO_AUTH_TOKEN'),
      voiceFrom,
      apiBaseUrl: httpsUrl('TWILIO_API_BASE_URL', env.TWILIO_API_BASE_URL?.trim() || 'https://api.twilio.com', 'https:'),
    },
    ...(stream ? { voiceStreamUrl: httpsUrl('VOICE_STREAM_URL', stream, 'wss:') } : {}),
    sayVoice: env.SAY_VOICE?.trim() || 'Google.en-US-Neural2-F',
    tasks: {
      project: required(env, 'GOOGLE_CLOUD_PROJECT'),
      location: env.TASKS_LOCATION?.trim() || 'asia-northeast1',
      callQueue: env.CALL_QUEUE?.trim() || 'outbound-calls',
      invokerServiceAccount: required(env, 'TASKS_INVOKER_SA'),
    },
    allowedCallers: required(env, 'TASK_CALLER_EMAILS')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    ringTimeoutSec: int(env, 'RING_TIMEOUT_SEC', 30, 10, 60),
    // The outer limit on the phone leg, not on the conversation: the Voice Gateway finishes talking
    // at MAX_CONVERSATION_SEC (8 minutes by default), and the rest of this is headroom for an
    // emergency conference with family and staff, which must not be cut off mid-sentence. Half an
    // hour of headroom was a backstop against nothing in particular; twenty minutes is still
    // generous for the conference and bounds what one stuck call can cost.
    maxCallSec: int(env, 'MAX_CALL_SEC', 1200, 60, 14400),
    maxAttempts: int(env, 'MAX_CALL_ATTEMPTS', 3, 1, 5),
    retryDelaySec: int(env, 'RETRY_DELAY_SEC', 180, 30, 3600),
    dispatchLookbackMin: int(env, 'DISPATCH_LOOKBACK_MIN', 10, 1, 50),
    maxConversationSec: int(env, 'MAX_CONVERSATION_SEC', 480, 90, 900),
    spend: parseSpendSettings(env),
  };
}
