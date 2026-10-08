import { describe, expect, it, vi } from 'vitest';
import { emergencyCue, EMERGENCY_TOOL_GUIDANCE, openingCue, resumeCue, silenceCue, silenceFarewellCue, wrapUpCue } from '../src/prompt.js';
import { callDoc, IDS, markMessage, mediaMessage, setup, startMessage, tick, wait } from './fixtures.js';

const loud24k = (n = 480) => new Int16Array(n).fill(6000);

async function started(opts: Parameters<typeof setup>[0] = {}) {
  const ctx = await setup(opts);
  await ctx.session.onMessage(startMessage());
  return { ...ctx, gemini: ctx.live.last };
}

async function endMark(ctx: Awaited<ReturnType<typeof started>>) {
  const marks = ctx.socket.ofType('mark').map((m) => m.mark.name as string);
  return marks[marks.length - 1]!;
}

describe('CallSession: stream start', () => {
  it('rejects a stream with the wrong token without contacting Gemini', async () => {
    const ctx = await setup();
    await ctx.session.onMessage(startMessage({ streamToken: 'guess' }));
    expect(ctx.socket.closed).toBe(true);
    expect(ctx.live.sessions).toHaveLength(0);
    expect(ctx.session.currentState).toBe('done');
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.streams).toBeUndefined();
  });

  it.each([
    ['an unknown call', { callId: 'nope' }, 'CA1'],
    ['an unknown resident', { residentId: 'nobody' }, 'CA1'],
    ['missing ids', { residentId: '', callId: '' }, 'CA1'],
    ['a token of a different length', { streamToken: 's' }, 'CA1'],
    ['a different Twilio call', {}, 'CA-other'],
  ])('rejects %s', async (_label, params, callSid) => {
    const ctx = await setup();
    await ctx.session.onMessage(startMessage(params, callSid));
    expect(ctx.socket.closed).toBe(true);
    expect(ctx.live.sessions).toHaveLength(0);
  });

  it('rejects a call without a stream token', async () => {
    const ctx = await setup({ call: { streamToken: undefined } });
    await ctx.session.onMessage(startMessage());
    expect(ctx.socket.closed).toBe(true);
  });

  it('connects Gemini with the persona and greets the resident', async () => {
    const ctx = await started();
    expect(ctx.session.currentState).toBe('active');
    expect(ctx.gemini.setup.systemInstruction).toContain('Maggie');
    expect(ctx.gemini.setup.systemInstruction).not.toMatch(/conversation so far/);
    expect(ctx.gemini.texts).toEqual([openingCue('Maggie')]);
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.streams).toBe(1);
  });

  it('records the Twilio call id when the status callback has not arrived yet', async () => {
    const ctx = await setup({ call: { providerCallId: undefined } });
    await ctx.session.onMessage(startMessage({}, 'CA9'));
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.providerCallId).toBe('CA9');
  });

  it('ignores a second start, junk, and unknown events', async () => {
    const ctx = await started();
    await ctx.session.onMessage(startMessage());
    await ctx.session.onMessage('not json');
    await ctx.session.onMessage(JSON.stringify({ event: 'dtmf' }));
    expect(ctx.live.sessions).toHaveLength(1);
    expect(ctx.socket.closed).toBe(false);
  });

  it('retries the Gemini connection', async () => {
    const ctx = await setup();
    ctx.live.failures = 2;
    await ctx.session.onMessage(startMessage());
    expect(ctx.live.sessions).toHaveLength(1);
    expect(ctx.session.currentState).toBe('active');
  });

  it('ends with gateway_error when Gemini cannot be reached', async () => {
    const ctx = await setup();
    ctx.live.failures = 3;
    await ctx.session.onMessage(startMessage());
    expect(ctx.socket.closed).toBe(true);
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy).toBe('gateway_error');
    expect(call.analysisPending).toBe(true);
  });
});

