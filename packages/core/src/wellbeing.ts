import type { Locale } from './types.js';

/** Six life domains shown at a glance, then practical needs and speech (not shown to family). */
export const WELLBEING_DOMAINS = ['body', 'food', 'sleep', 'mood', 'social', 'activity', 'practical', 'speech'] as const;
export type WellbeingDomain = (typeof WELLBEING_DOMAINS)[number];

export const LIFE_DOMAINS = ['body', 'food', 'sleep', 'mood', 'social', 'activity'] as const satisfies readonly WellbeingDomain[];
export type LifeDomain = (typeof LIFE_DOMAINS)[number];

export type TagPolarity = 'positive' | 'concern';
/** `family_with_consent` tags stay with staff until the resident's consent to share them is recorded. */
export type TagAudience = 'family' | 'family_with_consent' | 'staff';
/** `said`: the resident said it in so many words; `inferred`: a clear implication of what they said. */
export type TagBasis = 'said' | 'inferred';
export type DomainState = 'good' | 'mixed' | 'concern' | 'unmentioned';

export interface WellbeingTagDef {
  id: string;
  domain: WellbeingDomain;
  polarity: TagPolarity;
  label: Record<Locale, string>;
  audience: TagAudience;
  /** Extra guidance for the model where the label alone is ambiguous. */
  hint?: string;
}

