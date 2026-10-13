import { domainStates, PRIVACY_NOTICE, type CallTag, type Case, type Detection, type SpendSettings } from '@hachi/core';
import { buildApp, ORG_HEADER, type AppDeps } from '../src/app.js';
import type { AuthAdmin, TokenVerifier, VerifiedToken } from '../src/auth.js';
import {
  MemoryStore,
  type CallRecord,
  type CallWellbeing,
  type Membership,
  type Organization,
  type OrgRole,
  type Resident,
  type StoredCase,
} from '@hachi/store';
import { buildResident } from '../src/residents.js';
import type { ResidentInput } from '../src/schemas.js';
import { residentInputSchema } from '../src/schemas.js';
import type { MediaSigner } from '../src/views.js';

export const NOW = new Date('2026-10-01T03:00:00.000Z'); // 12:00 JST

/** When every test token's holder signed in, in seconds as Firebase reports it: an hour before NOW. */
export const SIGNED_IN = NOW.getTime() / 1000 - 3600;

export const TOKENS: Record<string, VerifiedToken> = {
  /** Owner of org-1. */
  staff: { uid: 'staff-1', email: 'staff@example.org', emailVerified: true, authTime: SIGNED_IN },
  /** The same person, signed in again at NOW. */
  staffSignedInAgain: { uid: 'staff-1', email: 'staff@example.org', emailVerified: true, authTime: NOW.getTime() / 1000 },
  /** Member of org-1. */
  otherStaff: { uid: 'staff-2', email: 'sato@example.org', emailVerified: true, name: 'Sato', authTime: SIGNED_IN },
  /** Admin of org-1. */
  admin: { uid: 'staff-3', email: 'ito@example.org', emailVerified: true, name: 'Ito', authTime: SIGNED_IN },
  /** Owner of org-2, a different care company. */
  outsider: { uid: 'staff-9', email: 'boss@elsewhere.org', emailVerified: true, name: 'Kimura', authTime: SIGNED_IN },
  /** Signed up, belongs nowhere yet. */
  newcomer: { uid: 'new-1', email: 'kato@example.org', emailVerified: true, name: 'Kato', authTime: SIGNED_IN },
  unverifiedNewcomer: { uid: 'new-2', email: 'mori@example.org', emailVerified: false, authTime: SIGNED_IN },
  relative: { uid: 'fam-3', email: 'bob@example.org', emailVerified: true },
  unverifiedRelative: { uid: 'fam-4', email: 'bob@example.org', emailVerified: false },
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
  return buildResident(residentInputSchema.parse(residentInput({
    callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version },
    ...overrides,
  })) as ResidentInput, id, 'org-1', NOW, { uid: 'staff-1', email: 'staff@example.org' });
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
  const base: Case & { orgId: string } = {
    id: 'case-1',
    orgId: 'org-1',
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

const JOINED = '2026-09-01T00:00:00.000Z';

export function organization(id: string, overrides: Partial<Organization> = {}): Organization {
  return {
    id,
    name: id === 'org-1' ? 'Sakura Care' : 'Elsewhere Care',
    timeZone: 'Asia/Tokyo',
    status: 'active',
    verifiedAt: JOINED,
    verifiedBy: 'migration',
    billing: { plan: 'internal', email: 'billing@example.org', limits: { residents: 50, members: 10 } },
    createdAt: JOINED,
    createdBy: 'migration',
    updatedAt: JOINED,
    ...overrides,
  };
}

export function membership(orgId: string, token: keyof typeof TOKENS, role: OrgRole, overrides: Partial<Membership> = {}): Membership {
  const t = TOKENS[token]!;
  return {
    orgId,
    uid: t.uid,
    email: t.email!.toLowerCase(),
    ...(t.name ? { name: t.name } : {}),
    role,
    status: 'active',
    joinedAt: JOINED,
    updatedAt: JOINED,
    ...overrides,
  };
}

/** org-1: staff (owner), admin, otherStaff (member). org-2: outsider (owner). */
export function seedAccounts(store: MemoryStore): void {
  store.seedAccounts({
    organizations: [organization('org-1'), organization('org-2')],
    memberships: [
      membership('org-1', 'staff', 'owner'),
      membership('org-1', 'admin', 'admin'),
      membership('org-1', 'otherStaff', 'member'),
      membership('org-2', 'outsider', 'owner'),
    ],
  });
}

export interface FakeAuthAdmin extends AuthAdmin {
  names: Map<string, string>;
  revoked: string[];
  validAfter: Map<string, number>;
}

export function fakeAuthAdmin(): FakeAuthAdmin {
  const names = new Map<string, string>();
  const revoked: string[] = [];
  const validAfter = new Map<string, number>();
  return {
    names,
    revoked,
    validAfter,
    setDisplayName: async (uid, name) => void names.set(uid, name),
    revokeSessions: async (uid) => {
      revoked.push(uid);
      validAfter.set(uid, Math.floor(NOW.getTime() / 1000) * 1000);
    },
    sessionsValidAfter: async (uid) => validAfter.get(uid),
  };
}

export function setup(opts: { spend?: SpendSettings; gateway?: AppDeps['gateway']; calls?: AppDeps['calls']; now?: () => Date } = {}) {
  const store = new MemoryStore();
  seedAccounts(store);
  const authAdmin = fakeAuthAdmin();
  const app = buildApp({ store, verifier: new FakeVerifier(), signer: fakeSigner, authAdmin, now: () => NOW, newId: idGen(), ...opts });
  const as = (token: keyof typeof TOKENS | null, org?: string) => ({
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(org ? { [ORG_HEADER]: org } : {}) },
  });
  return { store, app, as, authAdmin };
}