describe('CallSession: audio', () => {
  it('forwards resident audio to Gemini in 40 ms chunks', async () => {
    const ctx = await started();
    await ctx.session.onMessage(mediaMessage());
    expect(ctx.gemini.audio).toHaveLength(0);
    await ctx.session.onMessage(mediaMessage());
    expect(ctx.gemini.audio).toHaveLength(1);
    expect(ctx.gemini.audio[0]!.length).toBe(640);
  });

  it('ignores outbound-track and empty media', async () => {
    const ctx = await started();
    for (let i = 0; i < 4; i++) await ctx.session.onMessage(mediaMessage(0xff, 'outbound'));
    await ctx.session.onMessage(JSON.stringify({ event: 'media', media: {} }));
    expect(ctx.gemini.audio).toHaveLength(0);
  });

  it('buffers about three seconds of audio while Gemini connects', async () => {
    const ctx = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const connect = ctx.live.connect.bind(ctx.live);
    vi.spyOn(ctx.live, 'connect').mockImplementation(async (s, h) => {
      await gate;
      return connect(s, h);
    });
    const starting = ctx.session.onMessage(startMessage());
    await vi.waitFor(() => expect(ctx.live.connect).toHaveBeenCalled());
    for (let i = 0; i < 200; i++) await ctx.session.onMessage(mediaMessage());
    release();
    await starting;
    const flushed = ctx.live.last.audio;
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.length).toBeLessThanOrEqual(48_000);
    expect(flushed[0]!.length).toBeGreaterThan(47_000);
  });

  it('plays Gemini audio to the caller as μ-law', async () => {
    const ctx = await started();
    ctx.gemini.h.audio(loud24k());
    const [media] = ctx.socket.ofType('media');
    expect(media.streamSid).toBe('MZ1');
    expect(Buffer.from(media.media.payload, 'base64')).toHaveLength(160);
  });

  it('skips empty audio output', async () => {
    const ctx = await started();
    ctx.gemini.h.audio(new Int16Array(1));
    ctx.gemini.h.audio(new Int16Array(0));
    expect(ctx.socket.ofType('media').length).toBeLessThanOrEqual(1);
  });

  it('clears queued playback when the resident barges in', async () => {
    const ctx = await started();
    ctx.gemini.h.audio(loud24k());
    ctx.gemini.h.interrupted();
    expect(ctx.socket.ofType('clear')).toEqual([{ event: 'clear', streamSid: 'MZ1' }]);
  });

  it('marks the end of each model turn', async () => {
    const ctx = await started();
    ctx.gemini.h.turnComplete();
    ctx.gemini.h.turnComplete();
    expect(ctx.socket.ofType('mark').map((m) => m.mark.name)).toEqual(['t1', 't2']);
  });
});

