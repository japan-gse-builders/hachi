export type OrgRole = 'owner' | 'admin' | 'member';

export interface MembershipSummary {
  orgId: string;
  orgName: string;
  timeZone: string;
  role: OrgRole;
  status: 'active' | 'disabled';
  orgStatus: 'active' | 'suspended';
  /** Until Hachi verifies the organization, it rings, alerts and shows nobody (see `UnverifiedNotice`). */
  verified: boolean;
}

export interface PendingInvitation {
  id: string;
  orgName: string;
  orgVerified: boolean;
  role: Exclude<OrgRole, 'owner'>;
  invitedBy: string | null;
  expiresAt: string;
}

/** `GET /api/me`. */
export interface Me {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  memberships: MembershipSummary[];
  invitations: PendingInvitation[];
}

export interface Member {
  uid: string;
  email: string;
  name: string | null;
  role: OrgRole;
  status: 'active' | 'disabled';
  joinedAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: Exclude<OrgRole, 'owner'>;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

/** `GET /api/organization`. Billing and usage are only there for admins. */
export interface OrganizationView {
  id: string;
  name: string;
  timeZone: string;
  role: OrgRole;
  verified: boolean;
  createdAt?: string;
  billing?: { plan: 'trial' | 'internal'; email: string; limits: { residents: number; members: number } };
  usage?: { residents: number; members: number };
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { uid: string; email?: string; name?: string };
  action: string;
  target?: { type: string; id: string; label?: string };
  detail?: Record<string, string | number | boolean | null>;
}

const RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

/** Mirrors the API's rule; the API enforces it, this only decides what to offer. */
export function atLeast(role: OrgRole | undefined | null, min: OrgRole): boolean {
  return role ? RANK[role] >= RANK[min] : false;
}

export const ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export const ROLE_MEANING: Record<OrgRole, string> = {
  owner: 'Everything an admin can do, plus managing owners and billing.',
  admin: 'Invites and manages staff, reassigns patients, sees the activity log.',
  member: 'Works with patients and the queue.',
};

/** Memberships the account can act for right now. */
export function usableMemberships(all: MembershipSummary[]): MembershipSummary[] {
  return all.filter((m) => m.status === 'active' && m.orgStatus === 'active');
}

/** The organization last chosen on this device if it is still usable, otherwise the first that is. */
/** The first preference that is still usable, else the first usable organization. */
export function chooseOrg(all: MembershipSummary[], ...preferred: (string | null | undefined)[]): MembershipSummary | null {
  const usable = usableMemberships(all);
  for (const p of preferred) {
    const hit = p ? usable.find((m) => m.orgId === p) : undefined;
    if (hit) return hit;
  }
  return usable[0] ?? null;
}

export const orgStorageKey = (uid: string) => `hachi.org.${uid}`;

/** Every zone the browser knows, with the usual ones for this service first. */
export function timeZoneOptions(current?: string): string[] {
  const known = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? [];
  const first = ['Asia/Tokyo', Intl.DateTimeFormat().resolvedOptions().timeZone, current].filter((z): z is string => Boolean(z));
  return [...new Set([...first, ...known])];
}

export const PLAN_LABEL: Record<'trial' | 'internal', string> = { trial: 'Trial', internal: 'Hachi internal' };

/** What happened, in a sentence an admin can scan. */
export function describeAudit(e: AuditEntry): string {
  const who = e.target?.label ?? e.target?.id ?? '';
  const d = e.detail ?? {};
  switch (e.action) {
    case 'organization.created':
      return `Created the organization ${who}`;
    case 'organization.updated':
      return `Changed organization settings (${String(d.fields ?? '').split(',').join(', ')})`;
    case 'organization.verified':
      return 'Verified the organization: calls, alerts and family dashboards are on';
    case 'organization.unverified':
      return 'Withdrew the verification: calls, alerts and family dashboards are off';
    case 'member.joined':
      return `Joined as ${ROLE_LABEL[d.role as OrgRole]?.toLowerCase() ?? 'member'}`;
    case 'member.role_changed':
      return `Changed ${who} from ${ROLE_LABEL[d.from as OrgRole] ?? d.from} to ${ROLE_LABEL[d.to as OrgRole] ?? d.to}`;
    case 'member.disabled':
      return `Turned off access for ${who}`;
    case 'member.enabled':
      return `Turned access back on for ${who}`;
    case 'member.removed':
      return `Removed ${who}${d.residentsUnassigned ? `; ${d.residentsUnassigned} patient(s) now unassigned` : ''}`;
    case 'member.left':
      return `Left the organization${d.residentsUnassigned ? `; ${d.residentsUnassigned} patient(s) now unassigned` : ''}`;
    case 'member.sessions_revoked':
      return 'Signed out on every device';
    case 'invitation.created':
      return `Invited ${who} as ${ROLE_LABEL[d.role as OrgRole]?.toLowerCase() ?? 'member'}`;
    case 'invitation.revoked':
      return `Withdrew the invitation for ${who}`;
    case 'invitation.declined':
      return `Declined the invitation for ${who}`;
    case 'resident.created':
      return `Registered ${who}`;
    case 'resident.updated':
      return `Changed details of ${who}`;
    case 'resident.owner_changed':
      if (!d.to) return `Handed ${who} over${d.fromName ? ` from ${d.fromName}` : ''}`;
      return `Made ${d.toName ?? 'someone'} responsible for ${who}${d.fromName ? ` instead of ${d.fromName}` : ''}`;
    case 'resident.family_access_granted':
      return `Gave ${d.email ?? 'a family account'} access to ${who}`;
    case 'resident.family_access_revoked':
      return `Removed ${d.email ?? 'a family account'}’s access to ${who}`;
    case 'resident.contact_request_decided':
      return `${d.decision === 'approve' ? 'Approved' : 'Rejected'} a message ${who} asked for${d.by === 'family' ? ', as their family' : ''}`;
    case 'case.updated':
      return `Updated a case (${String(d.fields ?? '').split(',').join(', ')})`;
    default:
      return e.action;
  }
}

/** Names are chosen freely, so the address is shown too: anyone could call themselves the owner. */
export function actorName(actor: AuditEntry['actor']): string {
  if (actor.name && actor.email) return `${actor.name} (${actor.email})`;
  if (actor.uid === 'operator') return `Hachi support${actor.email ? ` (${actor.email})` : ''}`;
  if (actor.uid === 'migration' && !actor.email) return 'Hachi (account migration)';
  return actor.name ?? actor.email ?? 'Someone';
}
