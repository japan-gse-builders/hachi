import {
  auditId,
  type AuditAction,
  type AuditEntry,
  type AuditTargetType,
  type Invitation,
  type InvitableRole,
  type Membership,
  type OrgLimits,
  type OrgRole,
  type Organization,
  type Roster,
  type StaffRef,
} from '@hachi/store';
import type { Identity, StaffPrincipal } from './auth.js';
import { HttpError } from './errors.js';

const RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export function atLeast(role: OrgRole, min: OrgRole): boolean {
  return RANK[role] >= RANK[min];
}

export function requireRole(staff: StaffPrincipal, min: OrgRole): void {
  if (!atLeast(staff.role, min)) {
    throw new HttpError(403, min === 'owner' ? 'Only an owner of this organization can do this.' : 'Only an admin of this organization can do this.', 'forbidden_role');
  }
}

export const INVITATION_TTL_MS = 14 * 86_400_000;
/** Enough for anyone who runs more than one care business; stops one account filling the database with trials. */
export const MAX_OWNED_ORGANIZATIONS = 3;
export const TRIAL_LIMITS: OrgLimits = { residents: 20, members: 10 };

export function staffRef(staff: { uid: string; email?: string; name?: string }): StaffRef {
  return { uid: staff.uid, ...(staff.email ? { email: staff.email } : {}), ...(staff.name ? { name: staff.name } : {}) };
}

/** The self-serve path: whoever creates an organization owns it, on the trial plan. */
export function buildOrganization(
  input: { name: string; timeZone: string },
  id: string,
  creator: Identity & { email: string },
  now: Date,
): { org: Organization; owner: Membership } {
  const at = now.toISOString();
  const org: Organization = {
    id,
    name: input.name,
    timeZone: input.timeZone,
    status: 'active',
    billing: { plan: 'trial', email: creator.email, limits: { ...TRIAL_LIMITS } },
    createdAt: at,
    createdBy: creator.uid,
    updatedAt: at,
  };
  const owner: Membership = {
    orgId: id,
    uid: creator.uid,
    email: creator.email,
    ...(creator.name ? { name: creator.name } : {}),
    role: 'owner',
    status: 'active',
    joinedAt: at,
    updatedAt: at,
  };
  return { org, owner };
}

export function activeOwners(all: Membership[]): Membership[] {
  return all.filter((m) => m.role === 'owner' && m.status === 'active');
}

/** Without an active owner nobody could ever manage the organization again. */
function assertKeepsAnOwner(target: Membership, next: Membership | null, all: Membership[]): void {
  const wasOwner = target.role === 'owner' && target.status === 'active';
  const staysOwner = next?.role === 'owner' && next.status === 'active';
  if (wasOwner && !staysOwner && activeOwners(all).filter((m) => m.uid !== target.uid).length === 0) {
    throw new HttpError(409, 'An organization needs at least one active owner. Make someone else an owner first.', 'last_owner');
  }
}

/** Owners are managed only by owners, so an admin can neither demote one nor make themselves one. */
function assertMayManage(actor: StaffPrincipal, target: Membership, nextRole?: OrgRole): void {
  requireRole(actor, 'admin');
  if ((target.role === 'owner' || nextRole === 'owner') && actor.role !== 'owner') {
    throw new HttpError(403, 'Only an owner can change another owner, or make someone an owner.', 'owner_only');
  }
}

/** Active members plus pending invitations: a disabled member frees their seat. */
export function seatsUsed({ members, pending }: Roster): number {
  return members.filter((m) => m.status === 'active').length + pending.length;
}

function assertSeatFree(roster: Roster, limits: OrgLimits, action: string): void {
  if (seatsUsed(roster) >= limits.members) {
    throw new HttpError(409, `This plan allows ${limits.members} members, counting pending invitations. Remove someone or revoke an invitation before you ${action}.`, 'member_limit');
  }
}

