import {
  assessR2,
  assessSpeechChange,
  buildBaseline,
  describeFeatureChange,
  describeTrend,
  detectR1,
  extractSpeechSample,
  localDate,
  normalizeUtterance,
  type CallSpeechSample,
  type Detection,
  type Evidence,
  type IntakeObservation,
  type SpeechExample,
  type TimingSource,
  type Turn,
} from '@hachi/core';
import type { CallAnalysis, CallMemory, CallRecord, Resident } from '@hachi/store';
import type { ModelReview } from './model.js';
import { wellbeingFrom } from './wellbeing.js';

export interface AnalysisInput {
  resident: Resident;
  call: CallRecord;
  transcript: Turn[];
  /** The resident's other calls. */
  history: CallRecord[];
  /** Null when the model could not be used; the rule-based checks still run. */
  review: ModelReview | null;
  /** Response time and self-repairs from the recording (SPK-01); defaults to the transcript. */
  timing?: TimingSource;
  /** 0..1 line quality heard in the recording (SPK-04). */
  audioQuality?: number;
  model?: string;
  modelError?: string;
  voiceError?: string;
  now: Date;
}

export interface AnalysisResult {
  detections: Detection[];
  update: Pick<CallRecord, 'summary' | 'familySummary' | 'wellbeing' | 'speech'> & { analysis: CallAnalysis };
}

const R2_HISTORY_DAYS = 7;
const MEAL_WORDS = /\b(eat|eaten|ate|eating|food|meal|meals|breakfast|lunch|dinner|hungry|appetite|rice|bread|biscuits?|snacks?|soup|cook|cooked)\b/i;
const EMPTY_MEMORY: CallMemory = { topics: [], plans: [], likes: [] };

const loose = (s: string) => normalizeUtterance(s).replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();

function evidence(callId: string, t: Turn, quote = t.text): Evidence {
  return { callId, quote: quote.trim().slice(0, 400), startMs: t.startMs, endMs: t.endMs };
}

/**
 * The model must point at a resident turn; a quote that is not in that turn is replaced by the
 * turn itself, so evidence is always the resident's real words (DET-06).
 */
export function groundEmergencies(review: ModelReview, transcript: Turn[], callId: string) {
  const out: { evidence: Evidence; symptom: string; confidence: number }[] = [];
  for (const e of review.emergencies) {
    let t: Turn | undefined = transcript[e.turn];
    if (t?.speaker !== 'resident') {
      const q = loose(e.quote);
      t = q ? transcript.find((x) => x.speaker === 'resident' && loose(x.text).includes(q)) : undefined;
    }
    if (!t) continue;
    const quote = loose(e.quote) && loose(t.text).includes(loose(e.quote)) ? e.quote : t.text;
    out.push({ evidence: evidence(callId, t, quote), symptom: e.symptom, confidence: e.confidence });
  }
  return out;
}

