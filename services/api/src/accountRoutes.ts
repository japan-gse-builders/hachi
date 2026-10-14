import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mayContactPeople, NotFoundError, type AccountStore, type Membership, type StaffRef, type Store } from '@hachi/store';
import {
  acceptance,
  applyMemberChange,
  assertInvitationFor,
  assertMayRemove,
  buildInvitation,
  buildOrganization,
  invitationGuard,
  isExpired,
  MAX_OWNED_ORGANIZATIONS,
  requireRole,
  staffRef,
  type AuditInput,
} from './accounts.js';
import type { AuthAdmin, Identity, StaffPrincipal } from './auth.js';
import { HttpError } from './errors.js';
import { ID, parse, requireIdentity, requireVerifiedEmail } from './request.js';
import { refreshStaffContact, releaseResident } from './residents.js';
import {
  auditQuerySchema,
  invitationCreateSchema,
  memberPatchSchema,
  organizationCreateSchema,
  organizationPatchSchema,
  profilePatchSchema,
} from './schemas.js';

export interface AccountRouteDeps {
  store: Store & AccountStore;
  authAdmin?: AuthAdmin;
  now: () => Date;
  newId: () => string;
  requireStaff: (req: FastifyRequest) => Promise<StaffPrincipal>;
  audit: (req: FastifyRequest, orgId: string, actor: StaffRef, input: AuditInput) => Promise<void>;
}

function pathId(id: string, what: string): string {
  if (!ID.test(id)) throw new NotFoundError(what);
  return id;
}

/** What the team page shows about someone: nothing about their sessions, and not their numbers. */
function memberView(m: Membership) {
  return { uid: m.uid, email: m.email, name: m.name ?? null, role: m.role, status: m.status, joinedAt: m.joinedAt, canBeInCharge: Boolean(m.phone) };
}

