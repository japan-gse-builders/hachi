import type { OutboxEntry, Resident } from '@hachi/store';

/**
 * A message held for someone to agree to, as whoever decides needs to see it: who the resident
 * asked for, the number it would go to, and the words that would be sent. Nothing about the
 * resident's health is in it, because nothing about their health is in the message.
 */
export interface HeldContactRequest {
  id: string;
  residentId: string;
  residentName: string;
  /** The person the resident named, in their own words. */
  requestedFor: string;
  /** Spaced so it can be read back aloud against what the resident said. */
  number: string;
  body: string;
  requestedAt: string;
}

/** Japanese numbers are read in three groups, so the groups are where the eye expects them. */
export function groupNumber(e164: string): string {
  const jp = /^\+81(\d0)(\d{4})(\d{4})$/.exec(e164);
  if (jp) return `+81 ${jp[1]} ${jp[2]} ${jp[3]}`;
  return e164.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function buildHeldRequests(entries: OutboxEntry[], residents: Map<string, Resident>): HeldContactRequest[] {
  return entries
    .filter((e) => e.kind === 'contact_request' && residents.has(e.residentId))
    .map((e) => ({
      id: e.id,
      residentId: e.residentId,
      residentName: residents.get(e.residentId)!.name,
      requestedFor: e.requestedFor ?? 'Someone they named',
      number: groupNumber(e.address),
      body: e.body,
      requestedAt: e.createdAt,
    }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