function r1Detection(input: AnalysisInput): Detection | null {
  const { call, transcript, review, resident, now } = input;
  // Raised during the call; family and staff were already called.
  if (call.emergency) return null;
  const found: { evidence: Evidence; confidence: number; symptom?: string }[] = [];
  for (const t of transcript) {
    if (t.speaker !== 'resident') continue;
    const signals = detectR1(t.text);
    if (signals.length) found.push({ evidence: evidence(call.id, t), confidence: Math.max(...signals.map((s) => s.confidence)) });
  }
  if (review) found.push(...groundEmergencies(review, transcript, call.id));
  if (!found.length) return null;

  const merged = new Map<string, (typeof found)[number]>();
  for (const f of found) {
    const key = `${f.evidence.startMs}:${loose(f.evidence.quote)}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, confidence: Math.max(prev.confidence, f.confidence), symptom: prev.symptom ?? f.symptom } : f);
  }
  const unique = [...merged.values()];
  const symptom = unique.find((f) => f.symptom)?.symptom?.slice(0, 80);
  return {
    residentId: resident.id,
    rule: 'R1',
    urgency: 'emergency',
    confidence: Math.max(...unique.map((f) => f.confidence)),
    summary: symptom ? `Possible emergency found when reviewing the call (${symptom})` : 'Possible emergency found when reviewing the call',
    evidence: unique.slice(0, 5).map((f) => f.evidence),
    detectedAt: now.toISOString(),
  };
}

function intakeFor(input: AnalysisInput): IntakeObservation {
  const date = input.call.localDate ?? localDate(new Date(input.call.startedAt), input.resident.timeZone);
  const i = input.review?.intake;
  if (!i) return { date, status: 'unknown' };
  return { date, status: i.status, ...(i.reportedPoorDays > 0 ? { reportedPoorDays: i.reportedPoorDays } : {}) };
}

function mealEvidence(input: AnalysisInput): Evidence[] {
  const { transcript, call, review } = input;
  const cited = (review?.intake.evidenceTurns ?? []).map((i) => transcript[i]).filter((t): t is Turn => t?.speaker === 'resident');
  const aboutFood = (t: Turn, i: number) =>
    t.speaker === 'resident' && (MEAL_WORDS.test(t.text) || (transcript[i - 1]?.speaker === 'agent' && MEAL_WORDS.test(transcript[i - 1]!.text)));
  const turns = cited.length ? cited : transcript.filter(aboutFood);
  return turns.slice(0, 3).map((t) => evidence(call.id, t));
}

/** DET-04: counts poor-intake days together with the earlier calls. */
function r2Detection(input: AnalysisInput, intake: IntakeObservation): Detection | null {
  if (intake.status !== 'poor') return null;
  const since = Date.parse(input.call.startedAt) - R2_HISTORY_DAYS * 86_400_000;
  const observations = input.history
    .filter((c) => c.analysis?.intake && Date.parse(c.startedAt) >= since && c.startedAt <= input.call.startedAt)
    .map((c) => c.analysis!.intake);
  const a = assessR2([...observations, intake]);
  if (!a.urgency) return null;
  return {
    residentId: input.resident.id,
    rule: 'R2',
    urgency: a.urgency,
    confidence: 0.8,
    poorIntakeDays: a.poorIntakeDays,
    summary: a.poorIntakeDays >= 2 ? `Has not been eating enough for ${a.poorIntakeDays} days` : 'Has not been eating enough',
    evidence: mealEvidence(input),
    detectedAt: input.now.toISOString(),
  };
}

/** SPK-02 / SPK-03: only this call's assessment against the resident's own baseline. */
function r3Detection(input: AnalysisInput, sample: CallSpeechSample): Detection | null {
  if (!sample.usable) return null;
  const samples = [sample, ...input.history.map((c) => c.speech).filter((s): s is CallSpeechSample => !!s && s.callId !== sample.callId)];
  const baseline = buildBaseline(samples, input.resident.serviceStartedAt);
  const a = assessSpeechChange(samples, baseline);
  if (a.status !== 'assessed' || !a.urgency || !a.recentCallIds.includes(sample.callId)) return null;
  const changed = new Set(a.contributors.map((c) => c.feature));
  const fromRecording = (sample.examples ?? []).filter((e: SpeechExample) =>
    e.kind === 'slow_response' ? changed.has('responseLatencyMs') : changed.has('repairRate'),
  );
  const longest = input.transcript
    .filter((t) => t.speaker === 'resident')
    .sort((x, y) => y.text.length - x.text.length)
    .slice(0, 2)
    .map((t) => evidence(input.call.id, t));
  const examples = [
    ...fromRecording.slice(0, 3).map((e) => ({ callId: input.call.id, quote: e.quote, ...(e.startMs !== undefined ? { startMs: e.startMs } : {}) })),
    ...(fromRecording.length ? [] : longest),
  ];
  const changes = a.contributors.map((c) => describeFeatureChange(c, 'en')).join('; ') || 'Speech differs from usual';
  const trend = describeTrend(a.trend, 'en');
  return {
    residentId: input.resident.id,
    rule: 'R3',
    urgency: a.urgency,
    confidence: Math.min(0.9, 0.5 + a.magnitude / 8),
    changeMagnitude: a.magnitude,
    trend: a.trend,
    summary: trend ? `${changes}; ${trend}` : changes,
    evidence: examples,
    detectedAt: input.now.toISOString(),
  };
}

export function analyse(input: AnalysisInput): AnalysisResult {
  const { review, call, transcript } = input;
  const intake = intakeFor(input);
  const speech = extractSpeechSample(
    call.id,
    call.startedAt,
    transcript,
    review?.topicCoherence ?? null,
    {
      ...(review ? { noisy: review.noisy, temporaryCondition: review.temporaryCondition } : {}),
      ...(input.audioQuality !== undefined ? { audioQuality: input.audioQuality } : {}),
    },
    input.timing ?? 'transcript',
  );
  // Imported history only builds the baseline and memory; it must not raise alerts about the past.
  const detections =
    call.source === 'imported'
      ? []
      : [r1Detection(input), r2Detection(input, intake), r3Detection(input, speech)].filter((d): d is Detection => d !== null);

  return {
    detections,
    update: {
      ...(review ? { summary: review.staffSummary, familySummary: review.familySummary, wellbeing: wellbeingFrom(review, transcript) } : {}),
      speech,
      analysis: {
        at: input.now.toISOString(),
        ...(input.model && review ? { model: input.model } : {}),
        turns: transcript.length,
        intake,
        memory: review?.memory ?? EMPTY_MEMORY,
        ...(input.modelError ? { error: input.modelError } : {}),
        ...(input.voiceError ? { voiceError: input.voiceError } : {}),
      },
    },
  };
}
