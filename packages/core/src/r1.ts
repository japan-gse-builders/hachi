export type R1Category =
  | 'chest_pain'
  | 'breathing'
  | 'unable_to_move'
  | 'stroke_signs'
  | 'loss_of_consciousness'
  | 'severe_bleeding'
  | 'fear_of_dying'
  | 'calling_for_help'
  /** The B and the E of BE-FAST, and the headache that is the classic warning of a bleed. */
  | 'sudden_headache'
  | 'vision_loss'
  | 'balance_loss';

export interface R1Signal {
  category: R1Category;
  /** Verbatim utterance that triggered the signal. */
  quote: string;
  /** Matched phrase in normalized form. */
  matched: string;
  confidence: number;
  hedged: boolean;
}

interface R1Pattern {
  category: R1Category;
  regex: RegExp;
  /** Often brief and harmless (effort, laughter, excitement): excluded once told in the past tense as over. */
  passing?: boolean;
  /** Often a long-standing limitation: excluded when told as one, unless a fall or being stuck is mentioned. */
  chronic?: boolean;
}

const S = "[^.!?]"; // stays inside one sentence
const LIMB = "my (?:left |right )?(?:arm|leg|hand)";

const PATTERNS: R1Pattern[] = [
  { category: 'chest_pain', regex: new RegExp(`\\bchest\\b${S}{0,30}?\\b(pains?|hurts?|hurting|tight|tightness|pressure|heavy|aches?|aching|squeez\\w*|burning|crushing|funny|strange|weird|wrong|(?:isn't|is not|not|doesn't feel|does not feel) right)\\b`, 'g') },
  { category: 'chest_pain', regex: new RegExp(`\\b(pain|pressure|tightness|ache)\\b${S}{0,20}?\\b(in|on|across) my chest\\b`, 'g') },
  { category: 'chest_pain', regex: /\bheart attack\b/g },
  { category: 'chest_pain', regex: new RegExp(`\\bmy heart\\b${S}{0,20}?\\b(racing|pounding|hurts?|pain|skipping|fluttering)\\b`, 'g'), passing: true },
  { category: 'breathing', regex: /\b(cannot|can't|can (?:hardly|barely|scarcely)|unable to|hard to|hurts to|painful to|trouble|struggling to|difficult to|difficulty)\s+(?:seem to\s+)?(breathe|breathing|catch my breath|get (?:enough )?air)\b/g, passing: true },
  { category: 'breathing', regex: /\b(short(?:ness)? of breath|out of breath|breathless|gasping|(?:struggling|fighting) for (?:breath|air)|keep (?:having to )?stop(?:ping)? for (?:breath|air))\b/g, passing: true },
  { category: 'breathing', regex: /\b(choking|(?:stuck|lodged) in my throat)\b/g, passing: true },
  { category: 'unable_to_move', regex: /\b(cannot|can't|unable to)\s+(?:seem to\s+)?(get (?:myself |back )?up\b(?!\s+(?:the|a|an|that|those|these|any)\s+(?!floor\b|ground\b))|stand up\b|stand\b(?!\s+(?:the|it|him|her|them|that|this|those|these|people|being|how|when)\b)|move\b(?!\s+(?:the|a|an|that|this|those|these|house)\b)|get off the floor\b)/g, chronic: true },
  { category: 'unable_to_move', regex: /\b((?:stuck|trapped) (?:on|in) (?:the|my) (?:\w+ )?(?:floor|ground|chair|armchair|bath|bathtub|toilet)|still on the (?:\w+ )?(?:floor|ground))\b/g },
  { category: 'unable_to_move', regex: new RegExp(`\\b(?:been|lying|lain) on the (?:\\w+ )?(?:floor|ground)\\b${S}{0,30}?\\b(since|all night|all day|overnight|for hours)\\b`, 'g') },
  { category: 'unable_to_move', regex: /\b(legs? (?:just )?(?:won't|will not) (?:hold|carry|support) me|too (?:much|weak|dizzy|painful) to (?:move|stand|get up))\b/g, chronic: true },
  { category: 'stroke_signs', regex: new RegExp(`\\b(numb|numbness|weak|weakness|tingling)\\b${S}{0,25}?\\b(one side|left side|right side|my arm|my face|my leg)\\b`, 'g') },
  { category: 'stroke_signs', regex: new RegExp(`\\b((?:face|mouth|lips?|eyelid)\\b${S}{0,20}?\\bdroop\\w*|slurr\\w*|(?:cannot|can't) (?:lift|move|raise|feel) ${LIMB}|(?:cannot|can't) speak properly|words? (?:\\w+ ){0,3}?(?:come|comes|coming) out (?:all )?(?:wrong|jumbled|muddled|garbled))`, 'g') },
  { category: 'stroke_signs', regex: new RegExp(`\\b${LIMB}\\b${S}{0,20}?\\b(floppy|limp|useless|gone (?:all )?(?:heavy|weak))\\b`, 'g') },
  { category: 'loss_of_consciousness', regex: /\b(passed out|fainted|blacked out|blacking out|going to faint|about to faint|going to pass out)\b/g },
  { category: 'loss_of_consciousness', regex: /\b(?:feel|feels|feeling|felt) (?:\w+ ){0,2}?faint\b/g, passing: true },
  { category: 'severe_bleeding', regex: new RegExp(`\\b(bleeding|blood)\\b${S}{0,25}?\\b(won't stop|will not stop|a lot|heavily|everywhere)\\b`, 'g') },
  { category: 'severe_bleeding', regex: /\b(coughing up|vomiting|throwing up) blood\b/g },
  { category: 'fear_of_dying', regex: /\b(?:i'm|i am)\s+(?:dying|going to die|gonna die)\b(?!\s+(?:to|for|of)\b)/g },
  { category: 'fear_of_dying', regex: /\bi (?:think|feel like) i(?:'m| am)? (?:dying|going to die|gonna die)\b/g },
  { category: 'calling_for_help', regex: /\b(call (?:an )?ambulance|need (?:an )?ambulance|please help(?: me)?|somebody help|someone help|call (?:911|999|112|119))\b/g },
  // A request that ends there ("send someone?", "get someone to come round, please"), not an errand ("send someone to fix the boiler").
  { category: 'calling_for_help', regex: /\b(?:get|send|fetch) (?:someone|somebody|help)(?: (?:to come|round|over|here|now|quickly))*(?=\s*(?:[,.!?]|please\b|$))/g },
  { category: 'calling_for_help', regex: /\bneed (?:a doctor|help)\b(?!'s|\s+(?:with|to|for|about|appointment)\b)/g },
  // A headache is only a red flag when it is unlike their others, so the wording has to carry that.
  { category: 'sudden_headache', regex: new RegExp(`\\b(worst|terrible|blinding|thunderclap)\\b${S}{0,20}?\\bheadache\\b`, 'g'), passing: true },
  { category: 'sudden_headache', regex: new RegExp(`\\bheadache\\b${S}{0,25}?\\b(worst|never had|like nothing|came on suddenly|all of a sudden|hit me)\\b`, 'g'), passing: true },
  // "I can't see the doctor until Tuesday" and "I can't see why" are not this, so the object is fixed.
  { category: 'vision_loss', regex: /\b(?:cannot|can't)\s+see\s+(?:anything|a thing|properly|straight|out of (?:my|one) (?:left |right )?eye)\b/g, chronic: true },
  { category: 'vision_loss', regex: new RegExp(`\\b(lost|losing)\\b${S}{0,15}?\\b(sight|vision)\\b|\\b(?:my )?(?:sight|vision)\\b${S}{0,15}?\\b(?:has )?(?:gone|went)\\b`, 'g') },
  { category: 'vision_loss', regex: /\b(double vision|seeing double|went blind)\b/g },
  { category: 'balance_loss', regex: new RegExp(`\\b(?:cannot|can't|unable to)\\b${S}{0,15}?\\b(?:keep|get) my balance\\b`, 'g'), chronic: true },
  { category: 'balance_loss', regex: new RegExp(`\\b(?:the room|everything)\\b${S}{0,15}?\\b(?:spinning|whirling)\\b`, 'g'), passing: true },
  { category: 'balance_loss', regex: /\b(?:keep (?:veering|lurching) (?:over|to one side)|keep walking into (?:the )?walls?)\b/g },
];

const NEGATORS = /\b(no|not|never|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't|without|nothing|none|nor)\b/;
const EPISTEMIC = /\b(?:don't|do not) (?:know|think|understand|remember)\b|\bnot sure\b/g;
const DISTANT_PAST = /\b(years? ago|months? ago|weeks? ago|last (?:year|month|summer|winter|spring|autumn)|when i was|used to|back then|in the past|long time ago|decades? ago|as a child|in (?:19|20)\d\d)\b/;
const STILL_CURRENT = /\b(since|still|again|right now|at the moment|today|tonight|this morning|currently)\b/;
/** Negations that are part of the symptom phrase itself. */
const INTRINSIC_NEGATION = /\b(?:(?:isn't|is not|not|doesn't feel|does not feel) right|(?:won't|will not) (?:stop|hold|carry|support))\b/g;
const THIRD_PERSON = /\b(he|she|they|someone|somebody|people|everyone|(?:my|our|his|her|their) (?:friend|husband|wife|son|daughter|neighbou?r|sister|brother|mother|father|mum|mom|dad|cousin|grandson|granddaughter|grandchild|partner|dog|cat)|(?:a|an|the|this|that) (?:\w+ )?(?:man|woman|lady|gentleman|boy|girl|chap|fellow|person|patient|character|hero|heroine|detective|actor|actress|victim|neighbou?r)|(?:mr|mrs|ms|miss) \w+)\b/;
const FIRST_PERSON = /\b(i|i'm|i've|i'd|me|myself)\b|\bmy (?:chest|heart|breath|breathing|arm|arms|leg|legs|face|head|body|side|stomach)\b/;
const PERSON = new RegExp(`${FIRST_PERSON.source}|${THIRD_PERSON.source}`, 'g');
const HYPOTHETICAL = /\b(if|in case|what if|imagine)\b/;
/** "You gave me a heart attack", "it'll give me a heart attack". */
const FIGURATIVE = /\b(?:give|gives|gave|giving|given) (?:me|us|you|him|her|them)(?: \w+)?\s*$/;
const HEDGES = /\b(a bit|a little|slightly|kind of|sort of|somewhat|maybe|probably nothing|not a big deal|no big deal|it's nothing)\b/;
const CLAUSE_BREAK = /[,;:]|\b(?:but|and|though|although|because|however|except)\b/g;
/** Clause starts used to find who a clause is about; "and" / "then" can drop the subject ("she fell and can't get up"). */
const SUBJECT_SPLIT = /([,;:]|\b(?:and|but|or|then|so|because|though|although|however|except|where|who|when|while|whose)\b)/;
const ELIDED_SUBJECT = /^(?:and|or|then)$/;
const PAST_FRAME = /\b(was|were|had|got|felt|went)\b/;
const RESOLVED = /\b((?:it|that|this|which) (?:passed|went (?:away|off)|settled|eased|stopped|wore off|cleared|came (?:up|out))|(?:i was|i felt|i'm|i am|i feel) (?:\w+ )?(?:fine|ok|okay|all right|alright|better|normal|myself)|(?:got|caught) my breath(?: back)?|coughed it (?:up|out))\b/;
const ONGOING = /\b(still|again|right now|at the moment|currently|worse|won't|keeps?|(?:it's|it is|it has|it came|they've|they have) (?:come )?back)\b/;
const MERRIMENT = /\b(laugh\w*|giggl\w*|in stitches|excit\w*|thrill\w*)\b/;
const OCCASION = /^\W*(?:\w+ ){0,4}?(?:when|while) (?:i|we) (?:was |were )?(?:watch\w*|saw|seeing|heard|hearing|read|reading|listen\w*|met|won)\b/;
const CHRONIC = /\b(easily|anymore|any more|any longer|these days|nowadays|like i used to)\b/;
const ACUTE_CONTEXT = /\b(fell|fallen|fall|on the (?:\w+ )?(?:floor|ground)|stuck|since|all night|for hours|help)\b/;
const SENTENCE_BREAK = /[.!?]/g;

export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\bcan not\b/g, 'cannot')
    .replace(/\bcan ?t\b/g, "can't")
    .replace(/\b(?:not able to|no longer able to)\b/g, 'unable to')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastBoundary(text: string, re: RegExp, before: number): number {
  let idx = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < before) {
    idx = m.index + m[0].length;
  }
  return idx;
}

function nextBoundary(text: string, re: RegExp, after: number): number {
  re.lastIndex = after;
  const m = re.exec(text);
  return m ? m.index : text.length;
}

function lastWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(-n).join(' ');
}

/**
 * Whether the symptom belongs to someone else: the nearest person named before it in its own
 * clause, or, when that clause has none after "and" / "then", the subject of the clause before.
 */
function aboutSomeoneElse(sentenceBefore: string, matchText: string): boolean {
  if (FIRST_PERSON.test(`${lastWords(sentenceBefore, 1)} ${matchText}`)) return false;
  const parts = sentenceBefore.split(SUBJECT_SPLIT);
  let i = parts.length - 1;
  let refs = parts[i]!.match(PERSON);
  if (refs) return !FIRST_PERSON.test(refs.at(-1)!);
  while (!refs && i >= 2 && ELIDED_SUBJECT.test(parts[i - 1]!)) {
    i -= 2;
    refs = parts[i]!.match(PERSON);
  }
  return refs ? !FIRST_PERSON.test(refs[0]!) : false;
}

/** Told in the past tense as over, or as a reaction to laughter, excitement or something watched. */
function isPassing(text: string, sentenceStart: number, sentenceEnd: number, clauseBefore: string, start: number, end: number): boolean {
  if (!PAST_FRAME.test(`${clauseBefore}${text.slice(start, end)}`)) return false;
  if (ONGOING.test(text.slice(sentenceStart))) return false;
  return RESOLVED.test(text.slice(end)) || MERRIMENT.test(text.slice(sentenceStart, sentenceEnd)) || OCCASION.test(text.slice(end, sentenceEnd));
}

function isExcluded(pattern: R1Pattern, text: string, start: number, end: number): boolean {
  const matchText = text.slice(start, end);
  const sentenceStart = lastBoundary(text, SENTENCE_BREAK, start);
  const sentenceEnd = nextBoundary(text, SENTENCE_BREAK, end);
  const clauseStart = Math.max(lastBoundary(text, CLAUSE_BREAK, start), sentenceStart);
  const clauseBefore = text.slice(clauseStart, start);
  const sentence = text.slice(sentenceStart, sentenceEnd);

  const negationScope = `${lastWords(clauseBefore, 6)} ${matchText.replace(INTRINSIC_NEGATION, ' ')}`.replace(EPISTEMIC, ' ');
  if (NEGATORS.test(negationScope)) return true;

  if (DISTANT_PAST.test(sentence) && !STILL_CURRENT.test(sentence)) return true;

  if (aboutSomeoneElse(text.slice(sentenceStart, start), matchText)) return true;

  if (HYPOTHETICAL.test(clauseBefore)) return true;

  if (FIGURATIVE.test(clauseBefore)) return true;

  if (pattern.passing && isPassing(text, sentenceStart, sentenceEnd, clauseBefore, start, end)) return true;

  if (pattern.chronic && CHRONIC.test(sentence) && !ACUTE_CONTEXT.test(text)) return true;

  return false;
}

/**
 * Deterministic safety net for in-call R1 detection (DET-01, DET-02, DET-05).
 * Runs alongside the LLM judgement; either one firing is treated as an emergency.
 */
export function detectR1(utterance: string): R1Signal[] {
  const text = normalizeUtterance(utterance);
  if (!text) return [];
  const found = new Map<R1Category, R1Signal>();
  for (const pattern of PATTERNS) {
    const { category, regex } = pattern;
    if (found.has(category)) continue;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (!isExcluded(pattern, text, m.index, m.index + m[0].length)) {
        const hedged = HEDGES.test(text);
        found.set(category, {
          category,
          quote: utterance.trim(),
          matched: m[0],
          confidence: hedged ? 0.7 : 0.9,
          hedged,
        });
        break;
      }
    }
  }
  return [...found.values()];
}

export interface TimedR1Signal extends R1Signal {
  startMs?: number;
  endMs?: number;
}

/**
 * Accumulates streaming transcript fragments of the resident's current turn and
 * emits each R1 category at most once per call.
 */
export class R1Monitor {
  private readonly emitted = new Set<R1Category>();
  private turnText = '';
  private turnStartMs: number | undefined;

  push(fragment: string, timing: { startMs?: number; endMs?: number } = {}): TimedR1Signal[] {
    if (!fragment.trim()) return [];
    if (this.turnStartMs === undefined) this.turnStartMs = timing.startMs;
    this.turnText = this.turnText ? `${this.turnText} ${fragment.trim()}` : fragment.trim();
    const fresh: TimedR1Signal[] = [];
    for (const signal of detectR1(this.turnText)) {
      if (this.emitted.has(signal.category)) continue;
      this.emitted.add(signal.category);
      fresh.push({ ...signal, startMs: this.turnStartMs, endMs: timing.endMs });
    }
    return fresh;
  }

  endTurn(): void {
    this.turnText = '';
    this.turnStartMs = undefined;
  }

  get hasEmergency(): boolean {
    return this.emitted.size > 0;
  }
}