describe('CallSession: transcript and ending', () => {
  it('ends after the goodbye has played and saves transcript and recording', async () => {
    const ctx = await started();
    for (let i = 0; i < 10; i++) await ctx.session.onMessage(mediaMessage());
    ctx.gemini.h.outputTranscript('Hello Maggie, ');
    ctx.gemini.h.outputTranscript(' how are you?');
    ctx.gemini.h.inputTranscript('I am ');
    ctx.gemini.h.inputTranscript('fine, thanks.');
    ctx.gemini.h.outputTranscript('Goodbye!');
    ctx.gemini.h.toolCalls([{ id: 'f1', name: 'end_call', args: { reason: 'completed' } }]);
    expect(ctx.gemini.tools[0]).toMatchObject({ scheduling: 'SILENT', response: { status: 'ok' } });

    const mark = await endMark(ctx);
    expect(mark).toMatch(/^end/);
    expect(ctx.socket.closed).toBe(false);
    await ctx.session.onMessage(markMessage('t-unrelated'));
    expect(ctx.socket.closed).toBe(false);
    await ctx.session.onMessage(markMessage(mark));

    expect(ctx.socket.closed).toBe(true);
    expect(ctx.gemini.closed).toBe(true);
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy).toBe('agent');
    expect(call.analysisPending).toBe(true);
    expect(call.transcript!.map((t) => [t.speaker, t.text])).toEqual([
      ['agent', 'Hello Maggie, how are you?'],
      ['resident', 'I am fine, thanks.'],
      ['agent', 'Goodbye!'],
    ]);
    expect(call.transcript![0]!.startMs).toBe(200);
    expect(call.audioUri).toBe(`gs://bucket/recordings/${IDS.residentId}/${IDS.callId}-s1.wav`);
    expect(ctx.recordings.saved[0]!.bytes).toBe(44 + 1600 * 4);
    expect(ctx.session.currentState).toBe('done');
  });

  it('waits for speech that follows end_call before hanging up', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'f1', name: 'end_call', args: {} }]);
    const first = await endMark(ctx);
    ctx.gemini.h.audio(loud24k());
    await ctx.session.onMessage(markMessage(first));
    expect(ctx.socket.closed).toBe(false);
    ctx.gemini.h.turnComplete();
    await ctx.session.onMessage(markMessage(await endMark(ctx)));
    expect(ctx.socket.closed).toBe(true);
  });

  it('hangs up after a fallback delay if the mark never comes back', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'f1', name: 'end_call', args: {} }]);
    await vi.waitFor(() => expect(ctx.session.currentState).toBe('done'), { timeout: 2000 });
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('agent');
  });

  it('records a hang-up by the resident', async () => {
    const ctx = await started();
    ctx.gemini.h.inputTranscript('Bye');
    await ctx.session.onMessage(JSON.stringify({ event: 'stop' }));
    await ctx.session.onSocketClosed();
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy).toBe('resident');
    expect(ctx.recordings.saved).toHaveLength(1);
  });

  it('closes quietly when the socket drops before start', async () => {
    const ctx = await setup();
    await ctx.session.onSocketClosed();
    expect(ctx.socket.closed).toBe(true);
    expect(ctx.recordings.saved).toHaveLength(0);
  });

  it('asks the AI to wrap up, then hangs up at the time limit', async () => {
    const ctx = await started({ maxConversationSec: 1 });
    await vi.waitFor(() => expect(ctx.gemini.texts).toContain(wrapUpCue('Maggie')), { timeout: 2000 });
    await vi.waitFor(() => expect(ctx.socket.ofType('mark').some((m) => m.mark.name.startsWith('end'))).toBe(true), { timeout: 2000 });
    await ctx.session.onMessage(markMessage(await endMark(ctx)));
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('time_limit');
  });

  it('checks on a resident who never speaks, then ends the call as such', async () => {
    const ctx = await started({ silence: { promptSec: 0.02, prompts: 2 } });
    ctx.gemini.h.turnComplete();
    await vi.waitFor(() => expect(ctx.gemini.texts.filter((t) => t === silenceCue('Maggie', false))).toHaveLength(2), { timeout: 2000 });
    // The greeting and both prompts went unanswered, so Hachi says what happens next before hanging up.
    await vi.waitFor(() => expect(ctx.gemini.texts).toContain(silenceFarewellCue('Maggie')), { timeout: 2000 });
    await vi.waitFor(() => expect(ctx.session.currentState).toBe('done'), { timeout: 2000 });
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('silent_after_greeting');
  });

  it('separates going quiet partway through from never speaking at all', async () => {
    const ctx = await started({ silence: { promptSec: 0.02, prompts: 1 } });
    ctx.gemini.h.inputTranscript('Good morning');
    ctx.gemini.h.turnComplete();
    await vi.waitFor(() => expect(ctx.gemini.texts).toContain(silenceCue('Maggie', true)), { timeout: 2000 });
    await vi.waitFor(() => expect(ctx.session.currentState).toBe('done'), { timeout: 2000 });
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy).toBe('stopped_responding');
    expect(ctx.gemini.texts).not.toContain(silenceCue('Maggie', false));
  });

  it('does not count the quiet before a reconnect as a resident who never spoke', async () => {
    const transcript = [{ speaker: 'resident' as const, text: 'I am fine', startMs: 0, endMs: 900 }];
    const ctx = await started({ call: { transcript }, silence: { promptSec: 0.02, prompts: 1 } });
    ctx.gemini.h.turnComplete();
    await vi.waitFor(() => expect(ctx.session.currentState).toBe('done'), { timeout: 2000 });
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('stopped_responding');
  });

  it('starts the silence clock again whenever the resident answers', async () => {
    const ctx = await started({ silence: { promptSec: 0.05, prompts: 1 } });
    for (let i = 0; i < 4; i++) {
      ctx.gemini.h.turnComplete();
      await wait(30);
      ctx.gemini.h.inputTranscript(`Answer ${i}`);
    }
    await wait(30);
    expect(ctx.gemini.texts).not.toContain(silenceCue('Maggie', true));
    expect(ctx.session.currentState).toBe('active');
  });

  it('does not hang up on silence while an emergency is being arranged', async () => {
    const ctx = await started({ silence: { promptSec: 0.02, prompts: 1 } });
    ctx.gemini.h.inputTranscript('I have terrible chest pain');
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1), { timeout: 2000 });
    ctx.gemini.h.turnComplete();
    await wait(80);
    expect(ctx.gemini.texts).not.toContain(silenceCue('Maggie', true));
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy ?? 'emergency').toBe('emergency');
  });

  it('answers unknown tools with an error', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'x', name: 'book_taxi', args: {} }]);
    expect(ctx.gemini.tools[0]).toMatchObject({ response: { status: 'error', retryable: false } });
    expect(ctx.socket.closed).toBe(false);
  });

  it('still finishes when saving fails', async () => {
    const ctx = await started();
    ctx.recordings.fail = true;
    vi.spyOn(ctx.store, 'updateCall').mockRejectedValue(new Error('firestore down'));
    await ctx.session.finish('resident');
    expect(ctx.socket.closed).toBe(true);
    expect(ctx.session.currentState).toBe('done');
  });

  it('ignores events from Gemini after the call ended', async () => {
    const ctx = await started();
    await ctx.session.finish('resident');
    const sent = ctx.socket.sent.length;
    ctx.gemini.h.audio(loud24k());
    ctx.gemini.h.turnComplete();
    ctx.gemini.h.closed('late');
    expect(ctx.socket.sent).toHaveLength(sent);
    expect(ctx.live.sessions).toHaveLength(1);
  });
});

