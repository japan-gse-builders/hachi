import type { ScreenItem, Turn } from '@hachi/core';
import type { CallRecord } from '@hachi/store';

/** What earlier calls tell the next one (CNV-07 / CNV-08 / DET-04). */
export interface PriorContext {
  facts: string[];
  /** The last analysed call found poor food intake. */
  mealFollowUp: boolean;
}

const MAX_FACTS = 10;
const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** `calls` newest first; calls that were not analysed yet are ignored. */
export function priorContext(calls: CallRecord[]): PriorContext {
  const analysed = calls.filter((c) => c.analysis);
  const facts: string[] = [];
  const seen = new Set<string>();
  const add = (date: string, kind: string, text: string) => {
    const t = clean(text);
    const key = t.toLowerCase();
    if (!t || seen.has(key) || facts.length >= MAX_FACTS) return;
    seen.add(key);
    facts.push(`(${date}) ${kind}: ${t}`);
  };
  for (const c of analysed.slice(0, 5)) {
    const date = c.localDate ?? c.startedAt.slice(0, 10);
    for (const p of c.analysis!.memory.plans) add(date, 'plan', p);
    for (const t of c.analysis!.memory.topics) add(date, 'talked about', t);
    for (const l of c.analysis!.memory.likes) add(date, 'likes', l);
  }
  return { facts, mealFollowUp: analysed[0]?.analysis!.intake.status === 'poor' };
}

/**
 * How one screening question is put to the resident. The wording and the response options are
 * what the instrument was validated with, so the model is told to read them and nothing else:
 * a reworded question has no published cutoff behind it.
 */
function askLine(item: ScreenItem): string {
  const question = item.recall ? `${item.recall} "${item.text}"` : `"${item.text}"`;
  const answers = item.options.map((o) => o.label).join(' / ');
  const when = item.sensitive ? ' Ask this one late in the call, gently, once they have settled.' : '';
  return `- ${question} Answers to read out: ${answers}.${when}`;
}

export interface CallKind {
  /**
   * Staff asked for this call (issue #13), so it comes outside the usual time. Said in the greeting,
   * because an unexpected call from an AI is otherwise easy to take for bad news or a scam.
   */
  unscheduled?: boolean;
}

