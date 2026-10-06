/**
 * The closed set of screening questions Hachi asks, and how their answers map onto the seven
 * domains of Japan's 基本チェックリスト (Kihon Checklist, MHLW).
 *
 * Two rules govern everything here.
 *
 * Wording is fixed. A published cutoff only means what it means when the question is asked in the
 * words it was validated in, with the same response options and the same recall window. Hachi may
 * wrap an item in conversation but must never paraphrase one, so `text` and `options` are what the
 * resident hears.
 *
 * Hachi does not administer the Kihon Checklist. Its residents speak English and the official
 * instrument may not be reworded or translated, so these are English questions about the same
 * behaviour as the numbered item they cite. Where a validated English instrument exists for a
 * domain we use that instead and keep its own scoring. What Hachi reports is which domains look
 * worth a proper assessment by a professional, never a Kihon score.
 */

/** Instruments whose own wording and scoring we reproduce exactly. */
export type Instrument =
  /** Hughes, Waite, Hawkley & Cacioppo 2004, the three-item loneliness scale. */
  | 'ULS-3'
  /** Kroenke, Spitzer & Williams 2003, the two-item depression screener. */
  | 'PHQ-2'
  /** Morley et al., the five-item frailty questionnaire, validated by self-report. */
  | 'FRAIL'
  /** An English question about the behaviour a numbered Kihon Checklist item asks about. */
  | 'KCL-equivalent';

/** The seven domains the Kihon Checklist scores, in its own order. */
export type KihonDomain = 'iadl' | 'mobility' | 'nutrition' | 'oral' | 'housebound' | 'cognition' | 'mood';

export interface ItemOption {
  /** Read out to the resident, so they choose from the same options the instrument validated. */
  label: string;
  /** Points towards the instrument's own total. */
  score: number;
  /** Whether this answer is 該当 for the Kihon item cited by `kihonItem`. */
  risk: boolean;
}

export interface ScreenItem {
  id: string;
  instrument: Instrument;
  /** Verbatim. Paraphrasing it discards the published cutoff. */
  text: string;
  /** Spoken before the question; the window is part of the item. */
  recall?: string;
  options: readonly ItemOption[];
  /** The numbered Kihon Checklist item this asks about the same behaviour as. */
  kihonItem?: number;
  /** The Kihon domain the answer is reported under. */
  domain: KihonDomain;
  /** Asked only after the resident has settled into the call. */
  sensitive?: boolean;
}

const FREQUENCY: readonly ItemOption[] = [
  { label: 'Hardly ever or never', score: 1, risk: false },
  { label: 'Some of the time', score: 2, risk: false },
  { label: 'Often', score: 3, risk: true },
];

const PHQ: readonly ItemOption[] = [
  { label: 'Not at all', score: 0, risk: false },
  { label: 'Several days', score: 1, risk: false },
  { label: 'More than half the days', score: 2, risk: true },
  { label: 'Nearly every day', score: 3, risk: true },
];

/** Answering yes is the worrying answer. */
const YES_IS_RISK: readonly ItemOption[] = [
  { label: 'Yes', score: 1, risk: true },
  { label: 'No', score: 0, risk: false },
];

/** Answering no is the worrying answer: the item asks whether they still do something. */
const NO_IS_RISK: readonly ItemOption[] = [
  { label: 'Yes', score: 0, risk: false },
  { label: 'No', score: 1, risk: true },
];

const FRAIL_FATIGUE: readonly ItemOption[] = [
  { label: 'All or most of the time', score: 1, risk: true },
  { label: 'None or some of the time', score: 0, risk: false },
];

/**
 * Ordered so that consecutive pairs never hold two sensitive items: the rotation hands out two
 * items per call, and a call that opens the loneliness and the depression questions together
 * stops being a check-in and becomes an interview.
 */