describe('CallSession: emergencies', () => {
  it('raises an emergency from the resident’s words and hands over to the bridge', async () => {
    const ctx = await started();
    ctx.gemini.h.outputTranscript('How are you feeling?');
    ctx.gemini.h.inputTranscript('My chest');
    ctx.gemini.h.inputTranscript('hurts so much.');
    expect(ctx.gemini.texts).toContain(emergencyCue('Maggie'));
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
    expect(ctx.emergency.raised[0]).toMatchObject({ category: 'chest_pain', quote: 'My chest hurts so much.', callId: IDS.callId });

    // The AI should not be able to hang up on its own now.
    ctx.gemini.h.toolCalls([{ id: 'f', name: 'end_call', args: {} }]);
    await vi.waitFor(async () => expect(await endMark(ctx)).toMatch(/^end/));
    await ctx.session.onMessage(markMessage(await endMark(ctx)));
    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.conversation?.endedBy).toBe('emergency');
  });

  it('fires once per category even when repeated', async () => {
    const ctx = await started();
    ctx.gemini.h.inputTranscript('Please help me.');
    ctx.gemini.h.outputTranscript('I am here.');
    ctx.gemini.h.inputTranscript('Please help me.');
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
    expect(ctx.gemini.texts.filter((t) => t === emergencyCue('Maggie'))).toHaveLength(1);
  });

  it('raises an emergency reported by the AI', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'e1', name: 'report_emergency', args: { quote: ' I feel so dizzy ', symptom: 'dizziness' } }]);
    expect(ctx.gemini.tools[0]).toMatchObject({ scheduling: 'INTERRUPT', response: { status: 'ok', message: EMERGENCY_TOOL_GUIDANCE } });
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
    expect(ctx.emergency.raised[0]).toMatchObject({ category: 'reported_by_agent', quote: 'I feel so dizzy', symptom: 'dizziness', confidence: 0.8 });

    ctx.gemini.h.toolCalls([{ id: 'e2', name: 'report_emergency', args: {} }]);
    expect(ctx.gemini.tools[1]!.response.message).toMatch(/already/);
    expect(ctx.emergency.raised).toHaveLength(1);
  });

  it('uses a placeholder quote when the AI gives none', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'e1', name: 'report_emergency', args: { quote: '  ', symptom: 3 } }]);
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
    expect(ctx.emergency.raised[0]).toMatchObject({ quote: 'Reported by Hachi during the call', symptom: undefined });
  });

  it('retries recording the emergency', async () => {
    const ctx = await started();
    ctx.emergency.failures = 2;
    ctx.gemini.h.inputTranscript("I can't breathe");
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
  });

  it('keeps talking and allows a later retry when the emergency cannot be recorded', async () => {
    const ctx = await started({ timing: { emergencyAttempts: 2 } });
    ctx.emergency.failures = 2;
    ctx.gemini.h.inputTranscript("I can't breathe");
    await wait(30);
    expect(ctx.emergency.raised).toHaveLength(0);
    expect(ctx.socket.ofType('mark')).toHaveLength(0);
    expect(ctx.socket.closed).toBe(false);

    ctx.gemini.h.toolCalls([{ id: 'e', name: 'report_emergency', args: { quote: "I can't breathe", symptom: 'breathing' } }]);
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
  });

  it('overrides a pending goodbye', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'f', name: 'end_call', args: {} }]);
    ctx.gemini.h.inputTranscript('Wait, I think I am dying');
    await vi.waitFor(() => expect(ctx.emergency.raised).toHaveLength(1));
    await vi.waitFor(() => expect(ctx.session.currentState).toBe('done'), { timeout: 2000 });
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('emergency');
  });
});