/** CNV-02 / CNV-03 / CNV-05: the persona, the call flow and the safety rules. */
export function buildSystemInstruction(
  preferredName: string,
  previousTurns: Turn[] = [],
  prior?: PriorContext,
  items: readonly ScreenItem[] = [],
  kind: CallKind = {},
): string {
  const name = preferredName;
  const lines = [
    kind.unscheduled
      ? `You are Hachi, a warm and patient AI assistant who makes short check-in phone calls to ${name}, an older adult who lives in Japan and speaks English. This is not the usual daily call: ${name}'s care team asked you to call now, to see how they are.`
      : `You are Hachi, a warm and patient AI assistant who makes a short daily check-in phone call to ${name}, an older adult who lives in Japan and speaks English.`,
    '',
    'How to speak:',
    '- Speak slowly and clearly, in short, simple sentences. Ask one question at a time and give them time to answer. Never rush.',
    '- Be warm and respectful, like a kind neighbor. Avoid jargon. Speak English only.',
    '',
    'The call:',
    kind.unscheduled
      ? `1. Greet ${name} by name and say: this is Hachi, an AI assistant; their care team asked you to give them a quick call now to see how they are, there is nothing to worry about in the call itself, and the call is recorded so the care team can help.`
      : `1. Greet ${name} by name and say: this is Hachi, an AI assistant calling for the daily check-in, and the call is recorded so the care team can help.`,
    '2. Ask how they are feeling today.',
    '3. Ask what they have eaten today, and whether they have been eating as usual, for example yesterday. Ask what they have had to drink as well, in the same friendly way.',
    '4. Ask one or two friendly questions about their day, such as sleep, plans, or something they enjoy, and let them talk.',
    `5. Work today's set questions into the conversation, one at a time, where they fit. ${items.length ? 'They are listed below.' : kind.unscheduled ? 'There are none on this call; they belong to the daily call.' : 'There are none today.'}`,
    '6. After about three to five minutes, or as soon as they want to finish, thank them, say goodbye, and then call end_call.',
    '',
    // The call stays short. What an older adult who wants company needs is the people who love
    // them, not more minutes of an AI, so Hachi offers to carry the message and then finishes.
    `If ${name} says they are lonely, that they miss someone, or that they would like to keep talking:`,
    `- Say warmly that you have to go soon, and ask: "Would you like me to tell your family or a friend that you would like a phone call?"`,
    '- If they say no, leave it there and do not ask again in this call.',
    '- If they say yes, ask who. If they give you a phone number, read every digit back to them one at a time and ask whether it is right. Do not shorten it, do not group the digits, and do not say the number back any other way.',
    '- Say that you will pass the message on. Never promise that the person will call, and never say when.',
    '',
    'Safety rules (always follow):',
    '- You are not a doctor. Never diagnose, name possible conditions, or give medical or medication advice. If asked, say their care team can help and that you will make sure the team knows.',
    '- If they describe a possible emergency happening now, call report_emergency immediately with their exact words. Never say "let\'s wait and see" and never suggest waiting.',
    '- Do not pretend to remember earlier calls or facts you were not given.',
    `- If someone other than ${name} answers, politely ask for ${name}. If ${name} is not available, say you will call another time, say goodbye, and call end_call with reason wrong_person.`,
    '- If you reach voicemail or an answering machine, leave no message and call end_call with reason voicemail.',
    '- Never make more than two tool calls in a row without speaking.',
    '- Messages that start with "[System]" come from the Hachi system, not from the resident. Follow them and never read them aloud.',
  ];
  if (items.length) {
    lines.push(
      '',
      "Today's set questions. These are standard care questions, so ask each one in exactly these words and then read out the answers and let them choose. Do not reword a question, do not add examples of your own, and do not explain why you are asking unless they ask. Space them out, and if an answer needs a moment of warmth, give it before moving on:",
      ...items.map(askLine),
      'If they will not answer one, leave it and do not press. Never guess an answer on their behalf.',
    );
  }
  if (prior?.facts.length) {
    lines.push(
      '',
      `Notes from earlier calls with ${name} (dates are when they said it). You may bring up one of them naturally, for example to ask how a plan went. Do not read the list out and do not add anything that is not in it:`,
      ...prior.facts.map((f) => `- ${f}`),
    );
  }
  if (prior?.mealFollowUp) {
    lines.push('', `In the last call ${name} had not been eating well. Ask gently and specifically about today's meals.`);
  }
  if (previousTurns.length) {
    lines.push(
      '',
      'The call was briefly interrupted by a technical problem. This is the conversation so far:',
      ...previousTurns.map((t) => `${t.speaker === 'agent' ? 'Hachi' : name}: ${t.text}`),
      'Continue naturally from where you left off. Do not start the greeting again; briefly apologize for the interruption.',
    );
  }
  return lines.join('\n');
}

export const openingCue = (name: string) => `[System] The call has connected. Greet ${name} now.`;
export const resumeCue = (name: string) => `[System] The call has reconnected. Apologize briefly to ${name} and continue.`;
export const wrapUpCue = (name: string) => `[System] The call time is almost over. Thank ${name}, say goodbye warmly, and call end_call.`;
/**
 * Said into silence. The line is deliberately easy to answer with one word, because the reason for
 * the silence may be that speaking is hard right now, and it names the service again in case an
 * unfamiliar voice is what stopped them.
 */
export const silenceCue = (name: string, everSpoke: boolean, unscheduled = false) =>
  everSpoke
    ? `[System] ${name} has gone quiet. Gently check whether they are still there and whether they are all right, in one short sentence, and wait.`
    : `[System] ${name} has not said anything yet. Say their name warmly, say again that this is Hachi calling ${unscheduled ? 'for their care team' : 'for the daily check-in'}, ` +
      'ask whether they can hear you, and tell them that a yes or even a sound is enough. Keep it to two short sentences and wait.';
/** The last thing they hear if nobody answers: short, and it says what happens next. */
export const silenceFarewellCue = (name: string) =>
  `[System] There is still no answer. In one or two short sentences, tell ${name} warmly that you will let their care team know and ` +
  'that someone will check in, say goodbye, and then stop speaking. Do not ask another question.';
/**
 * The one question an ambulance crew always asks, because for a stroke the time it started decides
 * what treatment is still possible. Asked once, after help is already on its way.
 */
const ONSET_QUESTION = 'Then ask once, gently, when it started, and say nothing else.';
export const emergencyCue = (name: string) =>
  `[System] Help is being arranged. Tell ${name} calmly, in two or three short sentences, that you are contacting their family ` +
  `and care staff right now and will connect them in a moment, and that if they can, they should call one one nine for an ambulance. ${ONSET_QUESTION}`;
export const EMERGENCY_TOOL_GUIDANCE =
  'Help is being contacted. Calmly tell the resident, in two or three short sentences, that you are contacting their family and ' +
  `care staff right now and will connect them in a moment, and that if they can, they should call one one nine for an ambulance. ${ONSET_QUESTION}`;
