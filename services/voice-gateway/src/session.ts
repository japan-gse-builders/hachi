import { timingSafeEqual } from 'node:crypto';
import {
  classifyGatewayFailure,
  hasCallConsent,
  itemsForCall,
  localDate,
  R1Monitor,
  recordGatewayFailure,
  recordGatewaySuccess,
  type ScreenItem,
  type Turn,
} from '@hachi/core';
import type { CallRecord, ConversationEnd, Resident, Store } from '@hachi/store';
import { concatPcm, decodeMuLaw, Downsampler, encodeMuLaw, Upsampler } from './audio.js';
import type { EmergencyInput, EmergencyRaiser } from './emergency.js';
import type { LiveConnector, LiveHandlers, LiveSession, ToolCall } from './live.js';
import {
  buildSystemInstruction,
  priorContext,
  EMERGENCY_TOOL_GUIDANCE,
  emergencyCue,
  openingCue,
  resumeCue,
  silenceCue,
  silenceFarewellCue,
  wrapUpCue,
  type PriorContext,
} from './prompt.js';
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
  config: {
    maxConversationSec: number;
    silence: { promptSec: number; prompts: number };
    /** See `GatewayConfig.forcedLiveDrop`. Absent in every deployment that is not being tested. */
    forcedLiveDrop?: { residentId: string; afterSec: number };
  };
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

/**
 * Endings that an emergency may still overwrite. The goodbye is still playing at this point, so if
 * the resident says something alarming on the way out, that is what the call ended for.
 */
