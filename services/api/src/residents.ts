import { extractSpeechSample, hasCallConsent } from '@hachi/core';
import { normalizeEmail, normalizePhone } from './auth.js';
import type { CallRecord, FamilyAccess, FamilyContact, Resident, ResidentOwner } from '@hachi/store';
import type { CallImport, ResidentInput, ResidentPatch } from './schemas.js';

type FamilyInput = NonNullable<ResidentInput['family']>;

/** The signed-in staff account making a change. */
export interface StaffActor {
  uid: string;
  email?: string;
  name?: string;
}

/** Enough for a family; each one is a person who can read about the resident's days. */
export const FAMILY_ACCESS_MAX = 5;

function contactLookup(f: FamilyInput | undefined): string[] {
  if (!f) return [];
  return [f.sms && normalizePhone(f.sms), f.email && normalizeEmail(f.email)].filter((v): v is string => Boolean(v));
}

/** The one place `familyLookup` is computed, so access granted and access revoked cannot drift apart. */
function lookupOf(family: FamilyInput | undefined, access: FamilyAccess[] | undefined): string[] {
  return [...new Set([...contactLookup(family), ...(access ?? []).map((a) => a.email)])];
}

function ownerOf(staff: StaffActor, at: string): ResidentOwner {
  return { uid: staff.uid, ...(staff.email ? { email: staff.email } : {}), ...(staff.name ? { name: staff.name } : {}), since: at };
}

export function isOwner(r: Resident, uid: string): boolean {
  return r.owner?.uid === uid;
}

/** The named family contact, who gets the alerts, as opposed to someone only allowed to view. */
export function isFamilyContact(r: Resident, contacts: string[]): boolean {
  return contactLookup(r.family).some((c) => contacts.includes(c));
}

function toFamily(f: FamilyInput, previous?: FamilyContact): FamilyContact {
  const sameContacts = previous && contactLookup(previous).join() === contactLookup(f).join();
  return {
    ...f,
    // The SMS number doubles as the number for automated voice alerts in emergencies.
    voice: f.sms,
    pushTokens: sameContacts ? (previous.pushTokens ?? []) : [],
  };
}

/** Whoever registers a resident is responsible for them until they hand them over. */
export function buildResident(input: ResidentInput, id: string, now: Date, staff: StaffActor): Resident {
  const at = now.toISOString();
  const { family, serviceStartedAt, callConsent, ...rest } = input;
  return {
    ...rest,
    id,
    staff: { ...input.staff, voice: input.staff.phone },
    ...(family ? { family: toFamily(family) } : {}),
    ...(callConsent ? {
      callConsent: { ...callConsent, recordedAt: at, recordedBy: staff.uid },
      consent: { shareMood: true, recordedAt: at, recordedBy: staff.uid },
    } : {}),
    owner: ownerOf(staff, at),
    familyAccess: [],
    familyLookup: lookupOf(family, []),
    serviceStartedAt: serviceStartedAt ?? at,
    ...(!callConsent && !serviceStartedAt ? { serviceStartPending: true } : {}),
    active: true,
    createdAt: at,
    updatedAt: at,
  };
}

export function patchResident(r: Resident, patch: ResidentPatch, now: Date, staffUid = 'unknown'): Resident {
  const { family, staff, shareMood, callConsent, ...rest } = patch;
  const next: Resident = { ...r, ...rest, updatedAt: now.toISOString() };
  if (staff) next.staff = { ...staff, voice: staff.phone };
  // Who heard it and when is the point of recording consent at all, so it is written here, not sent.
  if (shareMood !== undefined) next.consent = { shareMood, recordedAt: now.toISOString(), recordedBy: staffUid };
  // Preserve the first approval, even when an old form is resubmitted or the notice has changed.
  if (callConsent && !hasCallConsent(r.callConsent)) {
    next.callConsent = { ...callConsent, recordedAt: now.toISOString(), recordedBy: staffUid };
    // The current first-use explanation includes family mood/loneliness updates. Keep any
    // previously recorded choice, including an opt-out, and any explicit sharing change.
    if (shareMood === undefined && !r.consent) {
      next.consent = { shareMood: true, recordedAt: now.toISOString(), recordedBy: staffUid };
    }
    // A delayed enrollment must still get its full baseline and first screening rotation.
    // Legacy residents and explicitly backdated imports retain their existing service start.
    if (r.serviceStartPending) {
      next.serviceStartedAt = now.toISOString();
      delete next.serviceStartPending;
    }
  }
  if (family === null) {
    delete next.family;
  } else if (family) {
    next.family = toFamily(family, r.family);
  }
  next.familyLookup = lookupOf(next.family, next.familyAccess);
  return next;
}

export function claimResident(r: Resident, staff: StaffActor, now: Date): Resident {
  return { ...r, owner: ownerOf(staff, now.toISOString()), updatedAt: now.toISOString() };
}

export function releaseResident(r: Resident, now: Date): Resident {
  const { owner: _owner, ...rest } = r;
  return { ...rest, updatedAt: now.toISOString() };
}

export type GrantOutcome = 'added' | 'already_has_access' | 'family_contact' | 'full';

/** `email` must already be normalized. Granting twice is not an error: the access is there. */
export function grantFamilyAccess(r: Resident, email: string, staffUid: string, now: Date): { resident: Resident; outcome: GrantOutcome } {
  const access = r.familyAccess ?? [];
  if (access.some((a) => a.email === email)) return { resident: r, outcome: 'already_has_access' };
  if (contactLookup(r.family).includes(email)) return { resident: r, outcome: 'family_contact' };
  if (access.length >= FAMILY_ACCESS_MAX) return { resident: r, outcome: 'full' };
  const at = now.toISOString();
  const familyAccess = [...access, { email, addedAt: at, addedBy: staffUid }];
  return { resident: { ...r, familyAccess, familyLookup: lookupOf(r.family, familyAccess), updatedAt: at }, outcome: 'added' };
}

export type RevokeOutcome = 'removed' | 'not_found' | 'family_contact';

/** The family contact's own access goes with the contact, so it is changed there rather than here. */
export function revokeFamilyAccess(r: Resident, email: string, now: Date): { resident: Resident; outcome: RevokeOutcome } {
  const access = r.familyAccess ?? [];
  if (!access.some((a) => a.email === email)) {
    return { resident: r, outcome: contactLookup(r.family).includes(email) ? 'family_contact' : 'not_found' };
  }
  const familyAccess = access.filter((a) => a.email !== email);
  return { resident: { ...r, familyAccess, familyLookup: lookupOf(r.family, familyAccess), updatedAt: now.toISOString() }, outcome: 'removed' };
}

export function addPushToken(r: Resident, token: string, max = 10): Resident {
  if (!r.family) return r;
  const tokens = [...(r.family.pushTokens ?? []).filter((t) => t !== token), token].slice(-max);
  return { ...r, family: { ...r.family, pushTokens: tokens } };
}

/** USR-04: imported calls feed the baseline (SPK-02) and, after analysis, conversation memory (CNV-07). */
export function buildImportedCalls(r: Resident, input: CallImport, newId: () => string, now: Date): CallRecord[] {
  return input.calls.map((c) => {
    const id = newId();
    return {
      id,
      residentId: r.id,
      source: 'imported',
      status: 'completed',
      channel: r.channel,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSec: Math.round((Date.parse(c.endedAt) - Date.parse(c.startedAt)) / 1000),
      transcript: c.transcript,
      speech: extractSpeechSample(id, c.startedAt, c.transcript, null),
      analysisPending: true,
      createdAt: now.toISOString(),
    };
  });
}
