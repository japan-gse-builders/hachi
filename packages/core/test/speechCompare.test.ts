import { describe, expect, it } from 'vitest';
import {
  answerClips,
  CLIP_MAX_MS,
  compareSpeech,
  latestSpeechChange,
  MAX_COMPARED_QUESTIONS,
  questionText,
  type ComparableCall,
  type Detection,
  type PcmAudio,
  type Segment,
  type Turn,
} from '../src/index.js';

const RATE = 8000;

/** A quiet line with "speech" (a 300 Hz tone) during the given segments. */
function channel(durationMs: number, speech: Segment[]): Int16Array {
  const out = new Int16Array((durationMs * RATE) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? 20 : -20;
  for (const s of speech) {
    for (let i = (s.startMs * RATE) / 1000; i < (s.endMs * RATE) / 1000 && i < out.length; i++) {
      out[i] = Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / RATE));
    }
  }
  return out;
}

/** Channel 0 is the resident, channel 1 is Hachi, as in the recordings. */
function audio(resident: Segment[], agent: Segment[], durationMs = 40_000): PcmAudio {
  return { sampleRate: RATE, channels: [channel(durationMs, resident), channel(durationMs, agent)] };
}

const turn = (speaker: Turn['speaker'], startMs: number, endMs: number, text = 'Often I suppose.'): Turn => ({ speaker, text, startMs, endMs });

describe('answerClips (F02)', () => {
  // Hachi asks the question from 0 to 2 s. The resident answers from 2.5 s, but the transcript
  // places the answer 3 s later, as it does in practice.
  const question: Segment[] = [{ startMs: 0, endMs: 2000 }];
  const transcript: Turn[] = [turn('agent', 0, 2000, 'How often do you feel left out?'), turn('resident', 5500, 8000)];
  const answer = [{ itemId: 'uls3.left_out', option: 2, turn: 1 }];

  it('finds the answer in the recording despite the transcript lag, with a moment of the question before it', () => {
    const clips = answerClips(audio([{ startMs: 2500, endMs: 4000 }], question), transcript, answer);
    expect(clips).toEqual([{ itemId: 'uls3.left_out', answer: 'Often', startMs: 1500, endMs: 4000, quote: 'Often I suppose.' }]);
  });

  it('keeps a short pause inside one answer, and stops where Hachi speaks again', () => {
    const resident = [
      { startMs: 2500, endMs: 3000 },
      { startMs: 4000, endMs: 5000 },
    ];
    const agentAgain = [...question, { startMs: 6000, endMs: 7000 }];
    expect(answerClips(audio(resident, agentAgain), transcript, answer)[0]).toMatchObject({ endMs: 5000 });
    expect(answerClips(audio(resident, [...question, { startMs: 4800, endMs: 5200 }]), transcript, answer)[0]).toMatchObject({ endMs: 4800 });
  });

  it('caps a long answer at the clip length', () => {
    const clip = answerClips(audio([{ startMs: 2500, endMs: 30_000 }], question), transcript, answer)[0]!;
    expect(clip.endMs - 2500).toBe(CLIP_MAX_MS);
  });

  it('gives no clip when the answer cannot be found near the transcript time, rather than a guessed one', () => {
    const far: Turn[] = [turn('agent', 0, 2000), turn('resident', 30_000, 32_000)];
    expect(answerClips(audio([{ startMs: 2500, endMs: 4000 }], question), far, answer)).toEqual([]);
  });

  it('only clips answers the resident gave, never Hachi\'s own turns', () => {
    const agentTurn: Turn[] = [turn('agent', 0, 2000), turn('agent', 5500, 8000, 'Often')];
    expect(answerClips(audio([{ startMs: 2500, endMs: 4000 }], question), agentTurn, [{ itemId: 'uls3.left_out', option: 2, turn: 1 }])).toEqual([]);
  });

  it('clips each question separately and keeps the transcript quote short', () => {
    const agent: Segment[] = [
      { startMs: 0, endMs: 2000 },
      { startMs: 6000, endMs: 8000 },
    ];
    const resident = [
      { startMs: 2500, endMs: 4000 },
      { startMs: 8500, endMs: 10_000 },
    ];
    const long = 'x'.repeat(300);
    const two: Turn[] = [turn('agent', 0, 2000), turn('resident', 5500, 8000, long), turn('agent', 9000, 10_000), turn('resident', 11_500, 13_000, 'Yes')];
    const clips = answerClips(audio(resident, agent), two, [
      { itemId: 'uls3.left_out', option: 2, turn: 1 },
      { itemId: 'kcl.shopping', option: 0, turn: 3 },
    ]);
    expect(clips.map((c) => c.itemId)).toEqual(['uls3.left_out', 'kcl.shopping']);
    expect(clips[0]!.quote).toHaveLength(200);
    expect(clips[1]!.answer).toBe('Yes');
  });

  it('gives nothing without both channels or without answers', () => {
    const mono: PcmAudio = { sampleRate: RATE, channels: [channel(5000, [])] };
    expect(answerClips(mono, transcript, answer)).toEqual([]);
    expect(answerClips(audio([], question), transcript, [])).toEqual([]);
  });
});

