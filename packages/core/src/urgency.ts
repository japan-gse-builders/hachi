export const URGENCIES = ['emergency', 'urgent', 'action', 'watch'] as const;
export type Urgency = (typeof URGENCIES)[number];

const RANK: Record<Urgency, number> = { emergency: 4, urgent: 3, action: 2, watch: 1 };

export const URGENCY_LABELS: Record<'ja' | 'en', Record<Urgency, string>> = {
  ja: { emergency: '緊急', urgent: '至急', action: '要対応', watch: '経過観察' },
  en: { emergency: 'Immediate action', urgent: 'Review today', action: 'Review soon', watch: 'Monitor' },
};

/**
 * What each level asks of the reader. A label alone ranks the cases but does not say what to do
 * about one, and the four levels are the main instruction this product gives staff, so the
 * sentence travels with the label instead of living only in the documentation.
 */
export const URGENCY_MEANINGS: Record<'ja' | 'en', Record<Urgency, string>> = {
  ja: {
    emergency: '生命や健康に差し迫った危険の可能性。いま動く。',
    urgent: '今日中に本人に連絡して確かめる。',
    action: '数日のうちに様子を見る。',
    watch: 'いまは対応不要。変化が続くかを今後の通話で見る。',
  },
  en: {
    emergency: 'Possible immediate danger to life or health. Act now.',
    urgent: 'Needs checking today: contact the resident.',
    action: 'Follow up within the next few days.',
    watch: 'No action yet. Watch whether the change continues.',
  },
};

/** The same instruction, short enough to show all four levels on one line above a queue. */
export const URGENCY_ACTIONS: Record<'ja' | 'en', Record<Urgency, string>> = {
  ja: { emergency: 'いま動く', urgent: '今日中に確認', action: '数日のうちに', watch: '様子を見る' },
  en: { emergency: 'act now', urgent: 'check today', action: 'within a few days', watch: 'watch for now' },
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
