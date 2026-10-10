/**
 * Whether Hachi may hang up (issue #10). The model decides when to ask for the end of a call; these
 * checks decide whether it gets it, from what was actually said rather than from the tool call.
 * An older person whose phone goes dead mid-sentence has been hung up on, however good the reason,
 * so every check here leans towards keeping the call open: an ambiguous answer costs one more
 * question, a wrong guess costs the call.
 *
 * English only, like the calls. Transcripts arrive with or without punctuation, so nothing here
 * depends on it except where the absence only makes the answer more conservative.
 */

function normalized(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

const CALL = String.raw`(?:the |this |our )?(?:call|chat|conversation)`;
const END_CALL = String.raw`(?:end|finish|stop|close|wrap up) (?:with )?${CALL}`;
/** Ways of saying "end this call" that are not also ordinary words for something else. */
const ENDING = String.raw`(?:${END_CALL}|hang up|stop (?:talking|chatting)|finish for (?:now|today))`;

/** Wanting more of the call, said anywhere in the turn, outweighs any goodbye in it. */
const CONTINUE =
  /\b(?:wait|hold on|one more|not yet|keep (?:talking|chatting)|continue (?:talking|chatting|our)|don't|do not|not ready|not done|don't want|do not want|not want)\b/;
/** "Not … end", "never … goodbye": a negated ending is the opposite of one. */
const NEGATED = /\b(?:not|never|isn't|aren't|wasn't)(?:\W+\w+){0,3}\W+(?:end|finish|stop|hang|goodbye|over)\b/;
/** Reported, conditional and future endings are not a request to end this call now. */
const NOT_NOW = /\b(?:if|when|unless|after|before|said|says|told|tells|asked)\b/;
/** A question about ending is not a request to end. */
const QUESTION = /\?|\b(?:why|how|did you|are you|do you|will you|is it|is that|are we|have we|should we)\b/;
/** Leaving it for another day is not ending this call. */
const LATER = /\b(?:later|tomorrow|next time|another time|some other time)\b/;

const ASKED_TO_END = new RegExp(
  String.raw`^(?:(?:okay|ok|well|alright|actually|yes|no|thanks|thank you)[,.! ]+)*` +
    String.raw`(?:(?:i (?:want|need|have|would like)|i'd like|i'm ready|i am ready) to |(?:can|could|shall|may) we |let's |let us |please )?${ENDING}\b`,
);
const HAVE_TO_GO = /\b(?:i (?:need|have|want|have got)|i've got|i must) to go(?: now)?[.!]*$/;
const MUST_GO = /\bi (?:must|should|better|had better) go(?: now)?[.!]*$/;
const THATS_ALL = /\b(?:that's|that is) all for (?:now|today)(?:[,!. ]+(?:goodbye|good bye|bye)(?:[, ]+hachi)?)?[.!]*$/;
const SAYS_GOODBYE = /(?:^|[.!;,]\s*)(?:(?:okay|ok|well|alright|thanks|thank you)[,.! ]+)*(?:goodbye|good bye|bye(?: bye)?)(?:[, ]+(?:hachi|for now))?[.!]*$/;

/** A plain yes, which only counts as agreeing to end right after a question that asked exactly that. */
const AFFIRM = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'alright', 'fine', 'good', 'please']);
const FILLER = new Set(['that', "that's", 'sounds', 'would', 'be', 'is', 'do', 'thank', 'thanks', 'you', 'all', 'right', 'of', 'course', 'hachi']);

function isBareYes(text: string): boolean {
  const words = text.replace(/[^a-z' ]/g, ' ').split(' ').filter(Boolean);
  return words.some((w) => AFFIRM.has(w)) && words.every((w) => AFFIRM.has(w) || FILLER.has(w));
}

/** Hachi's last turn was a single yes/no question asking whether to end the call, and nothing else. */
function askedWhetherToEnd(agentText: string): boolean {
  const reply = normalized(agentText);
  return (
    reply.endsWith('?') &&
    reply.split('?').length === 2 &&
    new RegExp(String.raw`\b${ENDING}\b`).test(reply) &&
    !/\b(?:or|not|don't|do not)\b/.test(reply)
  );
}

/**
 * (a) Does the resident want this call to end? `residentText` is their latest turn;
 * `previousAgentText` is what Hachi said just before it, which is what a bare "yes" is answering.
 */
export function residentWantsToEnd(residentText: string, previousAgentText = ''): boolean {
  const text = normalized(residentText);
  if (!text || CONTINUE.test(text) || NEGATED.test(text) || NOT_NOW.test(text) || QUESTION.test(text)) return false;
  if (ASKED_TO_END.test(text)) return !LATER.test(text);
  if (HAVE_TO_GO.test(text) || MUST_GO.test(text) || THATS_ALL.test(text) || SAYS_GOODBYE.test(text)) return true;
  return isBareYes(text) && askedWhetherToEnd(previousAgentText);
}

/** (b) Is this Hachi turn a goodbye, rather than a question or a goodbye taken back? */
export function isSpokenFarewell(agentText: string): boolean {
  const text = normalized(agentText);
  return (
    /\b(?:goodbye|good bye|bye)\b/.test(text) &&
    !text.includes('?') &&
    !/\b(?:would you|do you|shall we|can we|anything else|spoke too soon|not|don't|do not|wait|keep talking|keep chatting)\b/.test(text)
  );
}

/** Words that answer a goodbye without reopening the call: "Bye!", "Thank you, you too". */
const CLOSING_WORDS = new Set([
  'bye', 'goodbye', 'good', 'night', 'day', 'thank', 'thanks', 'you', 'too', 'same', 'to', 'ok', 'okay', 'alright', 'all', 'right',
  'yes', 'yeah', 'take', 'care', 'see', 'tomorrow', 'then', 'hachi', 'cheers', 'and', 'oh', 'well', 'so', 'much', 'very', 'a', 'lovely',
  'have', 'nice', 'speak', 'talk', 'soon', 'for', 'now', 'dear', 'love',
]);

/**
 * Said while Hachi's goodbye was playing. Answering it in kind keeps the ending; anything else —
 * "oh, wait", "actually, one thing" — means they are still talking, and the call stays open.
 * Nothing heard yet counts as closing, so a cough-length transcript does not reopen a call.
 */
export function isClosingReply(residentText: string): boolean {
  const words = normalized(residentText).replace(/[^a-z' ]/g, ' ').split(' ').filter(Boolean);
  return words.every((w) => CLOSING_WORDS.has(w));
}
