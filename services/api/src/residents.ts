import { extractSpeechSample } from '@hachi/core';
import { normalizeEmail, normalizePhone } from './auth.js';
import type { CallRecord, FamilyContact, Resident } from '@hachi/store';
import type { CallImport, ResidentInput, ResidentPatch } from './schemas.js';

type FamilyInput = NonNullable<ResidentInput['family']>;

function familyLookup(f: FamilyInput | undefined): string[] {
  if (!f) return [];
  return [f.sms && normalizePhone(f.sms), f.email && normalizeEmail(f.email)].filter((v): v is string => Boolean(v));
}

function toFamily(f: FamilyInput, previous?: FamilyContact): FamilyContact {
  const sameContacts = previous && familyLookup(previous).join() === familyLookup(f).join();
  return {
    ...f,
    // The SMS number doubles as the number for automated voice alerts in emergencies.
    voice: f.sms,
    pushTokens: sameContacts ? (previous.pushTokens ?? []) : [],
  };
}

export function buildResident(input: ResidentInput, id: string, now: Date): Resident {
  const at = now.toISOString();
  const { family, serviceStartedAt, ...rest } = input;
  return {
    ...rest,
    id,
    staff: { ...input.staff, voice: input.staff.phone },
    ...(family ? { family: toFamily(family) } : {}),
    familyLookup: familyLookup(family),
    serviceStartedAt: serviceStartedAt ?? at,
    active: true,
    createdAt: at,
    updatedAt: at,
  };
}

export function patchResident(r: Resident, patch: ResidentPatch, now: Date): Resident {
  const { family, staff, ...rest } = patch;
  const next: Resident = { ...r, ...rest, updatedAt: now.toISOString() };
  if (staff) next.staff = { ...staff, voice: staff.phone };
  if (family === null) {
    delete next.family;
    next.familyLookup = [];
  } else if (family) {
    next.family = toFamily(family, r.family);
    next.familyLookup = familyLookup(family);
  }
  return next;
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