describe('CallSession: reconnects', () => {
  it('reconnects Gemini with the conversation so far', async () => {
    const ctx = await started();
    ctx.gemini.h.outputTranscript('How did you sleep?');
    ctx.gemini.h.inputTranscript('Very well.');
    ctx.gemini.h.closed('error: 1011');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    const next = ctx.live.last;
    expect(next.setup.systemInstruction).toContain('Hachi: How did you sleep?');
    expect(next.setup.systemInstruction).toContain('Maggie: Very well.');
    expect(next.texts).toEqual([resumeCue('Maggie')]);

    // Late events from the dead session are ignored.
    ctx.gemini.h.audio(loud24k());
    expect(ctx.socket.ofType('media')).toHaveLength(0);
    next.h.audio(loud24k());
    expect(ctx.socket.ofType('media')).toHaveLength(1);
  });

  it('resumes from the server handle instead of replaying the conversation', async () => {
    const ctx = await started();
    ctx.gemini.h.outputTranscript('How did you sleep?');
    ctx.gemini.h.inputTranscript('Very well.');
    ctx.gemini.h.resumable('handle-1');
    ctx.gemini.h.resumable('handle-2');
    ctx.gemini.h.closed('error: 1011');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    const next = ctx.live.last;
    expect(next.setup.resumeHandle).toBe('handle-2');
    // The server still holds the conversation, so it is not pasted into the prompt a second time.
    expect(next.setup.systemInstruction).not.toContain('Maggie: Very well.');
    // Nothing is said either: a resumed session picks up mid-sentence, so there is no interruption
    // for Hachi to apologize for.
    expect(next.texts).toEqual([]);
  });

  it('replays the conversation when the server will not take the handle', async () => {
    const ctx = await started();
    ctx.gemini.h.inputTranscript('Very well.');
    ctx.gemini.h.resumable('handle-1');
    ctx.live.rejectHandles = true;
    ctx.gemini.h.closed('error: 1011');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    const next = ctx.live.last;
    expect(next.setup.resumeHandle).toBeUndefined();
    expect(next.setup.systemInstruction).toContain('Maggie: Very well.');
    expect(next.texts).toEqual([resumeCue('Maggie')]);
  });

  it('ignores a handle offered by a session that has already been replaced', async () => {
    const ctx = await started();
    const dead = ctx.gemini;
    dead.h.closed('x');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    dead.h.resumable('stale');
    ctx.live.last.h.closed('y');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(3));
    expect(ctx.live.last.setup.resumeHandle).toBeUndefined();
  });

  it('gives up after too many Gemini sessions', async () => {
    const ctx = await started({ timing: { maxLiveSessions: 2 } });
    ctx.gemini.h.closed('x');
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    ctx.live.last.h.closed('y');
    await vi.waitFor(() => expect(ctx.socket.closed).toBe(true));
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.conversation?.endedBy).toBe('gateway_error');
  });

  it('finishes instead of reconnecting when the call was already ending', async () => {
    const ctx = await started();
    ctx.gemini.h.toolCalls([{ id: 'f', name: 'end_call', args: {} }]);
    ctx.gemini.h.closed('x');
    await vi.waitFor(() => expect(ctx.socket.closed).toBe(true));
    expect(ctx.live.sessions).toHaveLength(1);
  });

  it('closes a Gemini session that connects after the call ended', async () => {
    const ctx = await started();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const connect = ctx.live.connect.bind(ctx.live);
    vi.spyOn(ctx.live, 'connect').mockImplementation(async (s, h) => {
      await gate;
      return connect(s, h);
    });
    ctx.gemini.h.closed('x');
    await ctx.session.finish('resident');
    release();
    await vi.waitFor(() => expect(ctx.live.sessions).toHaveLength(2));
    await tick();
    expect(ctx.live.last.closed).toBe(true);
  });

  it('resumes a new media stream with the saved transcript', async () => {
    const ctx = await setup({
      call: {
        streams: 1,
        audioUri: 'gs://bucket/first.wav',
        transcript: [
          { speaker: 'agent', text: 'Have you eaten today?', startMs: 0, endMs: 2000 },
          { speaker: 'resident', text: 'Yes, rice.', startMs: 2500, endMs: 4000 },
        ],
      },
    });
    await ctx.session.onMessage(startMessage());
    const gemini = ctx.live.last;
    expect(gemini.setup.systemInstruction).toContain('Maggie: Yes, rice.');
    expect(gemini.texts).toEqual([resumeCue('Maggie')]);
    gemini.h.outputTranscript('Sorry about that.');
    await ctx.session.finish('agent');

    const call = (await ctx.store.getCall(IDS.residentId, IDS.callId))!;
    expect(call.streams).toBe(2);
    expect(call.transcript).toHaveLength(3);
    expect(call.transcript![2]).toMatchObject({ speaker: 'agent', text: 'Sorry about that.', startMs: 5000 });
    expect(call.audioUri).toBe('gs://bucket/first.wav');
    expect(call.extraAudioUris).toEqual([`gs://bucket/recordings/${IDS.residentId}/${IDS.callId}-s2.wav`]);
  });
});