describe('compareSpeech (F02)', () => {
  const change = { callId: 'now', contributors: [{ feature: 'responseLatencyMs' as const, adverseZ: 3, baselineMean: 900, recentMean: 6000 }] };
  const clip = (itemId: string, answer = 'Often') => ({ itemId, answer, quote: `${itemId} said`, startMs: 1000, endMs: 4000 });
  const at = (day: number) => new Date(Date.parse('2026-09-01T02:00:00.000Z') + day * 86_400_000).toISOString();
  const baseline = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' };
  const usual = (id: string, day: number, clips: ReturnType<typeof clip>[], hasRecording = true): ComparableCall => ({ callId: id, at: at(day), hasRecording, clips });
  const flagged = (clips: ReturnType<typeof clip>[], hasRecording = true): ComparableCall => ({ callId: 'now', at: at(40), hasRecording, clips });

  it('pairs each answer from this call with the most recent usual answer to the same question', () => {
    const cmp = compareSpeech(change, [
      usual('u1', 2, [clip('uls3.left_out')]),
      usual('u2', 10, [clip('uls3.left_out', 'Hardly ever or never'), clip('kcl.shopping')]),
      flagged([clip('uls3.left_out', 'Often'), clip('kcl.shopping', 'No'), clip('kcl.banking', 'Yes')]),
    ], baseline);
    expect(cmp).toMatchObject({ callId: 'now', gap: null, usualCalls: 2, usualRecordings: 2, recentRecording: true, changes: change.contributors });
    expect(cmp!.questions.map((q) => q.itemId)).toEqual(['uls3.left_out', 'kcl.shopping']);
    expect(cmp!.questions[0]!.usual).toMatchObject({ callId: 'u2', answer: 'Hardly ever or never' });
    expect(cmp!.questions[0]!.recent).toMatchObject({ callId: 'now', answer: 'Often' });
  });

  it('only uses calls inside the usual range, and never the flagged call itself as usual', () => {
    const cmp = compareSpeech(change, [
      usual('after', 35, [clip('uls3.left_out')]),
      usual('before', -1, [clip('uls3.left_out')]),
      flagged([clip('uls3.left_out')]),
    ], baseline);
    expect(cmp).toMatchObject({ gap: 'no_usual_answers', usualCalls: 0, questions: [] });
  });

  it('shows at most a few questions side by side', () => {
    const ids = ['uls3.left_out', 'uls3.isolated', 'kcl.shopping', 'kcl.banking'];
    const cmp = compareSpeech(change, [usual('u', 3, ids.map((id) => clip(id))), flagged(ids.map((id) => clip(id)))], baseline);
    expect(cmp!.questions).toHaveLength(MAX_COMPARED_QUESTIONS);
  });

  it('says why nothing can be compared when the recordings do not hold it', () => {
    expect(compareSpeech(change, [usual('u', 3, [clip('uls3.left_out')]), flagged([])], baseline)).toMatchObject({ gap: 'no_recent_answers', recentRecording: true });
    expect(compareSpeech(change, [usual('u', 3, [], false), usual('v', 4, []), flagged([clip('uls3.left_out')])], baseline)).toMatchObject({
      gap: 'no_usual_answers',
      usualCalls: 2,
      usualRecordings: 1,
    });
    expect(compareSpeech(change, [usual('u', 3, [clip('kcl.shopping')]), flagged([clip('uls3.left_out')])], baseline)).toMatchObject({
      gap: 'no_shared_question',
    });
    expect(compareSpeech(change, [usual('u', 3, [clip('uls3.left_out')]), flagged([], false)], baseline)).toMatchObject({
      gap: 'no_recent_answers',
      recentRecording: false,
    });
  });

  it('has nothing to compare with when the resident has no usual range yet, and nothing when the flagged call is missing', () => {
    expect(compareSpeech(change, [flagged([clip('uls3.left_out')])], null)).toMatchObject({ gap: 'no_usual_answers' });
    expect(compareSpeech(change, [usual('u', 3, [clip('uls3.left_out')])], baseline)).toBeNull();
  });

  it('words a question as the resident heard it', () => {
    expect(questionText('uls3.left_out')).toBe('How often do you feel left out?');
    expect(questionText('phq2.down')).toBe('Over the last two weeks, how often have you been bothered by feeling down, depressed, or hopeless?');
  });

  it('takes the change from the most recent R3 detection that recorded one', () => {
    const d = (detectedAt: string, callId?: string): Detection => ({
      residentId: 'r',
      rule: 'R3',
      urgency: 'watch',
      confidence: 0.6,
      summary: 's',
      evidence: [],
      detectedAt,
      ...(callId ? { speechChange: { callId, contributors: [] } } : {}),
    });
    expect(latestSpeechChange([d('2026-10-01T00:00:00Z', 'old'), d('2026-10-03T00:00:00Z', 'new'), d('2026-10-02T00:00:00Z')])).toEqual({
      callId: 'new',
      contributors: [],
    });
    expect(latestSpeechChange([d('2026-10-01T00:00:00Z')])).toBeNull();
  });

  it('falls back to the call named in the evidence for detections made before the change was recorded', () => {
    const old: Detection = {
      residentId: 'r',
      rule: 'R3',
      urgency: 'watch',
      confidence: 0.6,
      summary: 's',
      detectedAt: '2026-10-05T00:00:00Z',
      evidence: [{ callId: 'call-9', quote: 'q' }],
    };
    expect(latestSpeechChange([old])).toEqual({ callId: 'call-9', contributors: [] });
  });
});
