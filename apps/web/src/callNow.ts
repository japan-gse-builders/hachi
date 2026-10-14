import { minutes } from './format';

/** One call's progress as the API reports it (issue #13). */
export interface CallProgress {
  id: string;
  status: 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'no_answer' | 'failed';
  trigger: 'staff' | null;
  requestedBy: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  endedBy: string | null;
  failureCode: string | null;
}

/** While a call is in one of these, the button keeps following it. */
export function isUnderWay(status: CallProgress['status']): boolean {
  return status === 'requested' || status === 'scheduled' || status === 'in_progress';
}

const NOT_PLACED: Record<string, string> = {
  budget_exhausted: "This month's AI budget is used up, so the call was not made.",
  gateway_unavailable: "Hachi's conversations are not working at the moment, so the call was not made.",
  line_busy: 'Another call to them was already under way, so this one was not made.',
  paused: 'Calls were paused for them before Hachi could call, so the call was not made.',
  consent_required: 'They have not agreed to calls from Hachi, so the call was not made.',
  organization_unverified: 'Hachi has not verified your organization yet, so the call was not made.',
  synthetic: 'This is a demo patient, so Hachi does not call them.',
  not_placed: 'The call did not start within a few minutes. You can ask again.',
};

/** What the button says about the call, in a sentence staff can act on. */
export function callProgressLine(p: CallProgress, name: string): string {
  switch (p.status) {
    case 'requested':
      return `Hachi will call ${name} in a moment.`;
    case 'scheduled':
      return `Ringing ${name}…`;
    case 'in_progress':
      return `Hachi is on the call with ${name}.`;
    case 'no_answer':
      return `${name} did not answer.`;
    case 'failed':
      return (p.failureCode && NOT_PLACED[p.failureCode]) || 'The call could not be made.';
    case 'completed':
      if (p.endedBy === 'emergency') return `${name} was put through to family and staff as an emergency.`;
      if (p.endedBy === 'gateway_error') return 'The call dropped because of a technical problem on our side.';
      if (p.endedBy === 'silent_after_greeting' || p.endedBy === 'stopped_responding') return `The call connected, but ${name} did not speak with Hachi.`;
      return `Call ended${p.durationSec !== null ? ` after ${minutes(p.durationSec)}` : ''}. Its notes appear once it has been analyzed.`;
  }
}
