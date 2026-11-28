const DAY_MS = 86_400_000;

export const MAX_CALL_MEDIA_RETENTION_DAYS = 3650;

export interface CallMediaRetention {
  days: number;
  /** Expiry that already took effect under any earlier setting. */
  expiredThrough: string;
}

const cutoffFor = (days: number, now: Date) => new Date(now.getTime() - days * DAY_MS).toISOString();

export function retentionCutoff(policy: CallMediaRetention, now: Date): string {
  const current = cutoffFor(policy.days, now);
  return policy.expiredThrough > current ? policy.expiredThrough : current;
}

export function setCallMediaRetention(previous: CallMediaRetention | undefined, days: number, now: Date): CallMediaRetention {
  const current = cutoffFor(days, now);
  const prior = previous ? retentionCutoff(previous, now) : current;
  return { days, expiredThrough: prior > current ? prior : current };
}

export function callMediaExpiresAt(startedAt: string, policy: CallMediaRetention): string | null {
  const time = Date.parse(startedAt);
  return Number.isFinite(time) ? new Date(time + policy.days * DAY_MS).toISOString() : null;
}
