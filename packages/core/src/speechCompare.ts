import type { Detection } from './types.js';
import type { FeatureChange, Turn } from './r3.js';
import { screenItem } from './screening.js';
import { responseGaps, speechSegments, type PcmAudio, type ResponseGap, type Segment } from './voice.js';

/**
 * F02: the resident's answer to one set question, located in the call recording so staff can hear
 * it. Only answers to the fixed screening questions get one, so the same question can be compared
 * across calls.
 */
export interface AnswerClip {
  itemId: string;
  /** The option the resident chose, worded as the question offers it. */
  answer: string;
  startMs: number;
  endMs: number;
  /** The resident's words for the answer, as transcribed. */
  quote: string;
}

/** An answer grounded in the transcript: `turn` is the resident turn it came from. */
export interface GroundedAnswer {
  itemId: string;
  option: number;
  turn: number;
}

/** Longest clip staff hear: enough for an answer, short enough to compare several side by side. */
export const CLIP_MAX_MS = 12_000;
/** A pause this short inside one answer does not end the clip. */
const CLIP_PAUSE_MS = 1_500;
/** A moment of the question before the answer, so the answer does not start out of nowhere. */
const LEAD_IN_MS = 1_000;
/**
 * Transcript times lag the recording by several seconds, so the answer is looked for in a window
 * around the time the transcript gives it: up to `ALIGN_EARLIER_MS` before it, and `ALIGN_LATER_MS` after.
 */
const ALIGN_EARLIER_MS = 12_000;
const ALIGN_LATER_MS = 3_000;

/**
 * Finds each grounded answer in the resident's channel of the recording. The answer is the first
 * resident speech after Hachi finishes a turn (the same pairing response time is measured from),
 * chosen as the nearest such point to where the transcript places it. An answer that cannot be
 * found in the recording gets no clip, rather than a guessed one.
 */
export function answerClips(audio: PcmAudio, transcript: Turn[], answers: readonly GroundedAnswer[]): AnswerClip[] {
  const [resident, agent] = audio.channels;
  if (!resident || !agent || answers.length === 0) return [];
  const residentSpeech = speechSegments(resident, audio.sampleRate);
  const agentSpeech = speechSegments(agent, audio.sampleRate);
  const starts = responseGaps(residentSpeech, agentSpeech);
  const clips: AnswerClip[] = [];
  for (const a of answers) {
    const turn = transcript[a.turn];
    if (turn?.speaker !== 'resident') continue;
    const gap = nearestStart(starts, turn.startMs);
    const answer = screenItem(a.itemId).options[a.option]?.label;
    if (!gap || answer === undefined) continue;
    clips.push({
      itemId: a.itemId,
      answer,
      startMs: Math.max(0, gap.residentStartMs - LEAD_IN_MS),
      endMs: Math.min(speechRunEnd(residentSpeech, agentSpeech, gap.residentStartMs), gap.residentStartMs + CLIP_MAX_MS),
      quote: turn.text.slice(0, 200),
    });
  }
  return clips;
}

function nearestStart(gaps: ResponseGap[], transcriptMs: number): ResponseGap | undefined {
  let best: ResponseGap | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const g of gaps) {
    const d = g.residentStartMs - transcriptMs;
    if (d < -ALIGN_EARLIER_MS || d > ALIGN_LATER_MS) continue;
    if (Math.abs(d) < bestDistance) {
      best = g;
      bestDistance = Math.abs(d);
    }
  }
  return best;
}

/** Where the resident's answer that starts at `fromMs` stops: at the next long pause, or when Hachi speaks again. */
function speechRunEnd(resident: Segment[], agent: Segment[], fromMs: number): number {
  const nextAgent = agent.find((s) => s.startMs > fromMs)?.startMs ?? Number.POSITIVE_INFINITY;
  let end = fromMs;
  for (const r of resident) {
    if (r.startMs < fromMs) continue;
    if (r.startMs >= nextAgent || r.startMs - end > CLIP_PAUSE_MS) break;
    end = Math.max(end, r.endMs);
  }
  return Math.min(end, nextAgent);
}

/** The call a clip belongs to, with what the comparison needs to know about it. */
export interface ComparableCall {
  callId: string;
  at: string;
  /** Whether the call has a recording to play. */
  hasRecording: boolean;
  clips: AnswerClip[];
}

