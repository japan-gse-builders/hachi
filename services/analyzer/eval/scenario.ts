/**
 * SYNTHETIC R3 evaluation scenario (USR-04: everything generated here is synthetic and must be
 * labelled as such). Deterministic for a given seed: the same seed always yields the same people,
 * calls, scripted pauses and inserted disfluencies.
 */
import type { SpeechFeature } from '@hachi/core';

export type Expected = 'none' | 'watch' | 'action';
export type ChangeKind = 'none' | 'slower' | 'repairs' | 'vocabulary' | 'drift' | 'mild';
export const DISFLUENCY_KINDS = ['filler', 'repetition', 'false_start', 'correction'] as const;
export type DisfluencyKind = (typeof DISFLUENCY_KINDS)[number];

export interface Vocab {
  relatives: { rel: string; name: string }[];
  friends: string[];
  hobbies: string[];
  places: string[];
  breakfast: string[];
  lunch: string[];
  dinner: string[];
  shows: string[];
}

export interface PersonProfile {
  id: string;
  name: string;
  voice: string;
  speakingRate: number;
  /** Typical pause before answering, in ms. */
  gapMs: number;
  /** Typical disfluencies per 100 spoken words. */
  repairPer100: number;
  change: ChangeKind;
  /** Day of a one-off call where the person has a cold (SPK-04 exclusion). */
  badDay?: number;
  expected: Expected;
  /** Features a detection should name for this change. */
  expectedFeatures: SpeechFeature[];
  note: string;
  vocab: Vocab;
}

export interface InsertedDisfluency {
  kind: DisfluencyKind;
  /** Index into the call's turns. */
  turn: number;
  /** Index of the clean word the disfluency is attached to. */
  word: number;
}

export interface ScriptedTurn {
  speaker: 'resident' | 'agent';
  /** What a live ASR would show: the answer without hesitations. */
  text: string;
  /** What is synthesised, hesitations included. */
  spoken: string;
  /** Silence between the end of the previous turn and the start of this one. */
  gapBeforeMs: number;
}

export interface ScriptedCall {
  id: string;
  personId: string;
  day: number;
  startedAt: string;
  /** 0 = baseline behaviour, 1 = full change. */
  strength: number;
  condition?: 'cold';
  turns: ScriptedTurn[];
  disfluencies: InsertedDisfluency[];
}

export interface ScenarioPerson {
  profile: PersonProfile;
  calls: ScriptedCall[];
}

export interface Scenario {
  seed: number;
  serviceStartedAt: string;
  people: ScenarioPerson[];
}

export const SERVICE_STARTED_AT = '2026-06-01T00:00:00.000Z';
export const BASELINE_CALL_DAYS = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27];
export const RECENT_CALL_DAYS = [28, 29, 30, 31, 32];
export const CALL_DAYS = [...BASELINE_CALL_DAYS, ...RECENT_CALL_DAYS];
export const CHANGE_START_DAY = 28;
export const HACHI_VOICE = 'en-GB-Chirp3-HD-Zephyr';

// ---------------------------------------------------------------- deterministic randomness

