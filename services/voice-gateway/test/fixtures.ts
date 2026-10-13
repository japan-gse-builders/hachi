import { MemoryStore, type CallRecord, type Resident } from '@hachi/store';
import { EmergencyPresence, type EmergencyInput, type EmergencyRaiser } from '../src/emergency.js';
import type { LiveConnector, LiveHandlers, LiveSession, LiveSetup, ToolCall, ToolScheduling } from '../src/live.js';
import { CallSession, type Logger, type RecordingSink, type SessionDeps, type TwilioSocket } from '../src/session.js';

export const IDS = { residentId: 'res-1', callId: '2026-10-02-0' };

export function resident(overrides: Partial<Resident> = {}): Resident {
  return {
    id: IDS.residentId,
    name: 'Margaret Smith',
    preferredName: 'Maggie',
    phone: '+819000000001',
    channel: 'pstn',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    staff: { name: 'Tanaka', phone: '+81300000000', email: 'staff@example.org' },
    family: { name: 'Alice', sms: '+819000000002', email: 'alice@example.org' },
    familyLookup: [],
    serviceStartedAt: '2026-09-01T00:00:00.000Z',
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function callDoc(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: IDS.callId,
    residentId: IDS.residentId,
    source: 'live',
    status: 'in_progress',
    channel: 'pstn',
    startedAt: '2026-10-02T01:00:00.000Z',
    analysisPending: false,
    createdAt: '2026-10-02T01:00:00.000Z',
    attempt: 0,
    localDate: '2026-10-02',
    providerCallId: 'CA1',
    streamToken: 'stream-secret',
    ...overrides,
  };
}

export class FakeLiveSession implements LiveSession {
  readonly audio: Int16Array[] = [];
  readonly texts: string[] = [];
  readonly tools: { call: ToolCall; response: Record<string, unknown>; scheduling: ToolScheduling }[] = [];
  closed = false;
  dropped = false;

  constructor(
    readonly setup: LiveSetup,
    readonly h: LiveHandlers,
  ) {}

  sendAudio(pcm: Int16Array): void {
    this.audio.push(pcm);
  }
  sendText(text: string): void {
    this.texts.push(text);
  }
  respondToTool(call: ToolCall, response: Record<string, unknown>, scheduling: ToolScheduling): void {
    this.tools.push({ call, response, scheduling });
  }
  close(): void {
    this.closed = true;
  }
  /** The socket going down under us: `closed` fires, which is the whole difference from `close()`. */
  drop(): void {
    this.dropped = true;
    this.h.closed('closed: 1000');
  }
}

export class FakeLive implements LiveConnector {
  readonly sessions: FakeLiveSession[] = [];
  failures = 0;
  /** What `connect` rejects with. Transient by default; the classifier reads this wording. */
  failWith = 'Live API unavailable';
  /** The server refusing a resumption handle, which is the case the fallback exists for. */
  rejectHandles = false;

  async connect(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveSession> {
    if (this.rejectHandles && setup.resumeHandle) throw new Error('resumption handle expired');
    if (this.failures > 0) {
      this.failures--;
      throw new Error(this.failWith);
    }
    const s = new FakeLiveSession(setup, handlers);
    this.sessions.push(s);
    return s;
  }

  get last(): FakeLiveSession {
    return this.sessions[this.sessions.length - 1]!;
  }
}

export class FakeEmergency implements EmergencyRaiser {
  readonly raised: EmergencyInput[] = [];
  failures = 0;

  async raise(input: EmergencyInput): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('firestore unavailable');
    }
    this.raised.push(input);
  }
}

export class FakeRecordings implements RecordingSink {
  readonly saved: { path: string; bytes: number }[] = [];
  fail = false;

  async save(path: string, wav: Buffer): Promise<string> {
    if (this.fail) throw new Error('gcs down');
    this.saved.push({ path, bytes: wav.length });
    return `gs://bucket/${path}`;
  }
}

export class FakeSocket implements TwilioSocket {
  readonly sent: any[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  ofType(event: string): any[] {
    return this.sent.filter((m) => m.event === event);
  }
}

export interface LoggedLine {
  level: 'info' | 'warn' | 'error';
  obj: Record<string, unknown>;
  msg?: string;
}

/** Kept rather than discarded, because what the logs say is now part of what the gateway does. */
export function recordingLog(): { lines: LoggedLine[]; log: Logger } {
  const lines: LoggedLine[] = [];
  const at = (level: LoggedLine['level']) => (obj: object, msg?: string) => {
    lines.push({ level, obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
  };
  return { lines, log: { info: at('info'), warn: at('warn'), error: at('error') } };
}

export async function setup(
  opts: {
    call?: Partial<CallRecord>;
    maxConversationSec?: number;
    silence?: Partial<SessionDeps['config']['silence']>;
    timing?: SessionDeps['timing'];
    forcedLiveDrop?: SessionDeps['config']['forcedLiveDrop'];
  } = {},
) {
  const store = new MemoryStore();
  await store.createResident(resident());
  await store.createCallIfAbsent(callDoc(opts.call));
  const live = new FakeLive();
  const emergency = new FakeEmergency();
  const emergencies = new EmergencyPresence();
  const recordings = new FakeRecordings();
  const socket = new FakeSocket();
  const logged = recordingLog();
  const deps: SessionDeps = {
    store,
    live,
    emergency,
    emergencies,
    recordings,
    log: logged.log,
    // Far longer than any test takes, so only the tests that ask for it see the silence timer.
    config: {
      maxConversationSec: opts.maxConversationSec ?? 480,
      silence: { promptSec: 30, prompts: 2, ...opts.silence },
      ...(opts.forcedLiveDrop ? { forcedLiveDrop: opts.forcedLiveDrop } : {}),
    },
    timing: { endFallbackMs: 150, emergencyFallbackMs: 150, liveRetryDelayMs: 1, emergencyRetryDelayMs: 1, ...opts.timing },
  };
  const session = new CallSession(deps, socket);
  return { store, live, emergency, emergencies, recordings, socket, session, deps, logged: logged.lines };
}

export function startMessage(params: Record<string, string> = {}, callSid = 'CA1') {
  return JSON.stringify({
    event: 'start',
    streamSid: 'MZ1',
    start: { streamSid: 'MZ1', callSid, customParameters: { ...IDS, streamToken: 'stream-secret', ...params } },
  });
}

/** 20 ms of μ-law audio (silence by default). */
export function mediaMessage(byte = 0xff, track = 'inbound') {
  return JSON.stringify({ event: 'media', streamSid: 'MZ1', media: { track, payload: Buffer.alloc(160, byte).toString('base64') } });
}

export const markMessage = (name: string) => JSON.stringify({ event: 'mark', streamSid: 'MZ1', mark: { name } });

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