export const SCREEN_ITEMS: readonly ScreenItem[] = [
  {
    id: 'uls3.companionship',
    instrument: 'ULS-3',
    text: 'How often do you feel that you lack companionship?',
    options: FREQUENCY,
    domain: 'mood',
    sensitive: true,
  },
  {
    id: 'kcl.out_weekly',
    instrument: 'KCL-equivalent',
    text: 'Do you go out of the house at least once a week?',
    options: NO_IS_RISK,
    kihonItem: 16,
    domain: 'housebound',
  },
  {
    id: 'uls3.left_out',
    instrument: 'ULS-3',
    text: 'How often do you feel left out?',
    options: FREQUENCY,
    domain: 'mood',
    sensitive: true,
  },
  {
    id: 'kcl.chewing',
    instrument: 'KCL-equivalent',
    text: 'Compared with six months ago, has it become harder to eat firm foods?',
    options: YES_IS_RISK,
    kihonItem: 13,
    domain: 'oral',
  },
  {
    id: 'uls3.isolated',
    instrument: 'ULS-3',
    text: 'How often do you feel isolated from others?',
    options: FREQUENCY,
    domain: 'mood',
    sensitive: true,
  },
  {
    id: 'kcl.choking',
    instrument: 'KCL-equivalent',
    text: 'Do you ever choke on tea, soup or other drinks?',
    options: YES_IS_RISK,
    kihonItem: 14,
    domain: 'oral',
  },
  {
    id: 'phq2.interest',
    instrument: 'PHQ-2',
    recall: 'Over the last two weeks, how often have you been bothered by',
    text: 'little interest or pleasure in doing things?',
    options: PHQ,
    kihonItem: 22,
    domain: 'mood',
    sensitive: true,
  },
  {
    id: 'kcl.out_less',
    instrument: 'KCL-equivalent',
    text: 'Compared with last year, are you going out less often?',
    options: YES_IS_RISK,
    kihonItem: 17,
    domain: 'housebound',
  },
  {
    id: 'phq2.down',
    instrument: 'PHQ-2',
    recall: 'Over the last two weeks, how often have you been bothered by',
    text: 'feeling down, depressed, or hopeless?',
    options: PHQ,
    kihonItem: 21,
    domain: 'mood',
    sensitive: true,
  },
  {
    id: 'kcl.dry_mouth',
    instrument: 'KCL-equivalent',
    text: 'Does a dry mouth bother you?',
    options: YES_IS_RISK,
    kihonItem: 15,
    domain: 'oral',
  },
  {
    id: 'frail.resistance',
    instrument: 'FRAIL',
    text: 'By yourself, and not using aids, do you have any difficulty walking up ten steps without resting?',
    options: YES_IS_RISK,
    kihonItem: 6,
    domain: 'mobility',
  },
  {
    id: 'kcl.repeating',
    instrument: 'KCL-equivalent',
    text: 'Do people around you say that you ask the same thing over and over, or that you are forgetting things?',
    options: YES_IS_RISK,
    kihonItem: 18,
    domain: 'cognition',
  },
  {
    id: 'frail.ambulation',
    instrument: 'FRAIL',
    text: 'By yourself, and not using aids, do you have any difficulty walking several hundred yards?',
    options: YES_IS_RISK,
    kihonItem: 8,
    domain: 'mobility',
  },
  {
    id: 'kcl.date',
    instrument: 'KCL-equivalent',
    text: 'Are there times when you do not know what today\u2019s date is?',
    options: YES_IS_RISK,
    kihonItem: 20,
    domain: 'cognition',
  },
  {
    id: 'frail.fatigue',
    instrument: 'FRAIL',
    recall: 'Thinking about the past four weeks,',
    text: 'how much of the time did you feel tired?',
    options: FRAIL_FATIGUE,
    kihonItem: 25,
    domain: 'mood',
  },
  {
    id: 'kcl.phone',
    instrument: 'KCL-equivalent',
    text: 'Do you look up a phone number yourself and make the call?',
    options: NO_IS_RISK,
    kihonItem: 19,
    domain: 'cognition',
  },
  {
    id: 'kcl.weight_loss',
    instrument: 'KCL-equivalent',
    text: 'In the last six months, have you lost two to three kilograms or more in weight?',
    options: YES_IS_RISK,
    kihonItem: 11,
    domain: 'nutrition',
  },
  {
    id: 'kcl.shopping',
    instrument: 'KCL-equivalent',
    text: 'Do you do your own everyday shopping?',
    options: NO_IS_RISK,
    kihonItem: 2,
    domain: 'iadl',
  },
  {
    id: 'kcl.fall_year',
    instrument: 'KCL-equivalent',
    text: 'Have you had a fall in the past year?',
    options: YES_IS_RISK,
    kihonItem: 9,
    domain: 'mobility',
  },
  {
    id: 'kcl.transport',
    instrument: 'KCL-equivalent',
    text: 'Do you go out on your own by bus or train?',
    options: NO_IS_RISK,
    kihonItem: 1,
    domain: 'iadl',
  },
  {
    id: 'kcl.fall_fear',
    instrument: 'KCL-equivalent',
    text: 'Are you worried about falling?',
    options: YES_IS_RISK,
    kihonItem: 10,
    domain: 'mobility',
  },
  {
    id: 'kcl.banking',
    instrument: 'KCL-equivalent',
    text: 'Do you manage your own money at the bank or the post office?',
    options: NO_IS_RISK,
    kihonItem: 3,
    domain: 'iadl',
  },
  {
    id: 'kcl.visit_friends',
    instrument: 'KCL-equivalent',
    text: 'Do you visit friends at their homes?',
    options: NO_IS_RISK,
    kihonItem: 4,
    domain: 'iadl',
  },
  {
    id: 'kcl.advise',
    instrument: 'KCL-equivalent',
    text: 'Do family or friends come to you for advice?',
    options: NO_IS_RISK,
    kihonItem: 5,
    domain: 'iadl',
  },
] as const;

