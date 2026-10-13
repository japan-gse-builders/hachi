# 0004. Staff belong to organizations

- Status: accepted
- Date: 2026-10-13
- Related: `packages/store/src/accounts.ts`, `services/api/src/accounts.ts`,
  `services/api/src/accountRoutes.ts`, `infra/migrate-organizations.mjs`

## Context

Until now a member of staff was any Firebase account carrying the custom claim `role: "staff"`, set
by hand with an admin script. Every such account saw every resident in the deployment. There was no
notion of the care company those people work for, so:

- two companies on one deployment would have seen each other's residents, recordings and cases;
- nobody but an operator with admin credentials could add or remove a colleague, and removing one
  meant editing claims, which only take effect when the person's ID token next refreshes (up to an
  hour);
- there was nowhere to hang a plan, limits or a billing contact, and no record of who changed what.

## Decision

### Model

| Record | Where | Purpose |
|---|---|---|
| `Organization` | `organizations/{orgId}` | Name, time zone, status (active or suspended), billing (plan, billing email, limits, future payment customer id) |
| `Membership` | `memberships/{orgId}_{uid}` | What makes an account staff: organization, role, status (active or disabled), email and name copied from the account, `sessionsValidAfter` |
| `Invitation` | `invitations/{id}` | An email address invited to an organization with a role; pending, accepted, declined or revoked; expires after 14 days |
| `AuditEntry` | `organizations/{orgId}/audit/{id}` | Append-only record of who changed what |

Residents, cases and outbox entries carry an `orgId`. Calls live under their resident and need none.
Cases and outbox entries are only created through the shared code in `packages/store`
(`recordDetections`, the loneliness check-in and `recordContactRequest`), which copies the
resident's `orgId`.

An account can belong to several organizations; the web app only shows an organization switcher when
someone has two or more usable ones.

### Roles

| | Member | Admin | Owner |
|---|---|---|---|
| Residents, cases, queue, held messages of the organization | yes | yes | yes |
| Edit residents they are responsible for | yes | yes | yes |
| Hand a resident to another member | | yes | yes |
| Invite, withdraw invitations, change roles, turn access off and on, remove members | | yes (not owners) | yes |
| Organization name and time zone, activity log, plan and usage | | yes | yes |
| Billing email; make, demote or remove an owner | | | yes |

Owners are only made by promoting an existing member, never by invitation, so a mistyped address
cannot take over an organization. The last active owner cannot be demoted, disabled or removed and
cannot leave. Nobody can change their own role or access.

### Authorization

- Firebase Auth proves who someone is; the membership, read on every request, decides what they may
  do. Changes (role, access off, removal, sign out everywhere) take effect on the very next request,
  not when a token refreshes.
- The organization of a request is the `x-hachi-org` header. Without it, the one active membership
  is used; with several, the API answers `organization_required`.
- Staff need a verified email: memberships and invitations are keyed by email, so an unproven address
  must not be able to claim one.
- Another organization's resident, case or held message gets the same 404 as a missing one, so ids
  cannot be probed.
- A suspended organization's staff are refused (`organization_suspended`). Its residents keep being
  called; suspension is about access, not care.
- The custom claim is no longer read by the API. It stays on existing accounts (see Deferred).

### Joining

Self-serve: anyone with a verified email can create an organization and becomes its owner (at most
three owned organizations per account). Everyone else joins by invitation. Invitations are bound to
the email address, not a secret link: only an account that has verified that address can accept, so
a forwarded link gives nobody access. No invitation emails are sent yet; the invitee sees pending
invitations when they sign in. "Not found" and "not yours" give the same response.

### Verification

Self-serve means anyone can create an organization and type in any phone number or address: a
resident's, a family contact's, staff's. Without a check, that would let a stranger have Hachi ring,
text, email or push-notify whoever they like, and put a made-up resident on someone else's family
dashboard (family access follows the contact, whatever the organization).