export function applyMemberChange(
  actor: StaffPrincipal,
  target: Membership,
  change: { role?: OrgRole; status?: 'active' | 'disabled' },
  roster: Roster,
  now: Date,
): Membership {
  if (actor.uid === target.uid) {
    throw new HttpError(409, 'You cannot change your own role or access. Ask another admin, or leave the organization.', 'self');
  }
  assertMayManage(actor, target, change.role);
  const next: Membership = { ...target, ...change, updatedAt: now.toISOString() };
  assertKeepsAnOwner(target, next, roster.members);
  if (target.status === 'disabled' && next.status === 'active') assertSeatFree(roster, actor.org.billing.limits, 'turn their access back on');
  return next;
}

/** Removing someone, or leaving: anyone may leave, only admins remove others. */
export function assertMayRemove(actor: StaffPrincipal, target: Membership, roster: Roster): void {
  if (actor.uid !== target.uid) assertMayManage(actor, target);
  assertKeepsAnOwner(target, null, roster.members);
}

export function isExpired(inv: Invitation, now: Date): boolean {
  return Date.parse(inv.expiresAt) <= now.getTime();
}

export function buildInvitation(
  input: { email: string; role: InvitableRole },
  org: Organization,
  actor: StaffPrincipal,
  id: string,
  now: Date,
): Invitation {
  return {
    id,
    orgId: org.id,
    orgName: org.name,
    email: input.email,
    role: input.role,
    status: 'pending',
    invitedBy: staffRef(actor),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
  };
}

/**
 * Checked inside the transaction that writes the invitation. Expired invitations still count
 * against the limit until revoked, so that the number shown to admins is the number enforced.
 */
export function invitationGuard(email: string, limits: OrgLimits): (roster: Roster) => void {
  return (roster) => {
    if (roster.members.some((m) => m.email === email)) {
      throw new HttpError(409, 'This address already belongs to a member of this organization. Re-enable them instead if their access is off.', 'already_member');
    }
    if (roster.pending.some((i) => i.email === email)) {
      throw new HttpError(409, 'This address has already been invited.', 'already_invited');
    }
    assertSeatFree(roster, limits, 'invite someone else');
  };
}

/** The same answer for "no such invitation" and "not for you", so invitations cannot be discovered. */
export function assertInvitationFor(inv: Invitation | null, id: Identity, now: Date): Invitation {
  if (!inv || !id.emailVerified || inv.email !== id.email) throw new HttpError(404, 'Invitation not found', 'invitation_not_found');
  if (inv.status !== 'pending') throw new HttpError(409, 'This invitation has already been used, declined or withdrawn.', 'invitation_closed');
  if (isExpired(inv, now)) throw new HttpError(409, 'This invitation has expired. Ask for a new one.', 'invitation_expired');
  return inv;
}

/** Runs inside the accept transaction, so it sees the invitation and the member as they are now. */
export function acceptance(
  identity: Identity & { email: string },
  now: Date,
): (inv: Invitation, existing: Membership | null) => { invitation: Invitation; membership: Membership } {
  return (current, existing) => {
    const inv = assertInvitationFor(current, identity, now);
    if (existing?.status === 'disabled') {
      throw new HttpError(403, 'Your access to this organization has been turned off. Ask one of its admins to turn it back on.', 'membership_disabled');
    }
    const at = now.toISOString();
    const invitation: Invitation = { ...inv, status: 'accepted', decidedAt: at, decidedBy: identity.uid };
    const membership: Membership = existing ?? {
      orgId: inv.orgId,
      uid: identity.uid,
      email: identity.email,
      ...(identity.name ? { name: identity.name } : {}),
      role: inv.role,
      status: 'active',
      joinedAt: at,
      updatedAt: at,
    };
    return { invitation, membership };
  };
}

export interface AuditInput {
  action: AuditAction;
  target?: { type: AuditTargetType; id: string; label?: string };
  detail?: AuditEntry['detail'];
}

export function auditEntry(orgId: string, actor: StaffRef, input: AuditInput, now: Date, unique: string): AuditEntry {
  const at = now.toISOString();
  return { id: auditId(at, unique), orgId, at, actor, ...input };
}
