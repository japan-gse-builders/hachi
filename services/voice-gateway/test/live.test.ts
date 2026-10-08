import { Behavior, FunctionResponseScheduling, Modality, type LiveServerMessage } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { pcmToBytes } from '../src/audio.js';
import { dispatch, GeminiLiveConnector, TOOLS, type LiveHandlers } from '../src/live.js';

function handlers() {
  return {
    audio: vi.fn(),
    inputTranscript: vi.fn(),
    outputTranscript: vi.fn(),
    interrupted: vi.fn(),
    turnComplete: vi.fn(),
    toolCalls: vi.fn(),
    resumable: vi.fn(),
    notResumable: vi.fn(),
    usage: vi.fn(),
    goingAway: vi.fn(),
    closed: vi.fn(),
  } satisfies LiveHandlers;
}

function fakeAi() {
  const session = { sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
  let params: any;
  const ai = {
    live: {
      connect: vi.fn(async (p: any) => {
        params = p;
        return session;
      }),
    },
  };
  return { ai: ai as any, session, params: () => params };
}

describe('TOOLS', () => {
  it('declares non-blocking report_emergency and end_call', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['report_emergency', 'end_call']);
    expect(TOOLS.every((t) => t.behavior === Behavior.NON_BLOCKING)).toBe(true);
    expect(TOOLS[0]!.parameters?.required).toEqual(['quote', 'symptom']);
  });
});

describe('GeminiLiveConnector', () => {
  it('connects with audio output, transcription, the voice and the tools', async () => {
    const { ai, params } = fakeAi();
    await new GeminiLiveConnector(ai, 'gemini-3.8-live', 'Aoede').connect({ systemInstruction: 'be kind' }, handlers());
    const p = params();
    expect(p.model).toBe('gemini-3.8-live');
    expect(p.config).toMatchObject({
      responseModalities: [Modality.AUDIO],
      systemInstruction: 'be kind',
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: TOOLS }],
    });
  });

  it('asks for transparent resumption and a sliding context window', async () => {
    const { ai, params } = fakeAi();
    await new GeminiLiveConnector(ai, 'm', 'v').connect({ systemInstruction: '' }, handlers());
    expect(params().config.sessionResumption).toEqual({ transparent: true });
    const w = params().config.contextWindowCompression;
    // Shortening has to leave room to keep talking afterwards, so the target is well under the trigger.
    expect(Number(w.slidingWindow.targetTokens)).toBeLessThan(Number(w.triggerTokens));
  });

  it('passes a previous handle back to the server', async () => {
    const { ai, params } = fakeAi();
    await new GeminiLiveConnector(ai, 'm', 'v').connect({ systemInstruction: '', resumeHandle: 'h1' }, handlers());
    expect(params().config.sessionResumption).toEqual({ transparent: true, handle: 'h1' });
  });

  it('sends 16 kHz PCM audio, text and tool responses', async () => {
    const { ai, session } = fakeAi();
    const live = await new GeminiLiveConnector(ai, 'm', 'v').connect({ systemInstruction: '' }, handlers());
    const pcm = new Int16Array([1, -2, 3]);
    live.sendAudio(pcm);
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({ audio: { data: pcmToBytes(pcm).toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    live.sendText('[System] hi');
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({ text: '[System] hi' });
    live.respondToTool({ id: 'f1', name: 'end_call', args: {} }, { status: 'ok' }, 'SILENT');
    expect(session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [{ id: 'f1', name: 'end_call', response: { status: 'ok' }, scheduling: FunctionResponseScheduling.SILENT }],
    });
  });

  it('routes messages and reports unexpected closes, but not our own', async () => {
    const { ai, session, params } = fakeAi();
    const h = handlers();
    const live = await new GeminiLiveConnector(ai, 'm', 'v').connect({ systemInstruction: '' }, h);
    const cb = params().callbacks;
    cb.onmessage({ serverContent: { turnComplete: true } });
    expect(h.turnComplete).toHaveBeenCalled();
    cb.onerror({ message: 'boom' });
    expect(h.closed).toHaveBeenCalledWith('error: boom');
    cb.onclose({ code: 1011, reason: 'internal' });
    expect(h.closed).toHaveBeenCalledWith('closed: 1011 internal');
    cb.onerror({});
    expect(h.closed).toHaveBeenCalledWith('error: unknown');

    h.closed.mockClear();
    live.close();
    expect(session.close).toHaveBeenCalled();
    cb.onclose({ code: 1000 });
    cb.onerror({ message: 'late' });
    expect(h.closed).not.toHaveBeenCalled();
  });

  it('drops the socket without claiming the close as ours', async () => {
    const { ai, session, params } = fakeAi();
    const h = handlers();
    const live = await new GeminiLiveConnector(ai, 'm', 'v').connect({ systemInstruction: '' }, h);
    live.drop();
    expect(session.close).toHaveBeenCalled();
    // The whole point: the gateway has to learn about this close and reconnect from it.
    params().callbacks.onclose({ code: 1000, reason: '' });
    expect(h.closed).toHaveBeenCalledWith('closed: 1000');
  });
});