/** The numbers are the person's, not the organization's, so a new membership starts with the ones they already gave. */
function contactOf(memberships: Membership[]): Pick<Membership, 'phone' | 'sms'> {
  const m = memberships.find((x) => x.phone);
  return m ? { phone: m.phone, ...(m.sms ? { sms: m.sms } : {}) } : {};
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const { store, now, newId, requireStaff, audit } = deps;
  const auditAs = (req: FastifyRequest, staff: StaffPrincipal, input: AuditInput) => audit(req, staff.orgId, staffRef(staff), input);

  /**
   * Routes for the account rather than one organization have no membership to check a sign-in
   * against, so the account's latest revocation is used: Firebase's, and any "sign out everywhere"
   * recorded on its memberships. Memberships created later inherit it, so a token stolen before
   * the revocation cannot be used to join an organization and then act in it.
   */
  async function freshSession(id: Identity): Promise<{ memberships: Membership[]; validAfter: string | undefined }> {
    const memberships = await store.listMembershipsByUser(id.uid);
    const cutoff = Math.max(
      (await deps.authAdmin?.sessionsValidAfter(id.uid)) ?? 0,
      ...memberships.map((m) => (m.sessionsValidAfter ? Date.parse(m.sessionsValidAfter) : 0)),
    );
    if (cutoff > 0 && (id.authTime ?? 0) < cutoff) {
      throw new HttpError(401, 'You were signed out on every device. Sign in again.', 'session_revoked');
    }
    return { memberships, validAfter: cutoff > 0 ? new Date(cutoff).toISOString() : undefined };
  }

  // ---- The signed-in account itself: any account, before it belongs anywhere ----

  /** Everything the app needs to decide where to send someone: which organizations, and what is waiting for them. */
  app.get('/api/me', async (req) => {
    const id = requireIdentity(req);
    const t = now();
    const { memberships } = await freshSession(id);
    const orgs = await Promise.all(memberships.map((m) => store.getOrganization(m.orgId)));
    const invitations = id.email && id.emailVerified ? (await store.listPendingInvitationsByEmail(id.email)).filter((i) => !isExpired(i, t)) : [];
    // Its name and the inviter's are whatever its staff typed, so the invitee is told whether Hachi knows who they are.
    const inviting = await Promise.all(invitations.map((i) => store.getOrganization(i.orgId)));
    return {
      uid: id.uid,
      email: id.email ?? null,
      emailVerified: id.emailVerified,
      name: memberships.find((m) => m.name)?.name ?? id.name ?? null,
      phone: contactOf(memberships).phone ?? null,
      sms: contactOf(memberships).sms ?? null,
      memberships: memberships.flatMap((m, i) => {
        const org = orgs[i];
        if (!org) return [];
        return [
          { orgId: m.orgId, orgName: org.name, timeZone: org.timeZone, role: m.role, status: m.status, orgStatus: org.status, verified: mayContactPeople(org) },
        ];
      }),
      invitations: invitations.map((i, n) => ({
        id: i.id,
        orgName: i.orgName,
        orgVerified: mayContactPeople(inviting[n]),
        role: i.role,
        invitedBy: i.invitedBy.name ?? i.invitedBy.email ?? null,
        expiresAt: i.expiresAt,
      })),
    };
  });

  /**
   * The name colleagues and the activity log see, and the numbers alerts reach them on when they
   * are in charge of a resident. Kept on each membership so lists need no Auth lookups; residents
   * they are in charge of are brought up to date straight away, so the next alert uses the new ones.
   */
  app.patch('/api/me', async (req) => {
    const id = requireIdentity(req);
    const { name, phone, sms } = parse(profilePatchSchema, req.body);
    await freshSession(id);
    const t = now();
    const at = t.toISOString();
    await deps.authAdmin?.setDisplayName(id.uid, name);
    const saved = await store.updateMembershipsOfUser(id.uid, ({ sms: oldSms, ...m }) => {
      const nextSms = sms === undefined ? oldSms : (sms ?? undefined);
      return { ...m, name, ...(phone ? { phone } : {}), ...(nextSms ? { sms: nextSms } : {}), updatedAt: at };
    });
    const contact = contactOf(saved);
    if (contact.phone) {
      const inCharge = { uid: id.uid, name, phone: contact.phone, ...(contact.sms ? { sms: contact.sms } : {}) };
      await Promise.all(saved.map(async (m) => {
        const theirs = (await store.listResidents(m.orgId)).filter((r) => (r.staff?.uid ?? r.owner?.uid) === id.uid);
        await Promise.all(theirs.map((r) => store.updateResident(r.id, (cur) => refreshStaffContact(cur, { ...inCharge, email: m.email }, t))));
      }));
    }
    return { name, phone: contact.phone ?? null, sms: contact.sms ?? null };
  });

  /**
   * Refresh tokens are revoked in Firebase, and the time is recorded on every membership so ID
   * tokens already issued (valid for up to an hour) stop working at once too. Firebase records
   * sign-in times in whole seconds, so the cut-off is rounded down to one: a fresh sign-in in the
   * same second must not be refused.
   */
  app.post('/api/me/sign-out-everywhere', async (req, reply) => {
    const id = requireIdentity(req);
    const t = now();
    const cutoff = new Date(Math.floor(t.getTime() / 1000) * 1000).toISOString();
    await deps.authAdmin?.revokeSessions(id.uid);
    const updated = await store.updateMembershipsOfUser(id.uid, (m) => ({ ...m, sessionsValidAfter: cutoff, updatedAt: t.toISOString() }));
    const actor: StaffRef = { uid: id.uid, ...(id.email ? { email: id.email } : {}), ...(id.name ? { name: id.name } : {}) };
    await Promise.all(updated.map((m) => audit(req, m.orgId, actor, { action: 'member.sessions_revoked', target: { type: 'member', id: id.uid, label: m.email } })));
    return reply.status(204).send();
  });

  // ---- Joining: creating an organization, or answering an invitation ----

  app.post('/api/organizations', async (req, reply) => {
    const id = requireVerifiedEmail(req);
    const input = parse(organizationCreateSchema, req.body);
    const { memberships, validAfter } = await freshSession(id);
    if (memberships.filter((m) => m.role === 'owner').length >= MAX_OWNED_ORGANIZATIONS) {
      throw new HttpError(409, `An account can own up to ${MAX_OWNED_ORGANIZATIONS} organizations.`, 'organization_limit');
    }
    // Membership ids join the organization id and the uid with `_`, so organization ids never contain one.
    const orgId = newId().replace(/[^A-Za-z0-9-]/g, '');
    const { org, owner } = buildOrganization(input, orgId, id, now());
    await store.createOrganization(org, { ...owner, ...contactOf(memberships), ...(validAfter ? { sessionsValidAfter: validAfter } : {}) });
    await audit(req, org.id, staffRef(id), { action: 'organization.created', target: { type: 'organization', id: org.id, label: org.name } });
    return reply.status(201).send({ orgId: org.id, orgName: org.name, role: owner.role });
  });

  app.post<{ Params: { id: string } }>('/api/invitations/:id/accept', async (req) => {
    const id = requireVerifiedEmail(req);
    const invId = pathId(req.params.id, 'Invitation');
    const { memberships, validAfter } = await freshSession(id);
    const accept = acceptance(id, now());
    let joined = false;
    const membership = await store.acceptInvitation(invId, id.uid, (inv, existing) => {
      const result = accept(inv, existing);
      joined = !existing;
      if (!joined) return result;
      return { ...result, membership: { ...result.membership, ...contactOf(memberships), ...(validAfter ? { sessionsValidAfter: validAfter } : {}) } };
    }).catch((err: unknown) => {
      // A missing invitation reads the same as one addressed to someone else.
      if (err instanceof NotFoundError) throw new HttpError(404, 'Invitation not found', 'invitation_not_found');
      throw err;
    });
    if (joined) {
      await audit(req, membership.orgId, staffRef(id), {
        action: 'member.joined',
        target: { type: 'member', id: id.uid, label: id.email },
        detail: { role: membership.role, invitation: invId },
      });
    }
    const org = await store.getOrganization(membership.orgId);
    return { orgId: membership.orgId, orgName: org?.name ?? null, role: membership.role };
  });

  app.post<{ Params: { id: string } }>('/api/invitations/:id/decline', async (req) => {
    const id = requireVerifiedEmail(req);
    const invId = pathId(req.params.id, 'Invitation');
    await freshSession(id);
    const t = now();
    const inv = assertInvitationFor(await store.getInvitation(invId), id, t);
    const saved = await store.updateInvitation(inv.id, (cur) => ({ ...assertInvitationFor(cur, id, t), status: 'declined', decidedAt: t.toISOString(), decidedBy: id.uid }));
    await audit(req, saved.orgId, staffRef(id), { action: 'invitation.declined', target: { type: 'invitation', id: saved.id, label: saved.email } });
    return { status: saved.status };
  });

  // ---- The organization the request acts for ----

  app.get('/api/organization', async (req) => {
    const staff = await requireStaff(req);
    const { org } = staff;
    const base = { id: org.id, name: org.name, timeZone: org.timeZone, role: staff.role, verified: mayContactPeople(org) };
    if (!(staff.role === 'owner' || staff.role === 'admin')) return base;
    const [residents, members, pending] = await Promise.all([store.listResidents(org.id), store.listMembers(org.id), store.listPendingInvitations(org.id)]);
    return {
      ...base,
      createdAt: org.createdAt,
      billing: { plan: org.billing.plan, email: org.billing.email, limits: org.billing.limits },
      usage: { residents: residents.length, members: members.filter((m) => m.status === 'active').length + pending.length },
    };
  });

  app.patch('/api/organization', async (req) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const patch = parse(organizationPatchSchema, req.body);
    // Invoices will go to this address, so only an owner may redirect them.
    if (patch.billingEmail !== undefined) requireRole(staff, 'owner');
    const at = now().toISOString();
    const saved = await store.updateOrganization(staff.orgId, (o) => ({
      ...o,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
      ...(patch.billingEmail !== undefined ? { billing: { ...o.billing, email: patch.billingEmail } } : {}),
      updatedAt: at,
    }));
    if (patch.name !== undefined && patch.name !== staff.org.name) {
      // Invitees cannot read the organization, so their invitation carries its name.
      const pending = await store.listPendingInvitations(staff.orgId);
      await Promise.all(pending.map((i) => store.updateInvitation(i.id, (cur) => ({ ...cur, orgName: saved.name }))));
    }
    await auditAs(req, staff, {
      action: 'organization.updated',
      target: { type: 'organization', id: saved.id, label: saved.name },
      detail: { fields: Object.keys(patch).sort().join(',') },
    });
    return { id: saved.id, name: saved.name, timeZone: saved.timeZone, billing: { plan: saved.billing.plan, email: saved.billing.email, limits: saved.billing.limits } };
  });

  // ---- Members ----

  app.get('/api/organization/members', async (req) => {
    const staff = await requireStaff(req);
    return { members: (await store.listMembers(staff.orgId)).map(memberView) };
  });

  app.patch<{ Params: { uid: string } }>('/api/organization/members/:uid', async (req) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const uid = pathId(req.params.uid, 'Member');
    const change = parse(memberPatchSchema, req.body);
    let before: Membership | undefined;
    const saved = await store.mutateMembership(staff.orgId, uid, (m, roster) => {
      before = m;
      return applyMemberChange(staff, m, change, roster, now());
    });
    if (!saved || !before) throw new NotFoundError('Member');
    const target = { type: 'member' as const, id: uid, label: saved.email };
    if (before.role !== saved.role) {
      await auditAs(req, staff, { action: 'member.role_changed', target, detail: { from: before.role, to: saved.role } });
    }
    if (before.status !== saved.status) {
      await auditAs(req, staff, { action: saved.status === 'disabled' ? 'member.disabled' : 'member.enabled', target });
    }
    return memberView(saved);
  });

  /**
   * Removing someone, or leaving when it is yourself. Their residents become unassigned in this
   * organization, so nobody is left looking responsible who can no longer act. Disabling instead
   * keeps them as they are, for someone who will be back.
   *
   * The rules are checked first and residents released before the membership goes, so a failure
   * part way leaves a member who can simply be removed again. A second sweep afterwards catches a
   * resident handed to them in between.
   */
  app.delete<{ Params: { uid: string } }>('/api/organization/members/:uid', async (req, reply) => {
    const staff = await requireStaff(req);
    const uid = pathId(req.params.uid, 'Member');
    const target = await store.getMembership(staff.orgId, uid);
    if (!target) throw new NotFoundError('Member');
    assertMayRemove(staff, target, { members: await store.listMembers(staff.orgId), pending: [] });
    const t = now();
    const release = async () => {
      const theirs = (await store.listResidents(staff.orgId)).filter((r) => r.owner?.uid === uid);
      await Promise.all(theirs.map((r) => store.updateResident(r.id, (cur) => (cur.owner?.uid === uid ? releaseResident(cur, t) : cur))));
      return theirs.length;
    };
    let unassigned = await release();
    let removed: Membership | undefined;
    await store.mutateMembership(staff.orgId, uid, (m, roster) => {
      assertMayRemove(staff, m, roster);
      removed = m;
      return null;
    });
    unassigned += await release();
    await auditAs(req, staff, {
      action: uid === staff.uid ? 'member.left' : 'member.removed',
      target: { type: 'member', id: uid, label: removed?.email ?? uid },
      detail: { residentsUnassigned: unassigned },
    });
    return reply.status(204).send();
  });

  // ---- Invitations ----

  app.get('/api/organization/invitations', async (req) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const t = now();
    return {
      invitations: (await store.listPendingInvitations(staff.orgId)).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invitedBy: i.invitedBy.name ?? i.invitedBy.email ?? null,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        expired: isExpired(i, t),
      })),
    };
  });

  /**
   * Save access before the web app sends a Firebase sign-in email. Email delivery can be retried
   * without creating another invitation; accepting still requires the verified invited address.
   */
  app.post('/api/organization/invitations', async (req, reply) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const input = parse(invitationCreateSchema, req.body);
    const inv = buildInvitation(input, staff.org, staff, newId(), now());
    await store.createInvitation(inv, invitationGuard(inv.email, staff.org.billing.limits));
    await auditAs(req, staff, { action: 'invitation.created', target: { type: 'invitation', id: inv.id, label: inv.email }, detail: { role: inv.role } });
    return reply.status(201).send({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt });
  });

  app.delete<{ Params: { id: string } }>('/api/organization/invitations/:id', async (req, reply) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const invId = pathId(req.params.id, 'Invitation');
    const at = now().toISOString();
    const saved = await store.updateInvitation(invId, (cur) => {
      if (cur.orgId !== staff.orgId) throw new NotFoundError('Invitation');
      if (cur.status !== 'pending') throw new HttpError(409, 'This invitation has already been used, declined or withdrawn.', 'invitation_closed');
      return { ...cur, status: 'revoked', decidedAt: at, decidedBy: staff.uid };
    });
    await auditAs(req, staff, { action: 'invitation.revoked', target: { type: 'invitation', id: saved.id, label: saved.email } });
    return reply.status(204).send();
  });

  // ---- Activity ----

  app.get('/api/organization/audit', async (req) => {
    const staff = await requireStaff(req);
    requireRole(staff, 'admin');
    const { before, limit } = parse(auditQuerySchema, req.query);
    const entries = await store.listAudit(staff.orgId, { limit: limit + 1, ...(before ? { before } : {}) });
    const page = entries.slice(0, limit);
    return { entries: page, next: entries.length > limit ? page[page.length - 1]!.id : null };
  });
}
