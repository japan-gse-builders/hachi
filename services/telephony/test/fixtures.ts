import { MemoryStore, type Resident } from '@hachi/store';
import type { CallDeps } from '../src/calls.js';
import type { EnqueueRequest, TaskCallerVerifier, TaskQueue } from '@hachi/cloud';
import { TelephonyError, type PlaceCallRequest, type TelephonyProvider } from '../src/twilio.js';

/** 10:00:30 JST on 2026-10-02 */
export const NOW = new Date('2026-10-02T01:00:30.000Z');
export const AUTH_TOKEN = 'test-auth-token';
export const BASE_URL = 'https://telephony.example.run.app';

export function resident(id: string, overrides: Partial<Resident> = {}): Resident {
  return {
    id,
    name: 'Margaret Smith',
    preferredName: 'Maggie',
    phone: '+819000000001',
    channel: 'pstn',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    staff: { name: 'Tanaka', phone: '+81300000000', email: 'staff@example.org' },
    familyLookup: [],
    serviceStartedAt: '2026-09-01T00:00:00.000Z',
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export class FakeQueue implements TaskQueue {
  readonly tasks: EnqueueRequest[] = [];
  failFor = new Set<string>();

  async enqueue(req: EnqueueRequest): Promise<'created' | 'exists'> {
    if ([...this.failFor].some((id) => req.name.includes(id))) throw new Error('tasks unavailable');
    if (this.tasks.some((t) => t.name === req.name)) return 'exists';
    this.tasks.push(req);
    return 'created';
  }
}

export class FakeTelephony implements TelephonyProvider {
  readonly calls: PlaceCallRequest[] = [];
  next: (() => Promise<{ providerCallId: string }>) | null = null;

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    this.calls.push(req);
    if (this.next) return this.next();
    return { providerCallId: `CA${String(this.calls.length).padStart(32, '0')}` };
  }

  failWith(err: Error): void {
    this.next = async () => Promise.reject(err);
  }
}

export const retryable = () => new TelephonyError('Twilio 503: Service Unavailable', true);
export const unverified = () => new TelephonyError('Twilio 400: The number is unverified', false, '21219');

export class FakeVerifier implements TaskCallerVerifier {
  async verify(authorization: string | undefined): Promise<void> {
    if (authorization !== 'Bearer good') throw new Error('nope');
  }
}

export function makeDeps(overrides: { now?: () => Date; voiceStreamUrl?: string } = {}) {
  const store = new MemoryStore();
  const queue = new FakeQueue();
  const telephony = new FakeTelephony();
  let tokens = 0;
  const clock = { now: NOW };
  const deps: CallDeps = {
    store,
    queue,
    telephony,
    config: {
      publicBaseUrl: BASE_URL,
      ...(overrides.voiceStreamUrl ? { voiceStreamUrl: overrides.voiceStreamUrl } : {}),
      sayVoice: 'Google.en-US-Neural2-F',
      ringTimeoutSec: 30,
      maxCallSec: 480,
      maxAttempts: 3,
      retryDelaySec: 180,
      dispatchLookbackMin: 10,
      twilio: { voiceFrom: '+15005550006' },
    },
    now: overrides.now ?? (() => clock.now),
    newToken: () => `token-${++tokens}`,
  };
  return { deps, store, queue, telephony, clock };
}