const REPLACEABLE_END: ReadonlySet<ConversationEnd> = new Set(['agent', 'time_limit', 'silent_after_greeting', 'stopped_responding']);

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
  /** Staff asked for this call; it comes outside the daily schedule (issue #13). */
  private unscheduled = false;
  private offsetMs = 0;

  private live?: LiveSession;
  private liveGeneration = 0;
  private liveSessions = 0;
  /** True once a session was established, so a resident who hung up first is not read as a fault. */
  private liveReady = false;
  /** The Live API's own words for the latest failure; the only thing that says whether to retry. */
  private liveFailure?: string;
  /** Latest point the Live API said it could restore this conversation from. */
  private resumeHandle?: string;
  /**
   * What the Live API did over the whole call, counted rather than logged event by event. Handles
   * arrive every few seconds and token counts arrive every turn; a line each would bury the lines
   * that say a call went wrong, across several hundred calls a day.
   *
   * `contextShrinks` is an inference and not a report. The protocol has no field for "I compressed
   * the window", so the only evidence available is the prompt token count attached to each turn —
   * which for Live is the whole session context — going down instead of up. A call whose
   * `peakPromptTokens` never approaches the trigger says nothing either way, rather than saying no.
   */
  private readonly liveStats = {
    handles: 0,
    unusableHandles: 0,
    resumedFromHandle: 0,
    replayedTranscript: 0,
    goAways: 0,
    peakPromptTokens: 0,
    contextShrinks: 0,
  };
  private lastPromptTokens = 0;
  private forcedDropArmed = false;
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
  /** Separate from `timers` because it is restarted every time either side stops speaking. */
  private silenceTimer?: NodeJS.Timeout;
  private silencePrompts = 0;
  private heardResident = false;

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
    if (!call || !resident?.active || !hasCallConsent(resident.callConsent) || !tokensMatch(call.streamToken, p.streamToken) || (call.providerCallId && callSid && call.providerCallId !== callSid)) {
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
    // A reconnected stream must not treat the quiet after the drop as a resident who never spoke.
    this.heardResident = this.previousTurns.some((t) => t.speaker === 'resident');
    this.offsetMs = this.previousTurns.length ? this.previousTurns[this.previousTurns.length - 1]!.endMs + 1000 : 0;
    this.unscheduled = call.trigger === 'staff';
    // The rotation runs on the calendar, so a resumed stream asks the same questions as the first.
    // The set questions belong to the daily call; an extra call staff asked for is about now.
    this.items = this.unscheduled ? [] : itemsForCall(
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

  /**
   * Starts the clock on silence once Hachi has stopped talking. Nothing in the audio path notices a
   * resident who says nothing: Gemini sends no transcript, so without this the call runs until the
   * time limit and is then filed as a conversation that happened.
   */
  private armSilence(): void {
    this.clearSilence();
    if (this.state !== 'active' || this.endReason || this.emergencyActive) return;
    this.silenceTimer = setTimeout(() => this.onSilence(), this.deps.config.silence.promptSec * 1000);
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
  }

  private onSilence(): void {
    this.silenceTimer = undefined;
    if (this.state !== 'active' || this.endReason || this.emergencyActive) return;
    if (++this.silencePrompts <= this.deps.config.silence.prompts) {
      this.live?.sendText(silenceCue(this.name, this.heardResident, this.unscheduled));
      // Re-armed here as well as on turnComplete, so a model that answers with nothing still ends.
      this.armSilence();
      return;
    }
    const reason: ConversationEnd = this.heardResident ? 'stopped_responding' : 'silent_after_greeting';
    this.deps.log.warn({ ...this.ids, reason, prompts: this.silencePrompts - 1 }, 'no answer from the resident');
    this.live?.sendText(silenceFarewellCue(this.name));
    this.requestEnd(reason);
  }

  private clockMs(): number {
    return this.offsetMs + this.recorder.elapsedMs;
  }

  private async connectLive(resume: boolean): Promise<void> {
    if (this.liveSessions >= this.t.maxLiveSessions) return this.finish('gateway_error');
    this.liveSessions++;
    const generation = ++this.liveGeneration;
    const handlers = this.handlers(generation);
    // With a handle the server still holds the conversation, so pasting the transcript back into the
    // prompt would say everything twice; without one the transcript is all that is left of it.
    const setupFor = (handle?: string) => ({
      systemInstruction: buildSystemInstruction(
        this.name,
        handle ? [] : [...this.previousTurns, ...this.transcript()],
        this.prior,
        this.items,
        { unscheduled: this.unscheduled },
      ),
      ...(handle ? { resumeHandle: handle } : {}),
    });
    let handle = resume ? this.resumeHandle : undefined;
    let session: LiveSession | undefined;
    for (let attempt = 0; attempt < this.t.liveConnectAttempts && !session; attempt++) {
      try {
        session = await this.deps.live.connect(setupFor(handle), handlers);
      } catch (err) {
        const reason = (err as Error).message;
        this.liveFailure = reason;
        this.deps.log.warn({ ...this.ids, attempt, resumed: Boolean(handle), err: reason }, 'Gemini Live connect failed');
        // A fault that meets every attempt identically meets the next two as well, and each one is
        // more dead air for somebody holding a phone to their ear.
        if (classifyGatewayFailure(reason) === 'systemic') break;
        // A handle the server will not take is worse than none: drop it and replay the transcript.
        handle = undefined;
        if (attempt + 1 < this.t.liveConnectAttempts) await sleep(this.t.liveRetryDelayMs * (attempt + 1));
      }
    }
    if (!session) return this.finish('gateway_error');
    if (this.state !== 'active' || generation !== this.liveGeneration) {
      session.close();
      return;
    }
    this.live = session;
    this.liveReady = true;
    if (!resume) session.sendText(openingCue(this.name));
    else if (!handle) {
      this.liveStats.replayedTranscript++;
      // Warn rather than info: the handle is the path that keeps the audio context, so falling back
      // is a quiet loss of the thing R3 measures, and nothing else in the call will mention it.
      this.deps.log.warn({ ...this.ids, session: this.liveSessions, offered: this.liveStats.handles }, 'reconnected by replaying the conversation, not from a handle');
      session.sendText(resumeCue(this.name));
    } else {
      this.liveStats.resumedFromHandle++;
      this.deps.log.info({ ...this.ids, session: this.liveSessions, handleChars: handle.length }, 'reconnected from a Gemini Live resumption handle');
      // A resumed session picks up mid-sentence, so there is nothing to apologize for and nothing to
      // say. Nothing will speak either, so the silence clock is started here instead of on a turn end.
      this.armSilence();
    }
    this.armForcedDrop();
    if (this.pending.length) {
      session.sendAudio(concatPcm(this.pending));
      this.pending = [];
      this.pendingSamples = 0;
    }
  }

  /**
   * Closes the Live socket on purpose, once, on a call somebody is deliberately making. Resumption
   * cannot be verified any other way: a healthy websocket does not drop, and the party whose
   * behaviour is in question is the server, which in a test is a fake that we wrote.
   *
   * Three things bound it. It is off unless `FORCE_LIVE_DROP` is set; it fires for the single
   * resident id named in that variable, so a setting left behind after a test cannot reach anybody;
   * and it fires once per call, because a drop on every session would spend the three a call is
   * allowed and end it as a gateway fault.
   *
   * It never fires while an emergency is in flight. At that point the model is telling the resident
   * that help is coming, and cutting that off to learn something about reconnects is not a trade
   * this service makes.
   */
  private armForcedDrop(): void {
    const drop = this.deps.config.forcedLiveDrop;
    if (!drop || this.forcedDropArmed || !this.ids || drop.residentId !== this.ids.residentId) return;
    this.forcedDropArmed = true;
    const generation = this.liveGeneration;
    this.deps.log.warn({ ...this.ids, afterSec: drop.afterSec }, 'FORCE_LIVE_DROP is set: this call will have its Gemini Live socket closed on purpose');
    this.timer(drop.afterSec * 1000, () => {
      if (this.state !== 'active' || generation !== this.liveGeneration || this.endReason || this.emergency !== 'none') return;
      this.deps.log.warn({ ...this.ids }, 'closing the Gemini Live socket to test resumption');
      this.live?.drop();
    });
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
        else this.armSilence();
      },
      toolCalls: (calls) => current() && calls.forEach((c) => this.onToolCall(c)),
      resumable: (handle) => {
        if (!current()) return;
        // The first one gets a line of its own. A call that then fails outright never reaches the
        // summary, and whether the server offered anything at all is the first thing worth knowing.
        // Only the length is recorded: a handle is opaque but it is still state about one person.
        if (!this.liveStats.handles) this.deps.log.info({ ...this.ids, handleChars: handle.length }, 'Gemini Live offered a resumption handle');
        this.liveStats.handles++;
        this.resumeHandle = handle;
      },
      notResumable: () => {
        if (current()) this.liveStats.unusableHandles++;
      },
      usage: ({ promptTokens }) => {
        if (!current() || promptTokens <= 0) return;
        if (promptTokens < this.lastPromptTokens) this.liveStats.contextShrinks++;
        this.lastPromptTokens = promptTokens;
        this.liveStats.peakPromptTokens = Math.max(this.liveStats.peakPromptTokens, promptTokens);
      },
      goingAway: (timeLeft) => {
        if (!current()) return;
        this.liveStats.goAways++;
        this.deps.log.warn({ ...this.ids, timeLeft }, 'Gemini Live says it is about to close the session');
      },
      closed: (reason) => {
        if (!current()) return;
        this.deps.log.warn({ ...this.ids, reason }, 'Gemini Live session closed unexpectedly');
        this.live = undefined;
        this.liveFailure = reason;
        if (this.endReason) return void this.finish(this.endReason);
        // Vertex AI refusing the project closes the socket the same way a network blip does, and the
        // reason is the only thing that tells them apart. Reconnecting into the former spends every
        // session the call is allowed proving the same thing over again, in silence, to somebody
        // holding a phone to their ear.
        if (classifyGatewayFailure(reason) === 'systemic') return void this.finish('gateway_error');
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
    this.heardResident = true;
    this.clearSilence();
    this.silencePrompts = 0;
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
    this.clearSilence();
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
    if (this.state !== 'active' || (this.endReason && !REPLACEABLE_END.has(this.endReason))) return;
    this.clearSilence();
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
    this.clearSilence();
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
    // Kept apart from the line above because it is about the transport rather than about the call.
    // One is read when asking what happened to a resident, the other when asking whether resumption
    // and compression do what they were configured to do, which no single call can answer alone.
    this.deps.log.info({ ...ids, sessions: this.liveSessions, ...this.liveStats }, 'Gemini Live session summary');
    await this.reportGateway(reason);

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

  /**
   * Tells the rest of the service whether the conversation half of a call is working, so that the
   * next resident's phone is not rung into a fault this call already found. Only this process ever
   * sees what Vertex AI said, and the reason is what decides whether a retry is worth a ring.
   *
   * A call that says nothing either way — the resident hung up before a session was established —
   * is not reported at all. Guessing in either direction is worse than the silence: read as a
   * failure it stops a working service, read as a success it reopens a broken one.
   *
   * Never allowed to throw. A call that reached an emergency has already raised it by this point,
   * and the breaker is an optimization for tomorrow's calls, not a step in this one.
   */
  private async reportGateway(reason: ConversationEnd): Promise<void> {
    const failed = reason === 'gateway_error' && this.liveFailure !== undefined;
    if (!failed && !this.liveReady) return;
    const now = new Date();
    try {
      await this.deps.store.mutateGatewayBreaker((b) =>
        failed ? recordGatewayFailure(b, this.liveFailure, now) : recordGatewaySuccess(b, now),
      );
    } catch (err) {
      this.deps.log.error({ ...this.ids, err: (err as Error).message }, 'failed to record gateway health');
    }
  }
}