describe('dispatch', () => {
  it('decodes audio and forwards transcripts, interruptions and turn ends in order', () => {
    const h = handlers();
    const order: string[] = [];
    for (const k of Object.keys(h) as (keyof typeof h)[]) h[k].mockImplementation(() => order.push(k));
    const pcm = new Int16Array([100, -100]);
    dispatch(
      {
        serverContent: {
          inputTranscription: { text: 'hello' },
          interrupted: true,
          modelTurn: {
            parts: [
              { inlineData: { data: pcmToBytes(pcm).toString('base64'), mimeType: 'audio/pcm;rate=24000' } },
              { inlineData: { data: 'AAAA', mimeType: 'image/png' } },
              { text: 'ignored' },
            ],
          },
          outputTranscription: { text: 'hi there' },
          turnComplete: true,
        },
      } as LiveServerMessage,
      h,
    );
    expect(order).toEqual(['inputTranscript', 'interrupted', 'audio', 'outputTranscript', 'turnComplete']);
    expect([...h.audio.mock.calls[0]![0]]).toEqual([100, -100]);
    expect(h.inputTranscript).toHaveBeenCalledWith('hello');
    expect(h.outputTranscript).toHaveBeenCalledWith('hi there');
  });

  it('forwards tool calls with defaults for missing fields', () => {
    const h = handlers();
    dispatch({ toolCall: { functionCalls: [{ id: 'a', name: 'end_call', args: { reason: 'completed' } }, {}] } } as LiveServerMessage, h);
    expect(h.toolCalls).toHaveBeenCalledWith([
      { id: 'a', name: 'end_call', args: { reason: 'completed' } },
      { id: '', name: '', args: {} },
    ]);
  });

  it('keeps only the handles the server calls resumable, and says when it kept none', () => {
    const h = handlers();
    dispatch({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } } as LiveServerMessage, h);
    // Mid-generation the server offers a handle that would lose part of the conversation.
    dispatch({ sessionResumptionUpdate: { newHandle: 'h2', resumable: false } } as LiveServerMessage, h);
    dispatch({ sessionResumptionUpdate: { resumable: true } } as LiveServerMessage, h);
    expect(h.resumable.mock.calls).toEqual([['h1']]);
    expect(h.notResumable).toHaveBeenCalledTimes(2);
  });

  it('forwards the token counts and the warning that the server is about to disconnect', () => {
    const h = handlers();
    dispatch({ usageMetadata: { promptTokenCount: 17_200, totalTokenCount: 17_900 } } as LiveServerMessage, h);
    // Missing counts are reported as zero rather than dropped, so one quiet turn cannot look like a
    // context that shrank.
    dispatch({ usageMetadata: {} } as LiveServerMessage, h);
    dispatch({ goAway: { timeLeft: '10s' } } as LiveServerMessage, h);
    dispatch({ goAway: {} } as LiveServerMessage, h);
    expect(h.usage.mock.calls).toEqual([[{ promptTokens: 17_200, totalTokens: 17_900 }], [{ promptTokens: 0, totalTokens: 0 }]]);
    expect(h.goingAway.mock.calls).toEqual([['10s'], [undefined]]);
  });

  it('ignores empty messages', () => {
    const h = handlers();
    dispatch({} as LiveServerMessage, h);
    dispatch({ serverContent: {}, toolCall: { functionCalls: [] } } as unknown as LiveServerMessage, h);
    expect(Object.values(h).every((f) => f.mock.calls.length === 0)).toBe(true);
  });
});