export type Rng = () => number;

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for test data. Not for anything security related. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(r: Rng): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function poisson(r: Rng, mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = r();
  while (p > limit) {
    k++;
    p *= r();
  }
  return k;
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- people

const v = (relatives: [string, string][], friends: string[], hobbies: string[], places: string[], breakfast: string[], lunch: string[], dinner: string[], shows: string[]): Vocab => ({
  relatives: relatives.map(([rel, name]) => ({ rel, name })),
  friends,
  hobbies,
  places,
  breakfast,
  lunch,
  dinner,
  shows,
});

export const PEOPLE: PersonProfile[] = [
  {
    id: 'syn-s1',
    name: 'Margaret',
    voice: 'en-GB-Chirp3-HD-Gacrux',
    speakingRate: 0.9,
    gapMs: 1500,
    repairPer100: 1.5,
    change: 'none',
    expected: 'none',
    expectedFeatures: [],
    note: 'stable',
    vocab: v([['daughter', 'Sarah'], ['grandson', 'Tom']], ['Mrs Sato', 'Keiko'], ['gardening', 'crosswords'], ['the park', 'the supermarket'], ['porridge with honey', 'toast and marmalade'], ['a cheese sandwich', 'tomato soup'], ['salmon with rice', 'a chicken stew'], ['a cooking programme', 'the news']),
  },
  {
    id: 'syn-s2',
    name: 'Arthur',
    voice: 'en-GB-Chirp3-HD-Algenib',
    speakingRate: 0.9,
    gapMs: 1700,
    repairPer100: 2,
    change: 'none',
    expected: 'none',
    expectedFeatures: [],
    note: 'stable',
    vocab: v([['son', 'David'], ['granddaughter', 'Emily']], ['Mr Tanaka', 'Ken'], ['woodwork', 'birdwatching'], ['the river', 'the hardware shop'], ['boiled eggs', 'a bowl of cereal'], ['a pork cutlet', 'a ham sandwich'], ['fish and potatoes', 'curry rice'], ['the football', 'a history documentary']),
  },
  {
    id: 'syn-s3',
    name: 'Dorothy',
    voice: 'en-GB-Chirp3-HD-Vindemiatrix',
    speakingRate: 0.85,
    gapMs: 2600,
    repairPer100: 6,
    change: 'none',
    expected: 'none',
    expectedFeatures: [],
    note: 'stable; inherently slow and hesitant speaker',
    vocab: v([['niece', 'Helen'], ['son', 'Peter']], ['Mrs Ito', 'Yumi'], ['painting', 'reading'], ['the library', 'the temple'], ['a boiled egg and toast', 'yoghurt with fruit'], ['udon noodles', 'a jacket potato'], ['grilled mackerel', 'vegetable soup'], ['a quiz show', 'an old film']),
  },
  {
    id: 'syn-s4',
    name: 'Harold',
    voice: 'en-GB-Chirp3-HD-Charon',
    speakingRate: 0.9,
    gapMs: 1600,
    repairPer100: 2,
    change: 'none',
    badDay: 30,
    expected: 'none',
    expectedFeatures: [],
    note: 'stable; one bad-day call with a cold on day 30 (should be excluded, SPK-04)',
    vocab: v([['daughter', 'Claire'], ['brother', 'John']], ['Mr Suzuki', 'Hiro'], ['golf', 'model trains'], ['the golf range', 'the station'], ['bacon and eggs', 'toast with butter'], ['a bento box', 'a bowl of ramen'], ['roast chicken', 'beef stew'], ['the cricket', 'a nature programme']),
  },
  {
    id: 'syn-s5',
    name: 'Joan',
    voice: 'en-GB-Chirp3-HD-Leda',
    speakingRate: 0.95,
    gapMs: 1300,
    repairPer100: 1,
    change: 'none',
    expected: 'none',
    expectedFeatures: [],
    note: 'stable',
    vocab: v([['granddaughter', 'Lucy'], ['sister', 'Anne']], ['Mrs Kato', 'Mariko'], ['knitting', 'baking'], ['the market', 'the community centre'], ['muesli', 'a croissant'], ['a salad', 'rice balls'], ['shepherd’s pie', 'tofu and vegetables'], ['a drama series', 'the weather report']),
  },
  {
    id: 'syn-c1',
    name: 'Edith',
    voice: 'en-GB-Chirp3-HD-Sulafat',
    speakingRate: 0.9,
    gapMs: 1500,
    repairPer100: 1.5,
    change: 'slower',
    expected: 'action',
    expectedFeatures: ['responseLatencyMs'],
    note: 'responses become 70–100% slower',
    vocab: v([['son', 'Michael'], ['grandson', 'Jack']], ['Mrs Yamada', 'Sachiko'], ['sewing', 'the piano'], ['the shrine', 'the bakery'], ['toast with jam', 'porridge'], ['a tuna sandwich', 'miso soup'], ['pasta with tomato sauce', 'grilled chicken'], ['a gardening show', 'the evening news']),
  },
  {
    id: 'syn-c2',
    name: 'Walter',
    voice: 'en-GB-Chirp3-HD-Fenrir',
    speakingRate: 0.9,
    gapMs: 1600,
    repairPer100: 2,
    change: 'repairs',
    expected: 'action',
    expectedFeatures: ['repairRate'],
    note: 'self-repairs become 3× more frequent',
    vocab: v([['daughter', 'Rachel'], ['nephew', 'Sam']], ['Mr Kimura', 'Taro'], ['fishing', 'chess'], ['the harbour', 'the coffee shop'], ['a fried egg', 'toast and tea'], ['a chicken sandwich', 'soba noodles'], ['steak and chips', 'sushi'], ['the rugby', 'a quiz programme']),
  },
  {
    id: 'syn-c3',
    name: 'Irene',
    voice: 'en-GB-Chirp3-HD-Aoede',
    speakingRate: 0.9,
    gapMs: 1500,
    repairPer100: 1.5,
    change: 'vocabulary',
    expected: 'action',
    expectedFeatures: ['lexicalDiversity'],
    note: 'vocabulary narrows; answers become repetitive',
    vocab: v([['daughter', 'Laura'], ['granddaughter', 'Mia']], ['Mrs Hayashi', 'Naoko'], ['flower arranging', 'jigsaws'], ['the botanical garden', 'the department store'], ['a banana and toast', 'rice porridge'], ['a vegetable curry', 'an egg sandwich'], ['grilled salmon', 'pork and cabbage'], ['a travel programme', 'a cookery show']),
  },
  {
    id: 'syn-c4',
    name: 'George',
    voice: 'en-GB-Chirp3-HD-Orus',
    speakingRate: 0.9,
    gapMs: 1600,
    repairPer100: 1.5,
    change: 'drift',
    expected: 'action',
    expectedFeatures: ['topicCoherence'],
    note: 'answers drift off the question; mild slowing (+30%)',
    vocab: v([['son', 'Richard'], ['grandson', 'Oliver']], ['Mr Watanabe', 'Kenji'], ['photography', 'the crossword'], ['the beach', 'the bookshop'], ['kippers', 'a slice of toast'], ['a bowl of soup', 'a beef sandwich'], ['lamb chops', 'tempura'], ['the snooker', 'a wildlife film']),
  },
  {
    id: 'syn-c5',
    name: 'Mary',
    voice: 'en-GB-Neural2-C',
    speakingRate: 0.9,
    gapMs: 1500,
    repairPer100: 1.5,
    change: 'mild',
    expected: 'watch',
    expectedFeatures: ['responseLatencyMs', 'repairRate', 'lexicalDiversity'],
    note: 'mild combined change (+35% latency, ×1.6 repairs, slightly narrower vocabulary)',
    vocab: v([['son', 'Andrew'], ['sister', 'Jean']], ['Mrs Mori', 'Aiko'], ['walking', 'watercolours'], ['the canal', 'the post office'], ['cornflakes', 'a boiled egg'], ['a ploughman’s lunch', 'onigiri'], ['fish pie', 'stir-fried vegetables'], ['a period drama', 'the radio play']),
  },
];

// ---------------------------------------------------------------- dialogue material

type Topic = 'feeling' | 'meals' | 'yesterday' | 'family' | 'hobby' | 'plans' | 'weather';
const OTHER_TOPICS: Topic[] = ['meals', 'yesterday', 'family', 'hobby', 'plans', 'weather'];

const QUESTIONS: Record<Topic, string[]> = {
  feeling: ['How are you feeling today?', 'How have you been feeling since we last spoke?'],
  meals: ['Have you had something to eat today?', 'What have you been eating these last few days?', 'What did you have for breakfast this morning?'],
  yesterday: ['What did you get up to yesterday?', 'Did you go out at all yesterday?'],
  family: ['Have you heard from your family recently?', 'Has anyone been in touch this week?'],
  hobby: ['Have you had time for {hobby} lately?', 'What have you been enjoying doing lately?'],
  plans: ['Do you have any plans for the weekend?', 'Is anything coming up this week?'],
  weather: ['How has the weather been where you are?', 'Has it been warm where you are?'],
};

const ACKS = ['That is good to hear.', 'Oh, how lovely.', 'I see.', 'Thank you for telling me.', 'That sounds nice.', 'Mm, I understand.'];

const SENTENCES: Record<Topic, string[]> = {
  feeling: [
    'I am feeling quite well today, thank you for asking.',
    'Not too bad. I slept right through the night for once.',
    'My knees have been a bit stiff this {time}, but I cannot complain.',
    'I am all right. I had a nice hot bath last night and that helped.',
    'I feel rested today, I went to bed early with a good book.',
    'Fairly good, thank you. My back is better than it was on {day}.',
    'I am in good spirits, the sun came through the curtains this morning.',
    'A little tired, but nothing to worry about, I stayed up late watching {show}.',
  ],
  meals: [
    'I had {breakfast} for breakfast, the same as most mornings.',
    'For lunch I made myself {lunch}, and it was very good.',
    'Last night I cooked {dinner}, and there is some left for today.',
    'I have a good appetite at the moment, I finished everything on my plate.',
    '{relative} brought me some fruit, so I had an apple after lunch.',
    'I bought fresh bread from the bakery near {place} on {day}.',
    'I am trying to drink more water, I keep a glass by the kettle.',
    'I had a cup of tea and two biscuits around four o’clock.',
  ],
  yesterday: [
    'Yesterday I walked down to {place} and back, which took most of the {time}.',
    'I spent the afternoon on {hobby}, I lost track of the time completely.',
    'I tidied the kitchen and sorted out a drawer full of old letters.',
    '{relative} phoned in the evening and we chatted for an hour.',
    'I went to {place} with {friend} and we had coffee afterwards.',
    'It rained, so I stayed indoors and watched {show} on the television.',
    'I did some washing and hung it out on the balcony to dry.',
    'I wrote a postcard to my cousin in Manchester and posted it.',
  ],
  family: [
    '{relative} rang me on {day} to ask how I was getting on.',
    'My grandchildren sent me a drawing, it is on the fridge now.',
    '{relative} is coming to visit next month, I am so looking forward to it.',
    'We had a video call on Sunday, the little one has grown so much.',
    'I have not heard from {relative} this week, but they are very busy at work.',
    '{friend} from next door popped round with some flowers from her garden.',
    'My {rel} sends me photographs of the garden back home in England.',
    'I spoke to my cousin on the phone for a long time, she sounds well.',
  ],
  hobby: [
    'I have been doing {hobby} most days, it keeps my mind busy.',
    'I finished a jigsaw of the Lake District, a thousand pieces.',
    'I have started knitting a scarf for {relative}, in dark green wool.',
    'I read two chapters of a mystery novel before bed every night.',
    'I go to a small English conversation group at the community centre on {day}.',
    'I have been listening to the radio, there was a lovely concert on {day} evening.',
    'I potted some herbs on the balcony, basil and a bit of mint.',
    '{friend} and I play cards together on {day} afternoons.',
  ],
  plans: [
    'On {day} I have a doctor’s appointment at the clinic near {place}.',
    'I am meeting {friend} for lunch on {day}, we usually go to a little noodle shop.',
    '{relative} is taking me shopping at the weekend, I need new shoes.',
    'Nothing special this week, just my usual walk to {place}.',
    'I want to visit the temple garden when the autumn leaves change colour.',
    'The community centre is having a tea party on {day}, and I said I would bake something.',
    'I will probably do some {hobby} and keep the flat tidy.',
    'I have to go to the post office to send a parcel to {relative}.',
  ],
  weather: [
    'It has been quite warm, warmer than I am used to back in England.',
    'It rained on {day}, but today it is clear and bright.',
    'The mornings are getting cooler, I have put an extra blanket on the bed.',
    'It was windy yesterday, the washing nearly blew away.',
    'Lovely sunshine this {time}, I sat on the balcony with my tea.',
    'It is a bit humid, so I keep the fan going in the afternoon.',
    'The forecast says a typhoon might come later in the week.',
    'Grey and cloudy, but at least it is not too hot.',
  ],
};

/** Reduced vocabulary: the same few stock phrases, whatever the question. */
const GENERIC = [
  'It was fine, you know.',
  'Just the usual things, really.',
  'Nothing much, it was all right.',
  'I was at home, you know, just at home.',
  'It was nice, it was a nice day.',
  'I did the usual, you know, the same things.',
  'Yes, it was all right, nothing much really.',
  'Oh, the usual, it was nice.',
];

/** Topic drift: statements unrelated to the question and to each other. */
const OFF_TOPIC = [
  'The trains used to be green when I was a girl.',
  'My neighbour’s cat has a little red collar.',
  'We had a blue car once, a long time ago.',
  'The radio said something about the price of rice.',
  'My father kept bees in the garden behind the house.',
  'There was a man selling umbrellas outside the station.',
  'I never did like the colour orange very much.',
  'The school I went to had a big clock on the tower.',
  'Somebody left a bicycle by the vending machine.',
  'The postman in our old village had a dog called Biscuit.',
  'Those big ships in the harbour go all the way to Australia.',
  'My mother always said you should never whistle indoors.',
];

const COLD = ['I have caught a bit of a cold, my throat is sore and my nose is all blocked up.', 'Sorry if I sound croaky, it is this cold.'];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMES = ['morning', 'afternoon', 'evening'];

/** Words a self-correction can swap ("on Tuesday, no, Wednesday"). */
const CORRECTABLE: string[][] = [
  DAYS,
  TIMES,
  ['breakfast', 'lunch', 'dinner'],
  ['two', 'three', 'four', 'five'],
  ['son', 'daughter', 'grandson', 'granddaughter', 'sister', 'brother', 'niece', 'nephew', 'cousin'],
  ['yesterday', 'today'],
];
const FILLERS = ['um', 'uh', 'er'];

function fill(r: Rng, template: string, p: PersonProfile): string {
  const rel = pick(r, p.vocab.relatives);
  const out = template
    .replace(/\{relative\}/g, `my ${rel.rel} ${rel.name}`)
    .replace(/\{rel\}/g, rel.rel)
    .replace(/\{friend\}/g, () => pick(r, p.vocab.friends))
    .replace(/\{hobby\}/g, () => pick(r, p.vocab.hobbies))
    .replace(/\{place\}/g, () => pick(r, p.vocab.places))
    .replace(/\{breakfast\}/g, () => pick(r, p.vocab.breakfast))
    .replace(/\{lunch\}/g, () => pick(r, p.vocab.lunch))
    .replace(/\{dinner\}/g, () => pick(r, p.vocab.dinner))
    .replace(/\{show\}/g, () => pick(r, p.vocab.shows))
    .replace(/\{day\}/g, () => pick(r, DAYS))
    .replace(/\{time\}/g, () => pick(r, TIMES));
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------- behaviour over time

export interface Effects {
  gapFactor: number;
  repairFactor: number;
  genericShare: number;
  offTopicShare: number;
}

/** Change ramps in quickly after the baseline window: 70% on day 28, full from day 30. */
export function changeStrength(day: number): number {
  if (day < CHANGE_START_DAY) return 0;
  return Math.min(1, 0.7 + 0.15 * (day - CHANGE_START_DAY));
}

export function effectsFor(change: ChangeKind, s: number): Effects {
  const e: Effects = { gapFactor: 1, repairFactor: 1, genericShare: 0, offTopicShare: 0 };
  switch (change) {
    case 'slower':
      return { ...e, gapFactor: 1 + 0.85 * s };
    case 'repairs':
      return { ...e, repairFactor: 1 + 2 * s };
    case 'vocabulary':
      return { ...e, genericShare: 0.85 * s };
    case 'drift':
      return { ...e, offTopicShare: 0.7 * s, gapFactor: 1 + 0.3 * s };
    case 'mild':
      return { ...e, gapFactor: 1 + 0.35 * s, repairFactor: 1 + 0.6 * s, genericShare: 0.3 * s };
    default:
      return e;
  }
}

// ---------------------------------------------------------------- disfluencies

/**
 * Inserts `kind` before/at word `i` of `words` (mutating the spoken form only). Returns false when
 * that kind cannot be placed at this word.
 */
function applyDisfluency(r: Rng, spoken: string[], clean: string[], i: number, kind: DisfluencyKind): boolean {
  const word = clean[i]!;
  const core = word.replace(/[^A-Za-z’']/g, '');
  const lower = core.toLowerCase();
  switch (kind) {
    case 'filler':
      spoken[i] = `${pick(r, FILLERS)}, ${spoken[i]}`;
      return true;
    case 'repetition':
      if (!core || core.length > 5) return false;
      spoken[i] = `${core} ${spoken[i]}`;
      return true;
    case 'false_start':
      if (core.length < 6) return false;
      spoken[i] = `${core.slice(0, 3).toLowerCase()}- ${spoken[i]}`;
      return true;
    case 'correction': {
      const group = CORRECTABLE.find((g) => g.includes(lower));
      if (!group) return false;
      const alt = pick(r, group.filter((w) => w !== lower));
      const cased = core[0] === core[0]!.toUpperCase() ? alt.charAt(0).toUpperCase() + alt.slice(1) : alt;
      spoken[i] = `${cased}, no, ${spoken[i]}`;
      return true;
    }
  }
}

const KIND_WEIGHTS: [DisfluencyKind, number][] = [
  ['filler', 0.4],
  ['repetition', 0.25],
  ['false_start', 0.2],
  ['correction', 0.15],
];

function drawKind(r: Rng): DisfluencyKind {
  let x = r();
  for (const [k, w] of KIND_WEIGHTS) {
    if ((x -= w) < 0) return k;
  }
  return 'filler';
}

// ---------------------------------------------------------------- calls

function answer(r: Rng, p: PersonProfile, topic: Topic, used: Set<string>, e: Effects, cold: boolean): string {
  const target = int(r, 20, 30);
  const parts: string[] = [];
  if (cold && topic === 'feeling') parts.push(...COLD);
  while (wordCount(parts.join(' ')) < target) {
    const x = r();
    if (x < e.offTopicShare) {
      const fresh = OFF_TOPIC.filter((s) => !used.has(s));
      const s = pick(r, fresh.length ? fresh : OFF_TOPIC);
      used.add(s);
      parts.push(s);
    } else if (x < e.offTopicShare + e.genericShare) {
      parts.push(pick(r, GENERIC));
    } else {
      const pool = SENTENCES[topic].filter((s) => !used.has(s));
      const t = pick(r, pool.length ? pool : SENTENCES[topic]);
      used.add(t);
      parts.push(fill(r, t, p));
    }
  }
  return parts.join(' ');
}

export function callId(personId: string, day: number): string {
  return `${personId}-d${String(day).padStart(2, '0')}`;
}

export function buildCall(seed: number, p: PersonProfile, day: number): ScriptedCall {
  const r = rng(hashSeed(seed, p.id, day));
  const strength = p.change === 'none' ? 0 : changeStrength(day);
  const cold = p.badDay === day;
  const e = cold ? { gapFactor: 1.8, repairFactor: 3, genericShare: 0, offTopicShare: 0 } : effectsFor(p.change, strength);
  const topics: Topic[] = ['feeling', ...shuffle(r, OTHER_TOPICS).slice(0, 4)];
  const used = new Set<string>();
  const callGap = Math.exp(0.1 * gaussian(r));

  const turns: ScriptedTurn[] = [];
  topics.forEach((topic, i) => {
    const q = fill(r, pick(r, QUESTIONS[topic]), p);
    const agent = i === 0 ? `Good morning ${p.name}, this is Hachi calling for our daily chat. ${q}` : `${pick(r, ACKS)} ${q}`;
    turns.push({ speaker: 'agent', text: agent, spoken: agent, gapBeforeMs: i === 0 ? 500 : int(r, 600, 1000) });
    const text = answer(r, p, topic, used, e, cold);
    const gap = Math.round(Math.min(9000, Math.max(600, p.gapMs * callGap * e.gapFactor * Math.exp(0.22 * gaussian(r)))));
    turns.push({ speaker: 'resident', text, spoken: text, gapBeforeMs: gap });
  });
  const closing = `Thank you, ${p.name}. It was lovely talking with you. I will call again tomorrow. Goodbye.`;
  turns.push({ speaker: 'agent', text: closing, spoken: closing, gapBeforeMs: int(r, 600, 1000) });

  // Disfluencies, spread over the answers in proportion to their length.
  const residentIdx = turns.flatMap((t, i) => (t.speaker === 'resident' ? [i] : []));
  const words = new Map(residentIdx.map((i) => [i, turns[i]!.text.split(' ')]));
  const spoken = new Map(residentIdx.map((i) => [i, [...words.get(i)!]]));
  const totalWords = residentIdx.reduce((a, i) => a + words.get(i)!.length, 0);
  const n = poisson(r, (p.repairPer100 * e.repairFactor * totalWords * Math.exp(0.15 * gaussian(r))) / 100);
  const taken = new Set<string>();
  const disfluencies: InsertedDisfluency[] = [];
  for (let k = 0, guard = 0; k < n && guard < n * 50; guard++) {
    let w = Math.floor(r() * totalWords);
    let turn = residentIdx[0]!;
    for (const i of residentIdx) {
      const len = words.get(i)!.length;
      if (w < len) {
        turn = i;
        break;
      }
      w -= len;
    }
    if (taken.has(`${turn}:${w}`)) continue;
    const kind = drawKind(r);
    if (!applyDisfluency(r, spoken.get(turn)!, words.get(turn)!, w, kind)) continue;
    taken.add(`${turn}:${w}`);
    disfluencies.push({ kind, turn, word: w });
    k++;
  }
  for (const i of residentIdx) turns[i] = { ...turns[i]!, spoken: spoken.get(i)!.join(' ') };
  disfluencies.sort((a, b) => a.turn - b.turn || a.word - b.word);

  const startedAt = new Date(Date.parse(SERVICE_STARTED_AT) + day * 86_400_000 + 3_600_000).toISOString();
  return { id: callId(p.id, day), personId: p.id, day, startedAt, strength, ...(cold ? { condition: 'cold' as const } : {}), turns, disfluencies };
}

export function generateScenario(seed: number, opts: { people?: number; calls?: number } = {}): Scenario {
  const people = PEOPLE.slice(0, opts.people ?? PEOPLE.length).map((profile) => ({
    profile,
    calls: CALL_DAYS.slice(0, opts.calls ?? CALL_DAYS.length).map((day) => buildCall(seed, profile, day)),
  }));
  return { seed, serviceStartedAt: SERVICE_STARTED_AT, people };
}

export function countByKind(ds: { kind: DisfluencyKind }[]): Record<DisfluencyKind, number> {
  const out = { filler: 0, repetition: 0, false_start: 0, correction: 0 };
  for (const d of ds) out[d.kind]++;
  return out;
}
