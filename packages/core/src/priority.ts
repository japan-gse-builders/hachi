import { effectiveUrgency } from './cases.js';
import type { Case, Locale, RuleId, VulnerabilityProfile } from './types.js';
import { compareUrgency, type Urgency } from './urgency.js';

export const RULE_NAMES: Record<Locale, Record<RuleId, string>> = {
  ja: { R1: '急な体調の異変', R2: '食事がとれていない', R3: '話し方の変化', R4: '応答がない' },
  en: { R1: 'Acute symptoms', R2: 'Not eating', R3: 'Change in speech', R4: 'No response' },
};

export interface PriorityFactor {
  key: 'confidence' | 'overlap' | 'change' | 'trend' | 'vulnerability' | 'elapsed';
  points: number;
  text: string;
}

export interface PrioritizedCase {
  case: Case;
  urgency: Urgency;
  score: number;
  factors: PriorityFactor[];
  /** PRI-03: one-glance reason. */
  reason: string;
}

const T = {
  ja: {
    r1: '体調の急な異変を訴えている',
    r2: (days: number) => (days >= 2 ? `${days}日続けてほとんど食べていない` : 'ほとんど食べられていない日がある'),
    r3: '話し方に平常時からの変化がある',
    r3Worsening: '話し方に平常時からの変化があり、悪化傾向',
    r4Silent: '電話には出たが、ひとことも話していない',
    r4Stopped: '通話の途中から応答がなくなった',
    overlap: (names: string[]) => `${names.join('・')}の兆候も重なっている`,
    noSupporter: '身近な支援者なし',
    livesAlone: '一人暮らし',
    needsCare: '要介護',
    chronic: (list: string[]) => `持病あり（${list.join('、')}）`,
    elapsed: (h: number) => `検知から${h}時間経過`,
    lowConfidence: '確からしさは低め',
    sep: '。',
  },
  en: {
    r1: 'Reported acute symptoms',
    r2: (days: number) => (days >= 2 ? `Barely eating for ${days} days in a row` : 'Barely ate on one day'),
    r3: 'Speech has changed from their usual pattern',
    r3Worsening: 'Speech has changed from their usual pattern and is getting worse',
    r4Silent: 'Answered the phone but never spoke',
    r4Stopped: 'Stopped responding partway through the call',
    overlap: (names: string[]) => `Also shows: ${names.join(', ')}`,
    noSupporter: 'No close supporter',
    livesAlone: 'Lives alone',
    needsCare: 'Needs care',
    chronic: (list: string[]) => `Chronic conditions (${list.join(', ')})`,
    elapsed: (h: number) => `${h}h since detection`,
    lowConfidence: 'Lower confidence',
    sep: '. ',
  },
};

function latest<K extends keyof Case['detections'][number]>(c: Case, key: K) {
  for (let i = c.detections.length - 1; i >= 0; i--) {
    const v = c.detections[i]![key];
    if (v !== undefined) return v;
  }
  return undefined;
}

function headline(c: Case, locale: Locale): string {
  const t = T[locale];
  if (c.rule === 'R1') return t.r1;
  if (c.rule === 'R2') return t.r2((latest(c, 'poorIntakeDays') as number | undefined) ?? 1);
  if (c.rule === 'R4') return latest(c, 'noResponse') === 'stopped_responding' ? t.r4Stopped : t.r4Silent;
  return latest(c, 'trend') === 'worsening' ? t.r3Worsening : t.r3;
}

/**
 * PRI-02: ranks a case within its urgency level using
 * (1) confidence, (2) overlapping signals, (3) size/persistence of change,
 * (4) vulnerability, (5) time since detection.
 */
export function prioritize(
  c: Case,
  openCasesOfResident: Case[],
  vulnerability: VulnerabilityProfile,
  now: Date,
  locale: Locale = 'ja',
): PrioritizedCase {
  const t = T[locale];
  const factors: PriorityFactor[] = [];

  const confidence = Math.max(0, ...c.detections.map((d) => d.confidence));
  factors.push({ key: 'confidence', points: confidence * 3, text: confidence < 0.5 ? t.lowConfidence : '' });

  const others = [
    ...new Set(
      openCasesOfResident.filter((o) => o.id !== c.id && o.residentId === c.residentId && o.status !== 'closed').map((o) => o.rule),
    ),
  ].filter((r) => r !== c.rule);
  if (others.length) factors.push({ key: 'overlap', points: 2 * others.length, text: t.overlap(others.sort().map((r) => RULE_NAMES[locale][r])) });

  const days = (latest(c, 'poorIntakeDays') as number | undefined) ?? 0;
  const magnitude = (latest(c, 'changeMagnitude') as number | undefined) ?? 0;
  const changePoints = Math.min(2, Math.max(0, days - 1) * 0.5) + Math.min(2, (magnitude / 4) * 2);
  if (changePoints > 0) factors.push({ key: 'change', points: changePoints, text: '' });
  if (latest(c, 'trend') === 'worsening') factors.push({ key: 'trend', points: 1, text: '' });

  const v = vulnerability;
  if (!v.hasCloseSupporter) factors.push({ key: 'vulnerability', points: 1.5, text: t.noSupporter });
  if (v.livesAlone) factors.push({ key: 'vulnerability', points: 0.5, text: t.livesAlone });
  if (v.needsCare) factors.push({ key: 'vulnerability', points: 1, text: t.needsCare });
  if (v.chronicConditions.length) {
    factors.push({ key: 'vulnerability', points: Math.min(1.5, 0.5 * v.chronicConditions.length), text: t.chronic(v.chronicConditions) });
  }

  const hours = Math.max(0, (now.getTime() - Date.parse(c.firstDetectedAt)) / 3_600_000);
  factors.push({ key: 'elapsed', points: Math.min(2, hours / 24), text: hours >= 12 ? t.elapsed(Math.floor(hours)) : '' });

  const score = Math.round(factors.reduce((a, f) => a + f.points, 0) * 1000) / 1000;
  const reason = [headline(c, locale), ...factors.map((f) => f.text).filter(Boolean)].join(t.sep);
  return { case: c, urgency: effectiveUrgency(c), score, factors, reason };
}

/** QUE-01: emergency first, then by score, then oldest detection first. */
export function sortQueue(items: PrioritizedCase[]): PrioritizedCase[] {
  return [...items].sort(
    (a, b) =>
      compareUrgency(b.urgency, a.urgency) ||
      b.score - a.score ||
      Date.parse(a.case.firstDetectedAt) - Date.parse(b.case.firstDetectedAt),
  );
}
