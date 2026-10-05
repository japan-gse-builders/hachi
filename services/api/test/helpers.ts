import { domainStates, type CallTag, type Case, type Detection } from '@hachi/core';
import { buildApp } from '../src/app.js';
import type { TokenVerifier, VerifiedToken } from '../src/auth.js';
import { MemoryStore, type CallRecord, type CallWellbeing, type Resident, type StoredCase } from '@hachi/store';
import { buildResident } from '../src/residents.js';
import type { ResidentInput } from '../src/schemas.js';
import { residentInputSchema } from '../src/schemas.js';
import type { MediaSigner } from '../src/views.js';

export const NOW = new Date('2026-10-01T03:00:00.000Z'); // 12:00 JST

export const TOKENS: Record<string, VerifiedToken> = {
  staff: { uid: 'staff-1', role: 'staff', email: 'staff@example.org', emailVerified: true },
  familyPhone: { uid: 'fam-1', phoneNumber: '+819000000002' },
  familyEmail: { uid: 'fam-2', email: 'Alice@Example.org', emailVerified: true },
  unverifiedEmail: { uid: 'x-1', email: 'alice@example.org', emailVerified: false },
  stranger: { uid: 'x-2', phoneNumber: '+819099999999' },
};

export class FakeVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<VerifiedToken> {
    const t = TOKENS[idToken];
    if (!t) throw new Error('bad token');
    return t;
  }
}

export const fakeSigner: MediaSigner = {
  sign: async (uri) => `https://signed.example/${encodeURIComponent(uri)}`,
};

export function residentInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Margaret Smith',
    preferredName: 'Maggie',
    phone: '+819000000001',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: ['diabetes'] },
    staff: { name: 'Tanaka', phone: '+81300000000', email: 'staff@example.org' },
    family: { name: 'Alice', relationship: 'daughter', sms: '+81 90-0000-0002', email: 'alice@example.org' },
    ...overrides,
  };
}

export function makeResident(id: string, overrides: Record<string, unknown> = {}): Resident {
  return buildResident(residentInputSchema.parse(residentInput(overrides)) as ResidentInput, id, NOW);
}

export function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    residentId: 'res-1',
    rule: 'R2',
    urgency: 'watch',
    confidence: 0.8,
    summary: 'Barely ate yesterday',
    evidence: [{ callId: 'call-1', quote: 'I only had a biscuit', startMs: 1000, endMs: 2000 }],
    detectedAt: '2026-10-01T01:05:00.000Z',
    ...overrides,
  };
}

export function storedCase(overrides: Partial<StoredCase> = {}): StoredCase {
  const base: Case = {
    id: 'case-1',
    residentId: 'res-1',
    rule: 'R2',
    autoUrgency: 'watch',
    status: 'open',
    detections: [detection()],
    firstDetectedAt: '2026-10-01T01:05:00.000Z',
    updatedAt: '2026-10-01T01:05:00.000Z',
    notifications: [],
  };
  return { ...base, ...overrides };
}

export function call(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: 'call-1',
    residentId: 'res-1',
    source: 'live',
    status: 'completed',
    channel: 'pstn',
    startedAt: '2026-10-01T01:00:00.000Z',
    endedAt: '2026-10-01T01:04:00.000Z',
    durationSec: 240,
    audioUri: 'gs://hachi-audio/res-1/call-1.wav',
    transcript: [
      { speaker: 'agent', text: 'Hello Maggie, this is Hachi, an AI assistant.', startMs: 0, endMs: 3000 },
      { speaker: 'resident', text: 'I only had a biscuit', startMs: 3500, endMs: 5000 },
    ],
    summary: { health: 'Feeling tired', meals: 'Only a biscuit yesterday', topics: ['grandson'] },
    familySummary: { health: 'A little tired', meals: 'Ate very little yesterday', topics: ['grandson'] },
    analysisPending: false,
    createdAt: '2026-10-01T01:05:00.000Z',
    ...overrides,
  };
}

export function wellbeing(tags: CallTag[], headline?: string): CallWellbeing {
  return { tags, domains: domainStates(tags.map((t) => t.id)), ...(headline ? { headline } : {}) };
}

/** Tags said in the resident turn of `call()`. */
export function said(...ids: CallTag['id'][]): CallTag[] {
  return ids.map((id) => ({ id, turn: 1, basis: 'said', confidence: 0.9 }));
}

export function idGen(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export function setup() {
  const store = new MemoryStore();
  const app = buildApp({ store, verifier: new FakeVerifier(), signer: fakeSigner, now: () => NOW, newId: idGen() });
  const as = (token: keyof typeof TOKENS | null) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { store, app, as };
}
