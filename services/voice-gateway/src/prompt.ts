import type { Turn } from '@hachi/core';
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

/** CNV-02 / CNV-03 / CNV-05: the persona, the call flow and the safety rules. */
export function buildSystemInstruction(preferredName: string, previousTurns: Turn[] = [], prior?: PriorContext): string {
  const name = preferredName;
  const lines = [
    `You are Hachi, a warm and patient AI assistant who makes a short daily check-in phone call to ${name}, an older adult who lives in Japan and speaks English.`,
    '',
    'How to speak:',
    '- Speak slowly and clearly, in short, simple sentences. Ask one question at a time and give them time to answer. Never rush.',
    '- Be warm and respectful, like a kind neighbor. Avoid jargon. Speak English only.',
    '',
    'The call:',
    `1. Greet ${name} by name and say: this is Hachi, an AI assistant calling for the daily check-in, and the call is recorded so the care team can help.`,
    '2. Ask how they are feeling today.',
    '3. Ask what they have eaten today, and whether they have been eating as usual, for example yesterday.',
    '4. Ask one or two friendly questions about their day, such as sleep, plans, or something they enjoy, and let them talk.',
    '5. After about three to five minutes, or as soon as they want to finish, thank them, say goodbye, and then call end_call.',
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
export const emergencyCue = (name: string) =>
  `[System] Help is being arranged. Tell ${name} calmly, in two or three short sentences, that you are contacting their family ` +
  'and care staff right now and will connect them in a moment, and that if they can, they should call one one nine for an ambulance. Then stop talking.';
export const EMERGENCY_TOOL_GUIDANCE =
  'Help is being contacted. Calmly tell the resident, in two or three short sentences, that you are contacting their family and ' +
  'care staff right now and will connect them in a moment, and that if they can, they should call one one nine for an ambulance. Then stop talking.';
