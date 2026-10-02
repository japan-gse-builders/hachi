export type R1Category =
  | 'chest_pain'
  | 'breathing'
  | 'unable_to_move'
  | 'stroke_signs'
  | 'loss_of_consciousness'
  | 'severe_bleeding'
  | 'fear_of_dying'
  | 'calling_for_help';

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
}

const S = "[^.!?]"; // stays inside one sentence

const PATTERNS: R1Pattern[] = [
  { category: 'chest_pain', regex: new RegExp(`\\bchest\\b${S}{0,30}?\\b(pains?|hurts?|hurting|tight|tightness|pressure|heavy|aches?|aching|squeez\\w*|burning|crushing|funny|strange|weird|wrong|(?:isn't|is not|not|doesn't feel|does not feel) right)\\b`, 'g') },
  { category: 'chest_pain', regex: new RegExp(`\\b(pain|pressure|tightness|ache)\\b${S}{0,20}?\\b(in|on|across) my chest\\b`, 'g') },
  { category: 'chest_pain', regex: /\bheart attack\b/g },
  { category: 'chest_pain', regex: new RegExp(`\\bmy heart\\b${S}{0,20}?\\b(racing|pounding|hurts?|pain|skipping|fluttering)\\b`, 'g') },
  { category: 'breathing', regex: /\b(cannot|can't|unable to|hard to|trouble|struggling to|difficult to|difficulty)\s+(breathe|breathing|catch my breath|get (?:enough )?air)\b/g },
  { category: 'breathing', regex: /\b(short(?:ness)? of breath|out of breath|breathless|gasping)\b/g },
  { category: 'unable_to_move', regex: /\b(cannot|can't|unable to)\s+(get up|stand up|stand|move|get off the floor)\b/g },
  { category: 'unable_to_move', regex: /\bstuck on the floor\b/g },
  { category: 'stroke_signs', regex: new RegExp(`\\b(numb|numbness|weak|weakness|tingling)\\b${S}{0,25}?\\b(one side|left side|right side|my arm|my face|my leg)\\b`, 'g') },
  { category: 'stroke_signs', regex: /\b(face\b[^.!?]{0,15}?\bdroop\w*|slurr\w*|cannot (?:lift|move) my (?:arm|leg)|can't (?:lift|move) my (?:arm|leg)|cannot speak properly|can't speak properly)/g },
  { category: 'loss_of_consciousness', regex: /\b(passed out|fainted|blacked out|blacking out|going to faint|about to faint|going to pass out)\b/g },
  { category: 'severe_bleeding', regex: new RegExp(`\\b(bleeding|blood)\\b${S}{0,25}?\\b(won't stop|will not stop|a lot|heavily|everywhere)\\b`, 'g') },
  { category: 'severe_bleeding', regex: /\b(coughing up|vomiting|throwing up) blood\b/g },
  { category: 'fear_of_dying', regex: /\b(?:i'm|i am)\s+(?:dying|going to die|gonna die)\b(?!\s+(?:to|for|of)\b)/g },
  { category: 'fear_of_dying', regex: /\bi (?:think|feel like) i(?:'m| am)? (?:dying|going to die|gonna die)\b/g },
  { category: 'calling_for_help', regex: /\b(call (?:an )?ambulance|need (?:an )?ambulance|please help(?: me)?|somebody help|someone help|call (?:911|999|112|119))\b/g },
];

const NEGATORS = /\b(no|not|never|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't|without|nothing|none|nor)\b/;
const EPISTEMIC = /\b(?:don't|do not) (?:know|think|understand|remember)\b|\bnot sure\b/g;
const DISTANT_PAST = /\b(years? ago|months? ago|weeks? ago|last (?:year|month|summer|winter|spring|autumn)|when i was|used to|back then|in the past|long time ago|decades? ago|as a child|in (?:19|20)\d\d)\b/;
const STILL_CURRENT = /\b(since|still|again|right now|at the moment|today|tonight|this morning|currently)\b/;
/** Negations that are part of the symptom phrase itself. */
const INTRINSIC_NEGATION = /\b(?:(?:isn't|is not|not|doesn't feel|does not feel) right|won't stop|will not stop)\b/g;
const THIRD_PERSON = /\b(he|she|they|someone|somebody|people|everyone|(?:my|our|his|her|their) (?:friend|husband|wife|son|daughter|neighbou?r|sister|brother|mother|father|mum|mom|dad|cousin|grandson|granddaughter|grandchild|partner|dog|cat))\b/;
const FIRST_PERSON = /\b(i|i'm|i've|i'd|me|myself)\b|\bmy (?:chest|heart|breath|breathing|arm|arms|leg|legs|face|head|body|side|stomach)\b/;
const HYPOTHETICAL = /\b(if|in case|what if|imagine)\b/;
const HEDGES = /\b(a bit|a little|slightly|kind of|sort of|somewhat|maybe|probably nothing|not a big deal|no big deal|it's nothing)\b/;
const CLAUSE_BREAK = /[,;:]|\b(?:but|and|though|although|because|however|except)\b/g;
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

function isExcluded(text: string, start: number, end: number): boolean {
  const matchText = text.slice(start, end);
  const sentenceStart = lastBoundary(text, SENTENCE_BREAK, start);
  const sentenceEnd = nextBoundary(text, SENTENCE_BREAK, end);
  const clauseStart = Math.max(lastBoundary(text, CLAUSE_BREAK, start), sentenceStart);
  const clauseEnd = Math.min(nextBoundary(text, CLAUSE_BREAK, end), sentenceEnd);
  const clauseBefore = text.slice(clauseStart, start);
  const clause = text.slice(clauseStart, clauseEnd);
  const sentence = text.slice(sentenceStart, sentenceEnd);

  const negationScope = `${lastWords(clauseBefore, 6)} ${matchText.replace(INTRINSIC_NEGATION, ' ')}`.replace(EPISTEMIC, ' ');
  if (NEGATORS.test(negationScope)) return true;

  if (DISTANT_PAST.test(clause) && !STILL_CURRENT.test(clause)) return true;
  if (DISTANT_PAST.test(sentence) && !STILL_CURRENT.test(sentence)) return true;

  if (THIRD_PERSON.test(clauseBefore) && !FIRST_PERSON.test(text.slice(clauseStart, end))) return true;

  if (HYPOTHETICAL.test(clauseBefore)) return true;

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
  for (const { category, regex } of PATTERNS) {
    if (found.has(category)) continue;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (!isExcluded(text, m.index, m.index + m[0].length)) {
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