/** Closed vocabulary: ids are stored with every call, so they must never be renamed or reused. */
export const WELLBEING_TAGS = [
  { id: 'body.feeling_well', domain: 'body', polarity: 'positive', label: { en: 'Feeling well', ja: '体調が良い' }, audience: 'family' },
  { id: 'body.energetic', domain: 'body', polarity: 'positive', label: { en: 'Full of energy', ja: '元気がある' }, audience: 'family' },
  { id: 'body.tired', domain: 'body', polarity: 'concern', label: { en: 'Tired', ja: '疲れている' }, audience: 'family' },
  { id: 'body.pain', domain: 'body', polarity: 'concern', label: { en: 'Pain or aches', ja: '痛みがある' }, audience: 'family', hint: 'pain, aches, pressure or discomfort anywhere' },
  { id: 'body.unwell', domain: 'body', polarity: 'concern', label: { en: 'Unwell (cold or flu)', ja: '風邪などで体調不良' }, audience: 'family' },
  { id: 'body.dizzy', domain: 'body', polarity: 'concern', label: { en: 'Dizzy', ja: 'めまい' }, audience: 'family' },
  { id: 'body.fall', domain: 'body', polarity: 'concern', label: { en: 'Fall or near-fall', ja: '転倒・転びかけた' }, audience: 'family', hint: 'a fall or a near-fall in the last few days that still troubles them' },
  { id: 'body.recovered_fall', domain: 'body', polarity: 'concern', label: { en: 'Recent fall (recovered)', ja: '最近の転倒（回復済み）' }, audience: 'family', hint: 'a fall in the last two weeks that they say they have recovered from' },

  { id: 'food.ate_well', domain: 'food', polarity: 'positive', label: { en: 'Ate well', ja: 'よく食べた' }, audience: 'family' },
  { id: 'food.cooked', domain: 'food', polarity: 'positive', label: { en: 'Cooked a meal', ja: '料理をした' }, audience: 'family' },
  { id: 'food.ate_little', domain: 'food', polarity: 'concern', label: { en: 'Ate little', ja: '食事が少ない' }, audience: 'family', hint: 'ate much less than usual or no appetite' },
  { id: 'food.skipped_meals', domain: 'food', polarity: 'concern', label: { en: 'Skipped meals', ja: '食事を抜いた' }, audience: 'family', hint: 'missed meals; not a planned fast before a test' },
  { id: 'food.low_fluids', domain: 'food', polarity: 'concern', label: { en: 'Not drinking enough', ja: '水分が足りない' }, audience: 'family', hint: 'has drunk little water or tea' },

  { id: 'sleep.slept_well', domain: 'sleep', polarity: 'positive', label: { en: 'Slept well', ja: 'よく眠れた' }, audience: 'family' },
  { id: 'sleep.slept_badly', domain: 'sleep', polarity: 'concern', label: { en: 'Slept badly', ja: 'よく眠れなかった' }, audience: 'family' },
  { id: 'sleep.up_at_night', domain: 'sleep', polarity: 'concern', label: { en: 'Up at night', ja: '夜中に起きる' }, audience: 'family' },

  { id: 'mood.cheerful', domain: 'mood', polarity: 'positive', label: { en: 'Cheerful', ja: '明るい' }, audience: 'family_with_consent' },
  { id: 'mood.calm', domain: 'mood', polarity: 'positive', label: { en: 'Calm', ja: '落ち着いている' }, audience: 'family_with_consent' },
  { id: 'mood.looking_forward', domain: 'mood', polarity: 'positive', label: { en: 'Looking forward to something', ja: '楽しみなことがある' }, audience: 'family_with_consent' },
  { id: 'mood.low', domain: 'mood', polarity: 'concern', label: { en: 'Feeling low', ja: '気分が沈んでいる' }, audience: 'family_with_consent' },
  { id: 'mood.worried', domain: 'mood', polarity: 'concern', label: { en: 'Worried', ja: '心配ごとがある' }, audience: 'family_with_consent' },
  { id: 'mood.lonely', domain: 'mood', polarity: 'concern', label: { en: 'Lonely', ja: '寂しい' }, audience: 'family_with_consent' },
  { id: 'mood.irritable', domain: 'mood', polarity: 'concern', label: { en: 'Irritable', ja: 'イライラしている' }, audience: 'family_with_consent' },

  { id: 'social.family_contact', domain: 'social', polarity: 'positive', label: { en: 'Talked with family', ja: '家族と話した' }, audience: 'family', hint: 'spoke with or saw a family member recently' },
  { id: 'social.saw_friends', domain: 'social', polarity: 'positive', label: { en: 'Saw friends', ja: '友人と会った' }, audience: 'family' },
  { id: 'social.had_visitor', domain: 'social', polarity: 'positive', label: { en: 'Had a visitor', ja: '来客があった' }, audience: 'family' },
  { id: 'social.no_contact', domain: 'social', polarity: 'concern', label: { en: 'No contact for days', ja: '何日も人と話していない' }, audience: 'family' },
  { id: 'social.missed_group', domain: 'social', polarity: 'concern', label: { en: 'Missed a regular group', ja: 'いつもの集まりを休んだ' }, audience: 'family' },

  { id: 'activity.went_out', domain: 'activity', polarity: 'positive', label: { en: 'Went out', ja: '外出した' }, audience: 'family', hint: 'went out of the home, e.g. shops, clinic, temple' },
  { id: 'activity.walk', domain: 'activity', polarity: 'positive', label: { en: 'Went for a walk', ja: '散歩した' }, audience: 'family' },
  { id: 'activity.gardening', domain: 'activity', polarity: 'positive', label: { en: 'Gardening', ja: '庭いじり' }, audience: 'family', hint: 'gardening or looking after plants' },
  { id: 'activity.hobby', domain: 'activity', polarity: 'positive', label: { en: 'Enjoyed a hobby', ja: '趣味を楽しんだ' }, audience: 'family' },
  { id: 'activity.stayed_in', domain: 'activity', polarity: 'concern', label: { en: 'Stayed in all day', ja: '一日中家にいた' }, audience: 'family' },
  { id: 'activity.chores_hard', domain: 'activity', polarity: 'concern', label: { en: 'Finding chores hard', ja: '家事がつらい' }, audience: 'family', hint: 'cannot manage housework, shopping bags or cooking as before' },

  { id: 'practical.medication', domain: 'practical', polarity: 'concern', label: { en: 'Medication question', ja: '薬についての質問' }, audience: 'family_with_consent' },
  { id: 'practical.shopping', domain: 'practical', polarity: 'concern', label: { en: 'Needs shopping help', ja: '買い物の手助けが必要' }, audience: 'family_with_consent' },
  { id: 'practical.appointment', domain: 'practical', polarity: 'concern', label: { en: 'Appointment coming up', ja: '近く予約・通院がある' }, audience: 'family_with_consent' },
  { id: 'practical.home_problem', domain: 'practical', polarity: 'concern', label: { en: 'Problem at home', ja: '家の困りごと' }, audience: 'family_with_consent', hint: 'something broken or not working at home' },
  { id: 'practical.money_worry', domain: 'practical', polarity: 'concern', label: { en: 'Scam or money worry', ja: '詐欺・お金の心配' }, audience: 'family_with_consent' },

  { id: 'speech.as_usual', domain: 'speech', polarity: 'positive', label: { en: 'Speech as usual', ja: '話し方はいつも通り' }, audience: 'staff', hint: 'only when their speech comes up and the resident says it is normal; never by default' },
  { id: 'speech.slower', domain: 'speech', polarity: 'concern', label: { en: 'Slower speech', ja: '話し方が遅い' }, audience: 'staff', hint: 'the resident says words are coming slowly, or many sentences trail off unfinished' },
  { id: 'speech.hard_to_follow', domain: 'speech', polarity: 'concern', label: { en: 'Harder to follow', ja: '話がわかりにくい' }, audience: 'staff' },
  { id: 'speech.repeating', domain: 'speech', polarity: 'concern', label: { en: 'Repeating themselves', ja: '同じ話を繰り返す' }, audience: 'staff' },
] as const satisfies readonly WellbeingTagDef[];

