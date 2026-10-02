import {
  Behavior,
  FunctionResponseScheduling,
  Modality,
  Type,
  type FunctionDeclaration,
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
  /** The session ended; not called after `close()`. */
  closed(reason: string): void;
}

export interface LiveSession {
  sendAudio(pcm16k: Int16Array): void;
  /** Instruction from the system (not resident speech). */
  sendText(text: string): void;
  respondToTool(call: ToolCall, response: Record<string, unknown>, scheduling: ToolScheduling): void;
  close(): void;
}

export interface LiveSetup {
  systemInstruction: string;
}

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
  const calls = m.toolCall?.functionCalls ?? [];
  if (calls.length) {
    h.toolCalls(calls.map((f) => ({ id: f.id ?? '', name: f.name ?? '', args: (f.args ?? {}) as Record<string, unknown> })));
  }
}