So an organization is unverified until a Hachi operator, knowing who runs it, sets `verifiedAt`
with `infra/verify-organization.mjs` (audited as `organization.verified`, by the operator's email).
Its staff cannot set it. Until then everything that reaches a person is off, each where it is
enforced, not only where it is explained:

- **Calls:** the telephony service refuses to dial (daily check-ins and "call now"), recording why
  on a staff call, and the scheduler does not queue them; the API refuses "call now" with
  `organization_unverified`. Emergency bridging checks too, though it only happens inside a call.
- **Messages:** the notification worker marks every SMS, email, voice alert and push `skipped`
  (`organization_unverified`). They are not kept for later: an alert sent days late would mislead.
  An entry without an `orgId` (written by a service from before organizations) is judged by its
  resident's organization.
- **Family:** the organization's residents appear on no family list or dashboard, their held
  messages are not offered to family, and no push tokens are collected for them.

Staff can still set up the team, residents and settings, and see a notice saying what is off and
how to get verified. Its invitations still work, marked for the invitee as from an organization
Hachi has not verified, since its name and the inviter's are whatever it typed. A resident with no
organization, or an unknown one, is treated as unverified. The migration creates its organization
verified, so existing residents' calls carry on, and refuses to use an existing one that is not.
`--revoke` withdraws verification: no new call, message or bridge starts from then on; a call
already under way runs to its end.

### Leaving and removal

A disabled member keeps their residents (access is often turned off temporarily) but frees their
seat, so turning access back on needs a free seat again. A removed member, or one who leaves, has
their residents in that organization unassigned, and admins see them as "needs someone
responsible". Residents are released before the membership is deleted, so a failure part way can be
retried, and once more after it, for a resident handed to them in between. Removal deletes the
membership; the audit log keeps the history.

### Sessions

"Sign out everywhere" revokes the account's Firebase refresh tokens and records the time (floored to
the second, the precision of a token's `auth_time`) on every membership. Staff ID tokens from earlier
sign-ins are refused at once (`session_revoked`), and the web app signs out on that answer.

Routes for the account rather than one organization (`/api/me`, creating an organization, answering
an invitation) check the account's latest revocation: Firebase's `tokensValidAfterTime` (also moved
by a password change) and any recorded on its memberships. A membership created later inherits it,
so a token stolen before the sign-out cannot join an organization and then act in it.

### Audit

Organization settings, membership and invitation changes, resident creation, edits (field names
only), owner changes, family access, held-message decisions and case updates are recorded with the
actor's name as it was then. Entries are written after the change commits; a failed audit write is
logged (`audit_write_failed`) instead of failing a change that already happened. Only admins and
owners can read the log; family never see it.

### Billing groundwork

Every organization has a plan: `trial` for self-serve ones, `internal` for ours and migrated ones.
Limits are enforced now: trial organizations get 20 residents and 10 seats (active members plus
pending invitations), so a self-serve sign-up cannot run up call costs for everyone. Seats are
checked in the same transaction as the invitation or the re-enabling. The resident limit and the
three-organizations-per-account limit are checked before creation, not in the same transaction, so
simultaneous creations can go one over; acceptable while no money depends on them. AI spend figures are platform-wide, so only
`internal` organizations see amounts; everyone else sees only whether calls are paused.

## Rollout

The migration is idempotent and a dry run unless `--apply` is given.

1. `firebase deploy --only firestore:indexes` and wait for the indexes to build.
2. `node infra/migrate-organizations.mjs <project> --name "<company>" --owner <email>`, check the
   output, then the same with `--apply`. It creates the organization on the `internal` plan, verified, makes
   every enabled account with the legacy claim a member (the named owner as owner, everyone else as
   admin so nobody loses anything) and gives every resident, case and outbox entry an `orgId`.
   Accounts it has handled are recorded in `migrations/organizations-<orgId>`, so a later run never
   brings back someone removed in the meantime.
3. Deploy every service (telephony, voice gateway, notifier, analyzer, API), then hosting. A
   resident registered by the old API after step 2 has no `orgId`, and is neither rung nor alerted
   for until step 4 gives it one, so run it promptly.
4. Run the migration with `--apply` again: services still running the old code in between can have
   written records without an `orgId`, or overwritten one. Those records are invisible to staff until
   they have one. If the backfill reports a precondition failure, a record changed while it ran; run
   it again.

Afterwards, add people with invitations, or with `infra/add-member.mjs` for test setups. Verify
self-serve organizations with `infra/verify-organization.mjs <project> <org-id> --by <your email>`
(dry run first, then `--apply`), once you know who runs them.
`infra/set-staff-claim.mjs` is gone; `infra/create-test-users.mjs` no longer sets a claim.

## Consequences

- One deployment can serve several care companies without them seeing each other's data.
- Admins manage their own team; operators are needed only for verification, suspension and recovery.
- A new organization cannot try a real call until it is verified.
- Every staff request costs one or two extra Firestore reads (the membership, and the organization
  for its status). That is the price of changes taking effect immediately.
- Family access is unchanged: it follows the resident's registered family contact, whatever the
  organization.

## Deferred

Not built yet, on purpose:

- **Sign-in security:** multi-factor authentication; SSO / SAML; joining automatically by email
  domain; SCIM provisioning; a password policy beyond Firebase's; a list of signed-in devices with
  per-device sign-out; rate limiting on the API.
- **Family sessions:** "sign out everywhere" revokes family refresh tokens, but a family ID token
  stays valid on family routes for up to an hour (`verifyIdToken(token, true)` would fix it at the
  cost of a lookup per request).
- **Email changes:** a changed Firebase email is not copied to memberships, and invitations to the
  old address stay addressed to it.
- **Operators:** a platform admin console, support impersonation, and a UI to suspend or reinstate an
  organization (today: set `status` in Firestore) or to verify one (today: the script), with a queue
  of organizations waiting for it and a way for an owner to ask.
- **Verification beyond the gate:** checking that a number belongs to the person it is entered for
  (an SMS code), and a sandbox in which an unverified organization can try a call to its own staff.
- **Billing:** a payment provider, invoices, seat- or resident-based plans, usage metering, plan
  changes and per-organization AI spend caps (spend is platform-wide today).
- **Per-organization settings:** their own Twilio numbers and email senders, branding, privacy notice
  versions; using the organization time zone for every date shown to staff (it is used for new
  residents today).
- **Data lifecycle:** export of an organization's data, deleting an organization, retention periods.
- **Invitations:** sending invitation emails; resending.
- **Audit:** export, retention, and writing entries in the same transaction as the change.
- **API keys** for integrations.
- **The legacy claim:** removing `role: "staff"` from existing accounts. The web app still uses it
  once, to move a browser session from before the staff/family split to the right side.
- **Strict limits:** enforcing the resident and owned-organization limits in the same transaction as
  the creation.
- **Assigning a resident** checks the new owner's membership just before the resident's transaction,
  not inside it; the removal sweep above covers the race in practice.
