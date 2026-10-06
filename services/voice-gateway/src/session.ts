import { timingSafeEqual } from 'node:crypto';
import { itemsForCall, localDate, R1Monitor, type ScreenItem, type Turn } from '@hachi/core';
import type { CallRecord, ConversationEnd, Resident, Store } from '@hachi/store';
import { concatPcm, decodeMuLaw, Downsampler, encodeMuLaw, Upsampler } from './audio.js';
import type { EmergencyInput, EmergencyRaiser } from './emergency.js';
import type { LiveConnector, LiveHandlers, LiveSession, ToolCall } from './live.js';
import { buildSystemInstruction, priorContext, EMERGENCY_TOOL_GUIDANCE, emergencyCue, openingCue, resumeCue, wrapUpCue, type PriorContext } from './prompt.js';
import { CallRecorder } from './recorder.js';

export interface RecordingSink {
  /** Returns the gs:// URI. */
  save(path: string, wav: Buffer): Promise<string>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface AnalysisRequester {
  /** Schedules the post-call analysis; `key` distinguishes the media streams of one call. */
  request(residentId: string, callId: string, key: string): Promise<void>;
}

export interface SessionDeps {
  store: Store;
  live: LiveConnector;
  emergency: EmergencyRaiser;
  recordings: RecordingSink;
  /** Without it the analysis worker's sweep picks the call up. */
  analysis?: AnalysisRequester;
  log: Logger;
  config: { maxConversationSec: number };
  /** Overridable for tests. */
  timing?: Partial<SessionTiming>;
}

export interface SessionTiming {
  /** Seconds before the limit at which the AI is asked to wrap up. */
  wrapUpLeadSec: number;
  /** Give up waiting for the goodbye to finish playing. */
  endFallbackMs: number;
  /** After an emergency, close the stream even if the reassurance has not finished. */
  emergencyFallbackMs: number;
  liveConnectAttempts: number;
  liveRetryDelayMs: number;
  /** Gemini sessions per media stream (first plus reconnects). */
  maxLiveSessions: number;
  emergencyAttempts: number;
  emergencyRetryDelayMs: number;
}

const DEFAULT_TIMING: SessionTiming = {
  wrapUpLeadSec: 45,
  endFallbackMs: 15_000,
  emergencyFallbackMs: 20_000,
  liveConnectAttempts: 3,
  liveRetryDelayMs: 300,
  maxLiveSessions: 3,
  emergencyAttempts: 5,
  emergencyRetryDelayMs: 500,
};

/** Audio sent to Gemini in 40 ms chunks (20–100 ms recommended). */
const SEND_SAMPLES = 640;
/** Audio buffered while Gemini connects (about 3 s). */
const MAX_PENDING_SAMPLES = 16_000 * 3;

export interface TwilioSocket {
  send(data: string): void;
  close(): void;
}

type State = 'waiting' | 'active' | 'finishing' | 'done';

function tokensMatch(expected: string | undefined, given: unknown): boolean {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * One Twilio media stream bridged to a Gemini Live session.
 * Twilio → μ-law 8 kHz → PCM 16 kHz → Gemini; Gemini → PCM 24 kHz → μ-law 8 kHz → Twilio.
 */
export class CallSession {
  private state: State = 'waiting';
  private readonly t: SessionTiming;
  private ids?: { residentId: string; callId: string };
  private resident?: Resident;
  private streamSid = '';
  private streamNo = 1;
  private previousTurns: Turn[] = [];
  private prior?: PriorContext;
  private items: readonly ScreenItem[] = [];
  private offsetMs = 0;

  private live?: LiveSession;
  private liveGeneration = 0;
  private liveSessions = 0;
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private outgoing: Int16Array[] = [];
  private outgoingSamples = 0;

  private readonly recorder = new CallRecorder();
  private readonly up = new Upsampler();
  private readonly down = new Downsampler();
  private readonly monitor = new R1Monitor();
  private readonly turns: Turn[] = [];

  private emergency: 'none' | 'raising' | 'raised' | 'failed' = 'none';
  private endReason?: ConversationEnd;
  private hangupMark?: string;
  private markSeq = 0;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly deps: SessionDeps,
    private readonly socket: TwilioSocket,
  ) {
    this.t = { ...DEFAULT_TIMING, ...deps.timing };
  }

  get currentState(): State {
    return this.state;
  }

  async onMessage(raw: string): Promise<void> {
    let msg: { event?: string; start?: any; streamSid?: string; media?: any; mark?: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.event) {
      case 'start':
        return this.onStart(msg);
      case 'media':
        return this.onMedia(msg.media);
      case 'mark':
        return this.onMark(msg.mark?.name);
      case 'stop':
        return this.finish('resident');
    }
  }

  /** Twilio closed the socket (the resident hung up or the call dropped). */
  async onSocketClosed(): Promise<void> {
    await this.finish('resident');
  }

  private async onStart(msg: { start?: any; streamSid?: string }): Promise<void> {
    if (this.state !== 'waiting') return;
    const start = msg.start ?? {};
    const p = (start.customParameters ?? {}) as Record<string, unknown>;
    const residentId = typeof p.residentId === 'string' ? p.residentId : '';
    const callId = typeof p.callId === 'string' ? p.callId : '';
    this.streamSid = start.streamSid ?? msg.streamSid ?? '';
    const callSid: string | undefined = start.callSid;

    const [call, resident] = residentId && callId
      ? await Promise.all([this.deps.store.getCall(residentId, callId), this.deps.store.getResident(residentId)])
      : [null, null];
    if (!call || !resident || !tokensMatch(call.streamToken, p.streamToken) || (call.providerCallId && callSid && call.providerCallId !== callSid)) {
      this.deps.log.warn({ residentId, callId }, 'rejected media stream');
      this.state = 'done';
      this.socket.close();
      return;
    }

    this.ids = { residentId, callId };
    this.resident = resident;
    const updated = await this.deps.store.updateCall(residentId, callId, (c) => ({
      ...c,
      streams: (c.streams ?? 0) + 1,
      ...(callSid && !c.providerCallId ? { providerCallId: callSid } : {}),
    }));
    this.streamNo = updated.streams ?? 1;
    this.previousTurns = call.transcript ?? [];
    this.offsetMs = this.previousTurns.length ? this.previousTurns[this.previousTurns.length - 1]!.endMs + 1000 : 0;
    // The rotation runs on the calendar, so a resumed stream asks the same questions as the first.
    this.items = itemsForCall(
      resident.serviceStartedAt.slice(0, 10),
      call.localDate ?? localDate(new Date(), resident.timeZone),
    );
    try {
      const recent = await this.deps.store.listCalls(residentId, { limit: 8 });
      this.prior = priorContext(recent.filter((c) => c.id !== callId));
    } catch (err) {
      this.deps.log.warn({ ...this.ids, err: (err as Error).message }, 'could not load earlier calls');
    }
    this.state = 'active';
    this.deps.log.info({ ...this.ids, stream: this.streamNo }, 'media stream started');

    const remainingSec = Math.max(1, this.deps.config.maxConversationSec - Math.floor(this.offsetMs / 1000));
    this.timer((remainingSec - Math.min(this.t.wrapUpLeadSec, remainingSec / 2)) * 1000, () => {
      if (!this.emergencyActive && !this.endReason) this.live?.sendText(wrapUpCue(this.name));
    });
    this.timer(remainingSec * 1000, () => {
      if (!this.emergencyActive) this.requestEnd('time_limit');
    });

    await this.connectLive(this.previousTurns.length > 0);
  }

  /** While help is being arranged the call must not end by itself. */
  private get emergencyActive(): boolean {
    return this.emergency === 'raising' || this.emergency === 'raised';
  }

  private get name(): string {
    return this.resident?.preferredName ?? 'there';
  }

  private timer(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clockMs(): number {
    return this.offsetMs + this.recorder.elapsedMs;
  }

  private async connectLive(resume: boolean): Promise<void> {
    if (this.liveSessions >= this.t.maxLiveSessions) return this.finish('gateway_error');
    this.liveSessions++;
    const generation = ++this.liveGeneration;
    const handlers = this.handlers(generation);
    const history = [...this.previousTurns, ...this.transcript()];
    let session: LiveSession | undefined;
    for (let attempt = 0; attempt < this.t.liveConnectAttempts && !session; attempt++) {
      try {
        session = await this.deps.live.connect(
          { systemInstruction: buildSystemInstruction(this.name, history, this.prior, this.items) },
          handlers,
        );
      } catch (err) {
        this.deps.log.warn({ ...this.ids, attempt, err: (err as Error).message }, 'Gemini Live connect failed');
        if (attempt + 1 < this.t.liveConnectAttempts) await sleep(this.t.liveRetryDelayMs * (attempt + 1));
      }
    }
    if (!session) return this.finish('gateway_error');
    if (this.state !== 'active' || generation !== this.liveGeneration) {
      session.close();
      return;
    }
    this.live = session;
    session.sendText(resume ? resumeCue(this.name) : openingCue(this.name));
    if (this.pending.length) {
      session.sendAudio(concatPcm(this.pending));
      this.pending = [];
      this.pendingSamples = 0;
    }
  }

  private handlers(generation: number): LiveHandlers {
    const current = () => generation === this.liveGeneration && this.state === 'active';
    return {
      audio: (pcm) => current() && this.onModelAudio(pcm),
      inputTranscript: (text) => current() && this.onResidentText(text),
      outputTranscript: (text) => current() && this.appendTurn('agent', text),
      interrupted: () => {
        if (!current()) return;
        this.sendTwilio({ event: 'clear', streamSid: this.streamSid });
        this.recorder.clearOutbound();
        this.down.reset();
      },
      turnComplete: () => {
        if (!current()) return;
        const name = `t${++this.markSeq}`;
        this.sendTwilio({ event: 'mark', streamSid: this.streamSid, mark: { name } });
        if (this.endReason) this.hangupMark = name;
      },
      toolCalls: (calls) => current() && calls.forEach((c) => this.onToolCall(c)),
      closed: (reason) => {
        if (!current()) return;
        this.deps.log.warn({ ...this.ids, reason }, 'Gemini Live session closed unexpectedly');
        this.live = undefined;
        if (this.endReason) return void this.finish(this.endReason);
        void this.connectLive(true);
      },
    };
  }

  private onMedia(media: { track?: string; payload?: string } | undefined): void {
    if (this.state !== 'active' || !media?.payload || (media.track && media.track !== 'inbound')) return;
    const mulaw = Buffer.from(media.payload, 'base64');
    this.recorder.appendInbound(mulaw);
    const pcm = this.up.process(decodeMuLaw(mulaw));
    if (!this.live) {
      this.pending.push(pcm);
      this.pendingSamples += pcm.length;
      while (this.pendingSamples > MAX_PENDING_SAMPLES) this.pendingSamples -= this.pending.shift()!.length;
      return;
    }
    this.outgoing.push(pcm);
    this.outgoingSamples += pcm.length;
    if (this.outgoingSamples >= SEND_SAMPLES) {
      this.live.sendAudio(concatPcm(this.outgoing));
      this.outgoing = [];
      this.outgoingSamples = 0;
    }
  }

  private onModelAudio(pcm24k: Int16Array): void {
    const mulaw = encodeMuLaw(this.down.process(pcm24k));
    if (!mulaw.length) return;
    this.sendTwilio({ event: 'media', streamSid: this.streamSid, media: { payload: mulaw.toString('base64') } });
    this.recorder.appendOutbound(mulaw);
    // More speech after the goodbye: wait for the next turn to finish before hanging up.
    if (this.endReason) this.hangupMark = undefined;
  }

  private async onMark(name: unknown): Promise<void> {
    if (this.endReason && typeof name === 'string' && name === this.hangupMark) await this.finish(this.endReason);
  }

  private appendTurn(speaker: Turn['speaker'], text: string): Turn {
    const now = this.clockMs();
    const last = this.turns[this.turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text += text;
      last.endMs = now;
      return last;
    }
    const turn: Turn = { speaker, text, startMs: now, endMs: now };
    this.turns.push(turn);
    return turn;
  }

  private transcript(): Turn[] {
    return this.turns.map((t) => ({ ...t, text: tidy(t.text) })).filter((t) => t.text);
  }

  private onResidentText(text: string): void {
    if (this.turns[this.turns.length - 1]?.speaker !== 'resident') this.monitor.endTurn();
    const turn = this.appendTurn('resident', text);
    const [signal] = this.monitor.push(text, { startMs: turn.startMs, endMs: turn.endMs });
    if (signal) {
      this.live?.sendText(emergencyCue(this.name));
      void this.raiseEmergency({ quote: signal.quote, category: signal.category, confidence: signal.confidence, startMs: turn.startMs, endMs: turn.endMs });
    }
  }

  private onToolCall(call: ToolCall): void {
    const live = this.live;
    if (call.name === 'end_call') {
      live?.respondToTool(call, { status: 'ok', retryable: false, message: 'The call will end now.' }, 'SILENT');
      if (!this.emergencyActive) this.requestEnd('agent');
      return;
    }
    if (call.name === 'report_emergency') {
      const quote = typeof call.args.quote === 'string' && call.args.quote.trim() ? call.args.quote.trim() : 'Reported by Hachi during the call';
      const symptom = typeof call.args.symptom === 'string' ? call.args.symptom : undefined;
      const already = this.emergencyActive;
      live?.respondToTool(call, { status: 'ok', retryable: false, message: already ? 'Help is already being contacted.' : EMERGENCY_TOOL_GUIDANCE }, 'INTERRUPT');
      const now = this.clockMs();
      void this.raiseEmergency({ quote, category: 'reported_by_agent', confidence: 0.8, symptom, startMs: now, endMs: now });
      return;
    }
    live?.respondToTool(call, { status: 'error', retryable: false, message: `Unknown tool ${call.name}. Do not call it again.` }, 'SILENT');
  }

  private async raiseEmergency(input: Omit<EmergencyInput, 'resident' | 'callId'>): Promise<void> {
    if (this.emergencyActive || !this.resident || !this.ids) return;
    this.emergency = 'raising';
    this.deps.log.warn({ ...this.ids, category: input.category }, 'EMERGENCY detected during call');
    for (let attempt = 0; attempt < this.t.emergencyAttempts; attempt++) {
      try {
        await this.deps.emergency.raise({ ...input, resident: this.resident, callId: this.ids.callId });
        this.emergency = 'raised';
        break;
      } catch (err) {
        this.deps.log.error({ ...this.ids, attempt, err: (err as Error).message }, 'failed to record emergency');
        if (attempt + 1 < this.t.emergencyAttempts) await sleep(this.t.emergencyRetryDelayMs * 2 ** attempt);
      }
    }
    if (this.emergency !== 'raised') {
      // Without the record the telephony service cannot bridge; keep the resident talking to Hachi.
      this.emergency = 'failed';
      return;
    }
    this.requestEnd('emergency', this.t.emergencyFallbackMs);
  }

  /** Ends after the current speech has played (Twilio echoes the mark), or after a fallback delay. */
  private requestEnd(reason: ConversationEnd, fallbackMs = this.t.endFallbackMs): void {
    if (this.state !== 'active' || (this.endReason && this.endReason !== 'agent' && this.endReason !== 'time_limit')) return;
    this.endReason = reason;
    const name = `end${++this.markSeq}`;
    this.hangupMark = name;
    this.sendTwilio({ event: 'mark', streamSid: this.streamSid, mark: { name } });
    this.timer(fallbackMs, () => void this.finish(this.endReason ?? reason));
  }

  private sendTwilio(msg: object): void {
    if (this.state === 'active') this.socket.send(JSON.stringify(msg));
  }

  /**
   * Saves why the conversation ended before closing the socket: Twilio then asks the telephony
   * service what to do next, and that decision reads this record.
   */
  async finish(reason: ConversationEnd): Promise<void> {
    if (this.state === 'finishing' || this.state === 'done') return;
    const started = this.state === 'active';
    this.state = 'finishing';
    for (const t of this.timers) clearTimeout(t);
    this.liveGeneration++;
    this.live?.close();
    this.live = undefined;
    if (!started || !this.ids) {
      this.state = 'done';
      this.socket.close();
      return;
    }
    const ids = this.ids;
    const at = new Date().toISOString();
    const transcript = [...this.previousTurns, ...this.transcript()];
    let saved = false;
    try {
      await this.deps.store.updateCall(ids.residentId, ids.callId, (c): CallRecord => ({
        ...c,
        transcript,
        conversation: { endedBy: reason, at },
        analysisPending: true,
      }));
      saved = true;
    } catch (err) {
      this.deps.log.error({ ...ids, err: (err as Error).message }, 'failed to save transcript');
    }
    if (saved && this.deps.analysis) {
      try {
        await this.deps.analysis.request(ids.residentId, ids.callId, `s${this.streamNo}`);
      } catch (err) {
        this.deps.log.error({ ...ids, err: (err as Error).message }, 'failed to queue analysis');
      }
    }
    this.socket.close();
    this.deps.log.info({ ...ids, reason, turns: transcript.length }, 'conversation ended');

    try {
      const uri = await this.deps.recordings.save(`recordings/${ids.residentId}/${ids.callId}-s${this.streamNo}.wav`, this.recorder.toWav());
      await this.deps.store.updateCall(ids.residentId, ids.callId, (c) =>
        c.audioUri && c.audioUri !== uri ? { ...c, extraAudioUris: [...(c.extraAudioUris ?? []), uri] } : { ...c, audioUri: uri },
      );
    } catch (err) {
      this.deps.log.error({ ...ids, err: (err as Error).message }, 'failed to save recording');
    }
    this.state = 'done';
  }
}