describe('CallSession: memory and analysis', () => {
  it('brings up plans from earlier calls and follows up a poor meal', async () => {
    const ctx = await setup();
    await ctx.store.addCalls([
      callDoc({
        id: '2026-10-01-1',
        startedAt: '2026-10-01T01:00:00.000Z',
        localDate: '2026-10-01',
        status: 'completed',
        analysisPending: false,
        analysis: {
          at: '2026-10-01T01:10:00.000Z',
          turns: 2,
          intake: { date: '2026-10-01', status: 'poor' },
          memory: { topics: ['the market'], plans: ['Ken visits on Sunday'], likes: ['green tea'] },
        },
      }),
    ]);
    await ctx.session.onMessage(startMessage());
    const instruction = ctx.live.last.setup.systemInstruction;
    expect(instruction).toContain('(2026-10-01) plan: Ken visits on Sunday');
    expect(instruction).toContain('(2026-10-01) likes: green tea');
    expect(instruction).toContain('had not been eating well');
  });

  it('starts anyway when earlier calls cannot be loaded', async () => {
    const ctx = await setup();
    vi.spyOn(ctx.store, 'listCalls').mockRejectedValueOnce(new Error('firestore down'));
    await ctx.session.onMessage(startMessage());
    expect(ctx.session.currentState).toBe('active');
    expect(ctx.live.last.setup.systemInstruction).not.toContain('Notes from earlier calls');
  });

  it('queues analysis once the transcript is saved', async () => {
    const ctx = await setup();
    const queued: string[] = [];
    ctx.deps.analysis = {
      request: async (residentId, callId, key) => {
        queued.push(`${residentId}/${callId}/${key}`);
      },
    };
    await ctx.session.onMessage(startMessage());
    await ctx.session.finish('resident');
    expect(queued).toEqual([`${IDS.residentId}/${IDS.callId}/s1`]);
    expect(ctx.socket.closed).toBe(true);
  });

  it('still ends the call when analysis cannot be queued or the transcript cannot be saved', async () => {
    const ctx = await setup();
    ctx.deps.analysis = { request: async () => { throw new Error('tasks down'); } };
    await ctx.session.onMessage(startMessage());
    await ctx.session.finish('resident');
    expect(ctx.socket.closed).toBe(true);
    expect((await ctx.store.getCall(IDS.residentId, IDS.callId))!.analysisPending).toBe(true);

    const unsaved = await setup();
    const queued: string[] = [];
    unsaved.deps.analysis = { request: async () => { queued.push('x'); } };
    const update = unsaved.store.updateCall.bind(unsaved.store);
    let writes = 0;
    vi.spyOn(unsaved.store, 'updateCall').mockImplementation(async (residentId, callId, fn) => {
      if (++writes > 1) throw new Error('firestore down');
      return update(residentId, callId, fn);
    });
    await unsaved.session.onMessage(startMessage());
    await unsaved.session.finish('resident');
    expect(queued).toEqual([]);
    expect(unsaved.socket.closed).toBe(true);
  });
});
