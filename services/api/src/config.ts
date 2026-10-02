export interface ApiConfig {
  port: number;
  /** Bucket holding call recordings; the only bucket the API will sign URLs for. */
  recordingsBucket: string;
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const recordingsBucket = env.RECORDINGS_BUCKET?.trim();
  if (!recordingsBucket) throw new Error('RECORDINGS_BUCKET is not set');
  if (!BUCKET_NAME.test(recordingsBucket)) throw new Error(`RECORDINGS_BUCKET is not a valid bucket name: ${recordingsBucket}`);
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is invalid: ${env.PORT}`);
  return { port, recordingsBucket };
}
