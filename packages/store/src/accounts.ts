/**
 * Staff accounts belong to organizations: a care company and the people who work for it. Everything
 * staff can see or change (residents, their calls, cases, held messages) belongs to exactly one
 * organization, and a member of staff only ever sees their own organization's.
 *
 * Firebase Auth proves who someone is; a `Membership` is what makes them staff, and of which
 * organization, in which role. It is read on every request, so a change takes effect at once.
 */

import type { Store } from './types.js';

export type OrgRole = 'owner' | 'admin' | 'member';

/** Owners are made by promotion, never by invitation, so a mistyped address cannot take over an organization. */
export type InvitableRole = Exclude<OrgRole, 'owner'>;

/** Nothing is charged yet: `trial` is every self-serve organization, `internal` our own and migrated ones. */
export type Plan = 'trial' | 'internal';

export interface OrgLimits {
  residents: number;
  /** Active members plus pending invitations. */
  members: number;
}

/** Groundwork for billing. Limits are enforced now, so a self-serve trial cannot run up costs for everyone. */
export interface OrgBilling {
  plan: Plan;
  /** Where invoices will go once there are any. */
  email: string;
  limits: OrgLimits;
  /** The payment provider's customer, once one exists. */
  customerId?: string;
}

export interface Organization {
  id: string;
  name: string;
  /** IANA time zone used for new residents and for dates shown to staff. */
  timeZone: string;
  /** A suspended organization's staff cannot sign in to it; its residents' calls are not affected. */
  status: 'active' | 'suspended';
  /** Set by a Hachi operator who has checked who runs the organization; see `mayContactPeople`. */
  verifiedAt?: string;
  /** The operator's account, or 'migration' for organizations that existed before self-serve. */
  verifiedBy?: string;
  billing: OrgBilling;
  createdAt: string;
  /** uid of the account that created it, or 'migration'. */
  createdBy: string;
  updatedAt: string;
}

/**
 * Whether Hachi may reach people on the organization's behalf: ring its residents, send its alerts
 * and show its residents to family. Anyone can create an organization and type in any number or
 * address, so until an operator has checked who runs it, nothing it enters reaches a stranger.
 * Everything else (residents, the team, settings) works as usual in the meantime.
 */
export function mayContactPeople(org: Organization | null | undefined): boolean {
  return !!org?.verifiedAt;
}

/** For services holding a resident or message: one with no organization yet is not reached either. */
export async function orgMayContactPeople(store: Pick<Store, 'getOrganization'>, orgId: string | undefined): Promise<boolean> {
  return !!orgId && mayContactPeople(await store.getOrganization(orgId));
}

export interface Membership {
  orgId: string;
  uid: string;
  /** Normalized; copied from the verified account so the team list needs no Auth lookups. */
  email: string;
  name?: string;
  /**
   * Where alerts reach them as the staff member in charge of a resident. Kept on every membership
   * of the account, like the name. Nobody can be put in charge until they have a phone number.
   */
  phone?: string;
  sms?: string;
  role: OrgRole;
  /** A disabled member keeps their place in the history but cannot act for the organization. */
  status: 'active' | 'disabled';
  joinedAt: string;
  updatedAt: string;
  /** ID tokens from sign-ins before this time are refused ("sign out everywhere"). */
  sessionsValidAfter?: string;
}

/** Who did something, as it was when they did it. */
export interface StaffRef {
  uid: string;
  email?: string;
  name?: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

/**
 * Bound to an email address rather than a secret link: it can only be accepted by an account that
 * has proved it holds that address, so a forwarded or leaked link gives nobody access.
 */
export interface Invitation {
  id: string;
  orgId: string;
  /** Shown to the invitee, who cannot read the organization itself yet. */
  orgName: string;
  /** Normalized. */
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  invitedBy: StaffRef;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  /** uid of whoever accepted, declined or revoked it. */
  decidedBy?: string;
}

export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'organization.verified'
  | 'organization.unverified'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.disabled'
  | 'member.enabled'
  | 'member.removed'
  | 'member.left'
  | 'member.sessions_revoked'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.declined'
  | 'resident.created'
  | 'resident.updated'
  | 'resident.owner_changed'
  | 'resident.family_access_granted'
  | 'resident.family_access_revoked'
  | 'resident.contact_request_decided'
  | 'case.updated';

export type AuditTargetType = 'organization' | 'member' | 'invitation' | 'resident' | 'case';

/** Append-only. Read by the organization's admins; never shown to family. */
export interface AuditEntry {
  /** From `auditId`: sorts by time, and stays unique when two things happen in the same millisecond. */
  id: string;
  orgId: string;
  at: string;
  actor: StaffRef;
  action: AuditAction;
  target?: { type: AuditTargetType; id: string; label?: string };
  detail?: Record<string, string | number | boolean | null>;
}

export function auditId(at: string, unique: string): string {
  return `${at}_${unique}`;
}

/** Members in the order they joined, so lists are stable whichever store they come from. */
export function byJoined(a: Membership, b: Membership): number {
  return a.joinedAt.localeCompare(b.joinedAt) || a.uid.localeCompare(b.uid);
}

/** One document per person per organization. Organization ids are generated without underscores. */
export function membershipId(orgId: string, uid: string): string {
  return `${orgId}_${uid}`;
}