/** The R3 change being explained: the call it was measured in, and the features that moved. */
export interface SpeechChange {
  callId: string;
  contributors: FeatureChange[];
}

export interface ComparedAnswer {
  callId: string;
  at: string;
  answer: string;
  quote: string;
  startMs: number;
  endMs: number;
}

/** One screening question, answered in a usual call and in the call that was flagged. */
export interface ComparedQuestion {
  itemId: string;
  /** The question as the resident heard it. */
  question: string;
  usual: ComparedAnswer;
  recent: ComparedAnswer;
}

/**
 * Why nothing could be compared, as far as the recordings go: a flagged call with no usable answer,
 * usual calls with no answer to the same question, or no question both kinds of call share.
 */
export type ComparisonGap = 'no_recent_answers' | 'no_usual_answers' | 'no_shared_question';

export interface SpeechComparison {
  callId: string;
  at: string;
  changes: FeatureChange[];
  /** Calls in the usual range (the baseline window). */
  usualCalls: number;
  /** Of those, how many have a recording at all. */
  usualRecordings: number;
  recentRecording: boolean;
  questions: ComparedQuestion[];
  gap: ComparisonGap | null;
}

/** Staff can compare this many questions side by side without the page getting long. */
export const MAX_COMPARED_QUESTIONS = 3;

/**
 * F02: lines up the flagged call's answers with the resident's usual answers to the same questions.
 * "Usual" means the most recent usual call that answered that question. Returns null when the flagged
 * call is not among `calls`, which the caller should treat as nothing to show.
 */
export function compareSpeech(change: SpeechChange, calls: ComparableCall[], baseline: { from: string; to: string } | null): SpeechComparison | null {
  const recent = calls.find((c) => c.callId === change.callId);
  if (!recent) return null;
  const usual = baseline
    ? calls
        .filter((c) => c.callId !== recent.callId && Date.parse(c.at) >= Date.parse(baseline.from) && Date.parse(c.at) < Date.parse(baseline.to))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];
  const base = {
    callId: recent.callId,
    at: recent.at,
    changes: change.contributors,
    usualCalls: usual.length,
    usualRecordings: usual.filter((c) => c.hasRecording).length,
    recentRecording: recent.hasRecording,
  };
  if (recent.clips.length === 0) return { ...base, questions: [], gap: 'no_recent_answers' };

  const questions: ComparedQuestion[] = [];
  for (const clip of recent.clips) {
    if (questions.length >= MAX_COMPARED_QUESTIONS) break;
    const found = usual.flatMap((c) => c.clips.filter((k) => k.itemId === clip.itemId).map((k) => ({ call: c, clip: k })))[0];
    if (!found) continue;
    questions.push({
      itemId: clip.itemId,
      question: questionText(clip.itemId),
      usual: compared(found.call, found.clip),
      recent: compared(recent, clip),
    });
  }
  if (questions.length) return { ...base, questions, gap: null };
  return { ...base, questions, gap: usual.some((c) => c.clips.length > 0) ? 'no_shared_question' : 'no_usual_answers' };
}

function compared(call: ComparableCall, clip: AnswerClip): ComparedAnswer {
  return { callId: call.callId, at: call.at, answer: clip.answer, quote: clip.quote, startMs: clip.startMs, endMs: clip.endMs };
}

/** The question in the words the resident heard, so staff can read it as they heard it. */
export function questionText(itemId: string): string {
  const item = screenItem(itemId);
  return item.recall ? `${item.recall} ${item.text}` : item.text;
}

/**
 * The change behind the case: the most recent R3 detection. Detections made before the change was
 * recorded name their call in their evidence, which is enough to find its answers, though not which
 * features moved.
 */
export function latestSpeechChange(detections: readonly Detection[]): SpeechChange | null {
  let latest: Detection | undefined;
  for (const d of detections) {
    if (!latest || d.detectedAt > latest.detectedAt) latest = d;
  }
  if (!latest) return null;
  if (latest.speechChange) return latest.speechChange;
  const callId = latest.evidence[0]?.callId;
  return callId ? { callId, contributors: [] } : null;
}