export type WellbeingTagId = (typeof WELLBEING_TAGS)[number]['id'];
export const WELLBEING_TAG_IDS: readonly WellbeingTagId[] = WELLBEING_TAGS.map((t) => t.id);

/** One tag on a call, pointing at the resident turn it came from so staff can check it. */
export interface CallTag {
  id: WellbeingTagId;
  /** Index into the call transcript. */
  turn: number;
  basis: TagBasis;
  /** 0..1 */
  confidence: number;
}

export const DOMAIN_LABELS: Record<Locale, Record<WellbeingDomain, string>> = {
  en: { body: 'Body', food: 'Food & drink', sleep: 'Sleep', mood: 'Mood', social: 'Social', activity: 'Activity', practical: 'Practical needs', speech: 'Speech' },
  ja: { body: '体調', food: '食事・水分', sleep: '睡眠', mood: '気分', social: '人との交流', activity: '活動', practical: '生活の困りごと', speech: '話し方' },
};

const BY_ID: ReadonlyMap<string, WellbeingTagDef> = new Map(WELLBEING_TAGS.map((t) => [t.id, t]));

export function isWellbeingTagId(id: string): id is WellbeingTagId {
  return BY_ID.has(id);
}

export function wellbeingTag(id: WellbeingTagId): WellbeingTagDef {
  return BY_ID.get(id)!;
}

/** FAM-03: until consent tiers exist only `family` tags reach family; mood is shown as a domain state only. */
export function visibleToFamily(id: WellbeingTagId): boolean {
  return wellbeingTag(id).audience === 'family';
}

/** "Not talked about" is its own state, never folded into good. */
export function combineStates(states: readonly DomainState[]): DomainState {
  const said = new Set(states.filter((s) => s !== 'unmentioned'));
  if (said.size === 0) return 'unmentioned';
  if (said.size === 1) return [...said][0]!;
  return 'mixed';
}

/** Per domain: only positive tags is good, only concern tags is concern, both is mixed, none is unmentioned. */
export function domainStates(tagIds: readonly string[]): Record<WellbeingDomain, DomainState> {
  const polarities = new Map<WellbeingDomain, DomainState[]>();
  for (const id of tagIds) {
    const def = BY_ID.get(id);
    if (!def) continue;
    polarities.set(def.domain, [...(polarities.get(def.domain) ?? []), def.polarity === 'positive' ? 'good' : 'concern']);
  }
  return Object.fromEntries(WELLBEING_DOMAINS.map((d) => [d, combineStates(polarities.get(d) ?? [])])) as Record<WellbeingDomain, DomainState>;
}

export interface TagTrend {
  id: WellbeingTagId;
  /** Calls in the latest window that had the tag. */
  last: number;
  /** Calls in the window before that had the tag. */
  previous: number;
  /** Calls in each window; fewer than the window size early on. */
  lastCalls: number;
  previousCalls: number;
  /** Compared by share of calls; null when there is no earlier window to compare with. */
  direction: 'more' | 'less' | 'same' | null;
}

/**
 * Counts each tag in the latest `window` calls against the `window` calls before them. `calls`
 * are newest first, each the tag ids of one call; a tag counts once per call. Most frequent
 * first, concerns before positives at equal counts.
 */
export function tagTrends(calls: readonly (readonly string[])[], window = 7): TagTrend[] {
  const recent = calls.slice(0, window);
  const before = calls.slice(window, window * 2);
  const count = (xs: readonly (readonly string[])[], id: string) => xs.filter((c) => c.includes(id)).length;
  const seen = new Set([...recent, ...before].flat().filter(isWellbeingTagId));
  const trends = [...seen].map((id): TagTrend => {
    const last = count(recent, id);
    const previous = count(before, id);
    const now = last / recent.length;
    const then = before.length ? previous / before.length : 0;
    return {
      id,
      last,
      previous,
      lastCalls: recent.length,
      previousCalls: before.length,
      direction: before.length === 0 ? null : now > then ? 'more' : now < then ? 'less' : 'same',
    };
  });
  const order = (id: WellbeingTagId) => WELLBEING_TAG_IDS.indexOf(id);
  const concernFirst = (id: WellbeingTagId) => (wellbeingTag(id).polarity === 'concern' ? 0 : 1);
  return trends.sort((a, b) => b.last - a.last || concernFirst(a.id) - concernFirst(b.id) || b.previous - a.previous || order(a.id) - order(b.id));
}
