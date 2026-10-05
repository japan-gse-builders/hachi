export const URGENCIES = ['emergency', 'urgent', 'action', 'watch'] as const;
export type Urgency = (typeof URGENCIES)[number];

const RANK: Record<Urgency, number> = { emergency: 4, urgent: 3, action: 2, watch: 1 };

export const URGENCY_LABELS: Record<'ja' | 'en', Record<Urgency, string>> = {
  ja: { emergency: '緊急', urgent: '至急', action: '要対応', watch: '経過観察' },
  en: { emergency: 'Immediate action', urgent: 'Review today', action: 'Review soon', watch: 'Monitor' },
};

export function urgencyRank(u: Urgency): number {
  return RANK[u];
}

/** Positive when `a` is more urgent than `b`. */
export function compareUrgency(a: Urgency, b: Urgency): number {
  return RANK[a] - RANK[b];
}

export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return compareUrgency(a, b) >= 0 ? a : b;
}

export function isUrgency(value: unknown): value is Urgency {
  return typeof value === 'string' && (URGENCIES as readonly string[]).includes(value);
}