const BY_ID = new Map(SCREEN_ITEMS.map((i) => [i.id, i]));

export function screenItem(id: string): ScreenItem {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown screening item: ${id}`);
  return item;
}

/**
 * Every answer any item offers. The reviewer picks from this one list and the answer is then
 * checked against the item it belongs to, so an answer that item never offered is discarded
 * rather than scored.
 */
export const ANSWER_LABELS: readonly string[] = [
  ...new Set(SCREEN_ITEMS.flatMap((i) => i.options.map((o) => o.label))),
];

/** The item's own option index for a spoken answer, or null when the item never offered it. */
export function matchAnswer(item: ScreenItem, label: string): number | null {
  const wanted = label.trim().toLowerCase();
  const index = item.options.findIndex((o) => o.label.toLowerCase() === wanted);
  return index < 0 ? null : index;
}

/** Two closed questions fit inside a three to five minute chat without it becoming an interview. */
export const ITEMS_PER_CALL = 2;

/** Days to get through every item once. Coprime with seven, so items drift across the week. */
export const CYCLE_DAYS = Math.ceil(SCREEN_ITEMS.length / ITEMS_PER_CALL);

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${date}`);
  return Math.round(t / DAY_MS);
}

/**
 * The items for one call, by calendar date rather than by call count, so a week of missed calls
 * does not leave a resident stuck on the same two questions.
 */
export function itemsForCall(serviceStart: string, localDate: string): ScreenItem[] {
  const day = dayIndex(localDate) - dayIndex(serviceStart);
  const slot = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  return SCREEN_ITEMS.slice(slot * ITEMS_PER_CALL, slot * ITEMS_PER_CALL + ITEMS_PER_CALL);
}

