import type { Urgency } from './urgency.js';
import type { Detection } from './types.js';

/** Issue #15's explicit escalation policy; silence is an observation, not a diagnosis. */
export function exhaustedPromptDetection(residentId: string, kind: NoResponseKind, at: string): Detection {
  return {
    residentId, rule: 'R1', urgency: 'emergency', confidence: 1, noResponse: kind,
    summary: 'No response after all check-in prompts. Contact the resident now; the cause is unknown.',
    evidence: [], detectedAt: at,
  };
}

/**
 * R4 reads the silence on a call. R1, R2 and R3 all need the resident to say something; this is the
 * one signal that survives them saying nothing at all, which is also the state the other three can
 * never reach.
 */
export type NoResponseKind =
  /** They picked up the phone and never spoke, through the greeting and the prompts that followed. */
  | 'silent_after_greeting'
  /** They answered, talked, and then stopped replying for the rest of the call. */
  | 'stopped_responding';

export interface NoResponseAssessment {
  /** Null when the silence is not worth a case on its own. */
  urgency: Urgency | null;
  /** One sentence for staff, saying what was observed rather than what it means. */
  summary: string;
}

/**
 * Picking up and not speaking is not proof of an emergency: a hearing aid is out, the handset is in
 * a pocket, or an unfamiliar AI voice is confusing. So it is not raised as one. But it is also the
 * shape of a person who reached the phone and could not talk, and nobody else is going to notice
 * that today, so it is checked today.
 *
 * Going quiet partway through is a weaker signal, because a call that trails off is also what a
 * person does when they have had enough and put the handset down. A single one of those would fill
 * the queue with nothing; the same thing happening again across recent calls is worth a look.
 *
 * @param recentSameEndings how many of the resident's recent calls ended this way, this one included
 */
export function assessNoResponse(kind: NoResponseKind, recentSameEndings = 1): NoResponseAssessment {
  const repeats = Math.max(1, recentSameEndings);
  const run = repeats >= 2 ? ` This has happened on ${repeats} recent calls.` : '';
  if (kind === 'silent_after_greeting') {
    return { urgency: 'urgent', summary: `Answered the call but never spoke, through the greeting and two prompts.${run}` };
  }
  return {
    urgency: repeats >= 2 ? 'watch' : null,
    summary: `Answered and talked, then stopped replying for the rest of the call.${run}`,
  };
}
