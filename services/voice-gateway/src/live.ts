import {
  Behavior,
  FunctionResponseScheduling,
  Modality,
  Type,
  type FunctionDeclaration,
  type AutomaticActivityDetection,
  type GoogleGenAI,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { pcmFromBytes, pcmToBytes } from './audio.js';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ToolScheduling = 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT';

/** Events from the model, already decoded. */
export interface LiveHandlers {
  audio(pcm24k: Int16Array): void;
  inputTranscript(text: string): void;
  outputTranscript(text: string): void;
  interrupted(): void;
  turnComplete(): void;
  toolCalls(calls: ToolCall[]): void;
  /**
   * A point the server can restore the conversation from. Sent repeatedly during a call; the most
   * recent resumable one is the only one worth keeping.
   */
  resumable(handle: string): void;
  /**
   * The server offered a point it cannot restore from, because it was mid-generation. Reported
   * separately from `resumable` because "the server never offered a handle" and "every handle it
   * offered was unusable" are different faults, and silently dropping these makes them look alike.
   */
  notResumable(): void;
  /**
   * What the server counted for the turn it has just answered. Live re-sends the whole session
   * context on every turn, so `promptTokens` is the size of the context window rather than of one
   * question. Nothing in the protocol says that the window was compressed, so this is the only
   * quantity that can show whether the compression trigger was ever within reach.
   */
  usage(tokens: { promptTokens: number; totalTokens: number }): void;
  /**
   * The server intends to close the connection shortly. This is the case transparent resumption
   * exists for, so it is worth telling apart from a close nobody announced: the first is the
   * mechanism working as designed, the second is a fault.
   */
  goingAway(timeLeft: string | undefined): void;
  /** The session ended; not called after `close()`. */
  closed(reason: string): void;
}

export interface LiveSession {
  sendAudio(pcm16k: Int16Array): void;
  /** Instruction from the system (not resident speech). */
  sendText(text: string): void;
  respondToTool(call: ToolCall, response: Record<string, unknown>, scheduling: ToolScheduling): void;
  close(): void;
  /**
   * Closes the socket the way a network fault would, leaving `closed` to fire and the reconnect to
   * follow. `close()` cannot stand in for it: marking the close as ours is exactly what stops a call
   * we are ending from being read as a fault, and that is also what makes it useless here.
   */
  drop(): void;
}

export interface LiveSetup {
  systemInstruction: string;
  /** From a previous session of the same call; the server restores the conversation from it. */
  resumeHandle?: string;
}

/**
 * When to start dropping the oldest turns. A check-in call is three to five minutes and is cut off
 * at eight, and Live audio costs roughly fifty tokens a second across both directions, so a call
 * that runs to its limit lands near thirty thousand. The window is set below that: compression will
 * not touch an ordinary call, and a long one is shortened at a turn boundary instead of being
 * dropped when the context fills. The system instruction is never part of the window, so the
 * persona and the safety rules survive it.
 */
const COMPRESSION = { triggerTokens: '16000', slidingWindow: { targetTokens: '8000' } };

export interface LiveConnector {
  connect(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveSession>;
}

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'report_emergency',
    description:
      'Call immediately when the resident describes a possible medical emergency happening now, for example chest pain or ' +
      'pressure, trouble breathing, being unable to move or get up, face drooping, slurred speech or sudden weakness, ' +
      'fainting, heavy bleeding, feeling they are dying, or asking for help.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        quote: { type: Type.STRING, description: "The resident's own words, verbatim." },
        symptom: { type: Type.STRING, description: 'Short description of the problem, e.g. "chest pain".' },
      },
      required: ['quote', 'symptom'],
    },
  },
  {
    name: 'end_call',
    description: 'Hang up. Call this only after you have said goodbye.',
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, enum: ['completed', 'resident_request', 'wrong_person', 'voicemail'] },
      },
      required: ['reason'],
    },
  },
];

/** Gemini Live API on Gemini Enterprise Agent Platform (Vertex AI), authenticated by the service account. */
export class GeminiLiveConnector implements LiveConnector {
  constructor(
    private readonly ai: Pick<GoogleGenAI, 'live'>,
    private readonly model: string,
    private readonly voice: string,
    private readonly activityDetection?: AutomaticActivityDetection,
  ) {}

  async connect(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveSession> {
    let closedByUs = false;
    const session: Session = await this.ai.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: setup.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: TOOLS }],
        ...(this.activityDetection ? { realtimeInputConfig: { automaticActivityDetection: this.activityDetection } } : {}),
        // Transparent, so the server reports how much of what we sent it actually kept. A dropped
        // websocket mid-call is then a gap of a second or two rather than a restarted conversation.
        sessionResumption: { transparent: true, ...(setup.resumeHandle ? { handle: setup.resumeHandle } : {}) },
        contextWindowCompression: COMPRESSION,
      },
      callbacks: {
        onmessage: (m) => dispatch(m, handlers),
        onerror: (e) => {
          if (!closedByUs) handlers.closed(`error: ${(e as { message?: string }).message ?? 'unknown'}`);
        },
        onclose: (e) => {
          if (!closedByUs) handlers.closed(`closed: ${(e as { code?: number }).code ?? ''} ${(e as { reason?: string }).reason ?? ''}`.trim());
        },
      },
    });
    return {
      sendAudio: (pcm) => session.sendRealtimeInput({ audio: { data: pcmToBytes(pcm).toString('base64'), mimeType: 'audio/pcm;rate=16000' } }),
      sendText: (text) => session.sendRealtimeInput({ text }),
      respondToTool: (call, response, scheduling) =>
        session.sendToolResponse({
          functionResponses: [{ id: call.id, name: call.name, response, scheduling: FunctionResponseScheduling[scheduling] }],
        }),
      close: () => {
        closedByUs = true;
        session.close();
      },
      drop: () => session.close(),
    };
  }
}

export function dispatch(m: LiveServerMessage, h: LiveHandlers): void {
  const c = m.serverContent;
  if (c) {
    if (c.inputTranscription?.text) h.inputTranscript(c.inputTranscription.text);
    if (c.interrupted) h.interrupted();
    for (const part of c.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data && part.inlineData?.mimeType?.startsWith('audio/')) h.audio(pcmFromBytes(Buffer.from(data, 'base64')));
    }
    if (c.outputTranscription?.text) h.outputTranscript(c.outputTranscription.text);
    if (c.turnComplete) h.turnComplete();
  }
  const u = m.usageMetadata;
  if (u) h.usage({ promptTokens: u.promptTokenCount ?? 0, totalTokens: u.totalTokenCount ?? 0 });
  if (m.goAway) h.goingAway(m.goAway.timeLeft);
  const r = m.sessionResumptionUpdate;
  // A handle offered while the model is mid-generation comes back as not resumable, and using one
  // loses part of the conversation, so only the resumable ones are kept.
  if (r) {
    if (r.resumable && r.newHandle) h.resumable(r.newHandle);
    else h.notResumable();
  }
  const calls = m.toolCall?.functionCalls ?? [];
  if (calls.length) {
    h.toolCalls(calls.map((f) => ({ id: f.id ?? '', name: f.name ?? '', args: (f.args ?? {}) as Record<string, unknown> })));
  }
}
