import { parseSpendSettings, type SpendSettings } from '@hachi/core';

export interface ApiConfig {
  port: number;
  /** Bucket holding call recordings; the only bucket the API will sign URLs for. */
  recordingsBucket: string;
  /** Browser origins allowed to call the API, from WEB_ORIGINS. */
  corsOrigins: string[];
  /** Read-only here: the API reports the month, the services that spend money enforce it. */
  spend: SpendSettings;
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const recordingsBucket = env.RECORDINGS_BUCKET?.trim();
  if (!recordingsBucket) throw new Error('RECORDINGS_BUCKET is not set');
  if (!BUCKET_NAME.test(recordingsBucket)) throw new Error(`RECORDINGS_BUCKET is not a valid bucket name: ${recordingsBucket}`);
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is invalid: ${env.PORT}`);
  const corsOrigins = (env.WEB_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`WEB_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`WEB_ORIGINS must be http(s) origins: ${origin}`);
    if (url.origin !== origin) throw new Error(`WEB_ORIGINS entries must be origins without a path: ${origin}`);
  }
  return { port, recordingsBucket, corsOrigins, spend: parseSpendSettings(env) };
}