/** The first day of the rotation `localDate` falls in, which is what a per-rotation record is keyed by. */
export function cycleStart(serviceStart: string, localDate: string): string {
  const day = dayIndex(localDate) - dayIndex(serviceStart);
  const slot = ((day % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  return new Date((dayIndex(localDate) - slot) * DAY_MS).toISOString().slice(0, 10);
}

export interface ItemAnswer {
  /** Local calendar date of the call it was answered on. */
  date: string;
  itemId: string;
  /** Index into the item's own options. */
  option: number;
}

/**
 * How far back an answer still counts. Two cycles, so one missed call does not empty a domain,
 * and nothing older than a month is presented as current.
 */
export const ANSWER_WINDOW_DAYS = CYCLE_DAYS * 2;

/**
 * The newest answer to each item inside the window, which is the one that counts. Answers after
 * `asOf` are left out, so asking what the picture was a rotation ago gives that answer and not
 * today's.
 */
export function currentAnswers(answers: readonly ItemAnswer[], asOf: string): Map<string, ItemAnswer> {
  const cutoff = dayIndex(asOf) - ANSWER_WINDOW_DAYS;
  const latest = new Map<string, ItemAnswer>();
  for (const a of answers) {
    const day = dayIndex(a.date);
    if (!BY_ID.has(a.itemId) || day <= cutoff || day > dayIndex(asOf)) continue;
    const prev = latest.get(a.itemId);
    if (!prev || a.date > prev.date) latest.set(a.itemId, a);
  }
  return latest;
}

export interface InstrumentScore {
  instrument: Instrument;
  score: number;
  /** Items answered out of the instrument's own length. */
  answered: number;
  of: number;
  /** Null until every item is answered: a part-scored instrument has no valid cutoff. */
  positive: boolean | null;
}

const INSTRUMENT_CUTOFF: Partial<Record<Instrument, { items: string[]; atLeast: number }>> = {
  // Hughes et al. score 3-9; 6 and above is the grouping in common use, though no cutoff is agreed.
  'ULS-3': { items: ['uls3.companionship', 'uls3.left_out', 'uls3.isolated'], atLeast: 6 },
  // Kroenke et al. found 3 optimal: sensitivity 83%, specificity 92% for major depression.
  'PHQ-2': { items: ['phq2.interest', 'phq2.down'], atLeast: 3 },
};

export function scoreInstrument(
  instrument: 'ULS-3' | 'PHQ-2',
  answers: readonly ItemAnswer[],
  asOf: string,
): InstrumentScore {
  const cutoff = INSTRUMENT_CUTOFF[instrument]!;
  const current = currentAnswers(answers, asOf);
  let score = 0;
  let answered = 0;
  for (const id of cutoff.items) {
    const a = current.get(id);
    if (!a) continue;
    const option = screenItem(id).options[a.option];
    if (!option) continue;
    score += option.score;
    answered += 1;
  }
  const complete = answered === cutoff.items.length;
  return {
    instrument,
    score,
    answered,
    of: cutoff.items.length,
    positive: complete ? score >= cutoff.atLeast : null,
  };
}

/**
 * The official 事業対象者 criteria. Every domain rule is "this many of these numbered items are
 * 該当", so a domain can only be judged once Hachi has asked all of its items.
 */
const DOMAIN_RULES: Record<KihonDomain, { items: number[]; atLeast: number }> = {
  iadl: { items: [1, 2, 3, 4, 5], atLeast: 0 },
  mobility: { items: [6, 7, 8, 9, 10], atLeast: 3 },
  nutrition: { items: [11, 12], atLeast: 2 },
  oral: { items: [13, 14, 15], atLeast: 2 },
  housebound: { items: [16], atLeast: 1 },
  cognition: { items: [18, 19, 20], atLeast: 1 },
  mood: { items: [21, 22, 23, 24, 25], atLeast: 2 },
};

export const KIHON_DOMAIN_LABELS: Record<KihonDomain, { en: string; ja: string }> = {
  iadl: { en: 'Everyday activities', ja: '生活機能' },
  mobility: { en: 'Moving about', ja: '運動機能' },
  nutrition: { en: 'Nutrition', ja: '栄養状態' },
  oral: { en: 'Eating and swallowing', ja: '口腔機能' },
  housebound: { en: 'Getting out', ja: '閉じこもり' },
  cognition: { en: 'Memory', ja: '認知機能' },
  mood: { en: 'Spirits', ja: 'うつ' },
};

export interface DomainStatus {
  domain: KihonDomain;
  /** Kihon items in this domain that Hachi asked and got an answer to. */
  answered: number;
  /** Kihon items in this domain, including any Hachi cannot ask by telephone. */
  of: number;
  /** Of the answered ones, how many came back 該当. */
  flagged: number;
  /** Numbered items Hachi has no telephone question for, which is why `of` may exceed coverage. */
  missing: number[];
  /**
   * Whether the domain's own criterion is met. Null when the answers are incomplete: enough items
   * are flagged to pass, or too few are answered to rule it out, and either way a professional
   * has to look rather than a number being invented.
   */
  meets: boolean | null;
}

const ASKABLE = new Map<number, string>(
  SCREEN_ITEMS.filter((i) => i.kihonItem !== undefined).map((i) => [i.kihonItem!, i.id]),
);

export function domainStatus(answers: readonly ItemAnswer[], asOf: string): DomainStatus[] {
  const current = currentAnswers(answers, asOf);
  return (Object.keys(DOMAIN_RULES) as KihonDomain[]).map((domain) => {
    const rule = DOMAIN_RULES[domain];
    const missing: number[] = [];
    let answered = 0;
    let flagged = 0;
    for (const n of rule.items) {
      const id = ASKABLE.get(n);
      if (!id) {
        missing.push(n);
        continue;
      }
      const a = current.get(id);
      if (!a) continue;
      const option = screenItem(id).options[a.option];
      if (!option) continue;
      answered += 1;
      if (option.risk) flagged += 1;
    }
    const unanswered = rule.items.length - answered;
    const meets =
      rule.atLeast === 0 ? null : flagged >= rule.atLeast ? true : flagged + unanswered < rule.atLeast ? false : null;
    return { domain, answered, of: rule.items.length, flagged, missing, meets };
  });
}

/** Items 1-20 taken together, the Kihon Checklist's overall 生活機能 criterion. */
export const OVERALL_RULE = { items: 20, atLeast: 10 };

export interface OverallStatus {
  answered: number;
  of: number;
  flagged: number;
  meets: boolean | null;
}

export function overallStatus(answers: readonly ItemAnswer[], asOf: string): OverallStatus {
  const current = currentAnswers(answers, asOf);
  let answered = 0;
  let flagged = 0;
  for (let n = 1; n <= OVERALL_RULE.items; n += 1) {
    const id = ASKABLE.get(n);
    if (!id) continue;
    const a = current.get(id);
    if (!a) continue;
    const option = screenItem(id).options[a.option];
    if (!option) continue;
    answered += 1;
    if (option.risk) flagged += 1;
  }
  const unanswered = OVERALL_RULE.items - answered;
  const meets =
    flagged >= OVERALL_RULE.atLeast ? true : flagged + unanswered < OVERALL_RULE.atLeast ? false : null;
  return { answered, of: OVERALL_RULE.items, flagged, meets };
}
