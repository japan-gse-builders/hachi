import { EndSensitivity, type AutomaticActivityDetection } from '@google/genai';
import { parseGatewayPolicy, type GatewayPolicy } from '@hachi/core';

export interface GatewayConfig {
  port: number;
  project: string;
  gemini: {
    /** The Live model is not offered in Tokyo; us-central1 is the closest supported region. */
    location: string;
    model: string;
    voice: string;
    /** Omitted unless configured, preserving the model's automatic VAD defaults. */
    activityDetection?: AutomaticActivityDetection;
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
    /** Successive waits after playback; the last wait also follows the final prompt. */
    intervalsSec?: number[];
  };
  /**
   * Set only to find out whether session resumption works, by closing the Live socket mid-call the
   * way the network would. A healthy websocket does not drop, so there is otherwise no way to
   * exercise the reconnect against the server that has to honour the handle.
   *
   * The resident it applies to and the delay are one value rather than two variables, because the
   * danger here is not the feature, it is the variable outliving the test. Carried together, the
   * worst a forgotten setting can do is interrupt the one id written into it, and that id is chosen
   * by whoever runs the test, not by whoever is on the phone.
   */
  forcedLiveDrop?: { residentId: string; afterSec: number };
  /**
   * The breaker, read here as well as in telephony. Telephony reads it to decide whether a phone
   * may ring; this service reads it to decide how often to find out whether it still should be
   * tripped, and the two have to agree on the cooldown or one of them is testing against a window
   * the other is not honouring.
   */
  gateway: GatewayPolicy;
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

function activityDetection(env: NodeJS.ProcessEnv): AutomaticActivityDetection | undefined {
  const rawMs = env.LIVE_SILENCE_MS?.trim();
  const rawSensitivity = env.LIVE_END_OF_SPEECH_SENSITIVITY?.trim().toLowerCase();
  if (!rawMs && !rawSensitivity) return undefined;
  const result: AutomaticActivityDetection = {};
  if (rawMs) result.silenceDurationMs = int({ LIVE_SILENCE_MS: rawMs }, 'LIVE_SILENCE_MS', 500, 500, 2500);
  if (rawSensitivity) {
    if (rawSensitivity !== 'low' && rawSensitivity !== 'high') throw new Error('LIVE_END_OF_SPEECH_SENSITIVITY must be low or high');
    result.endOfSpeechSensitivity = rawSensitivity === 'low' ? EndSensitivity.END_SENSITIVITY_LOW : EndSensitivity.END_SENSITIVITY_HIGH;
  }
  return result;
}

function silenceConfig(env: NodeJS.ProcessEnv): GatewayConfig['silence'] {
  const raw = env.SILENCE_PROMPT_INTERVALS_SEC?.trim();
  const legacy = Boolean(env.SILENCE_PROMPT_SEC?.trim() || env.SILENCE_PROMPTS?.trim());
  if (legacy) {
    if (raw) throw new Error('Use SILENCE_PROMPT_INTERVALS_SEC or SILENCE_PROMPT_SEC/SILENCE_PROMPTS, not both');
    return { promptSec: int(env, 'SILENCE_PROMPT_SEC', 12, 5, 120), prompts: int(env, 'SILENCE_PROMPTS', 2, 1, 5) };
  }
  const intervalsSec = (raw ?? '2.5:4:5').split(':').map(Number);
  if (intervalsSec.length < 1 || intervalsSec.length > 5 || intervalsSec.some((s) => !Number.isFinite(s) || s < 0.5 || s > 120)) {
    throw new Error('SILENCE_PROMPT_INTERVALS_SEC must contain 1–5 colon-separated waits between 0.5 and 120 seconds');
  }
  return { promptSec: intervalsSec.at(-1)!, prompts: intervalsSec.length, intervalsSec };
}

function forcedLiveDrop(env: NodeJS.ProcessEnv): GatewayConfig['forcedLiveDrop'] {
  const raw = env.FORCE_LIVE_DROP?.trim();
  if (!raw) return undefined;
  const m = /^([A-Za-z0-9_-]{1,128}):(\d{1,3})$/.exec(raw);
  const sec = m ? Number(m[2]) : NaN;
  // Refusing to start is the right way to fail. A typo that quietly disabled the hook would be read
  // as the server never dropping the connection, which is indistinguishable from the thing the test
  // was run to look for.
  if (!m || sec < 5 || sec > 120) {
    throw new Error('FORCE_LIVE_DROP must be residentId:seconds, with seconds between 5 and 120');
  }
  return { residentId: m[1]!, afterSec: sec };
}

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const project = required(env, 'GOOGLE_CLOUD_PROJECT');
  const bucket = required(env, 'RECORDINGS_BUCKET');
  const notifier = env.NOTIFIER_BASE_URL?.trim();
  const analyzer = env.ANALYZER_BASE_URL?.trim();
  const drop = forcedLiveDrop(env);
  const activity = activityDetection(env);
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('RECORDINGS_BUCKET is not a valid bucket name');
  return {
    port: int(env, 'PORT', 8080, 1, 65535),
    project,
    gemini: {
      location: env.GEMINI_LOCATION?.trim() || 'us-central1',
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.8-live',
      voice: env.GEMINI_VOICE?.trim() || 'Aoede',
      ...(activity ? { activityDetection: activity } : {}),
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
    silence: silenceConfig(env),
    ...(drop ? { forcedLiveDrop: drop } : {}),
    gateway: parseGatewayPolicy(env),
  };
}
