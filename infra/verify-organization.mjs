// Marks an organization as verified, or withdraws it (ADR 0004, "Verification"). Until verified,
// Hachi rings none of its residents, sends none of its alerts and shows none of its residents to
// family: anyone can create an organization and type in a stranger's number.
//
// Verify only once you know who runs it (a contract, a call with the owner). Without --apply it
// shows what would change, and who owns the organization, so that can be checked first.
// Usage: node infra/verify-organization.mjs <project-id> <org-id> --by <your email> [--revoke] [--apply]
// Requires `gcloud auth application-default login`.
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const usage = 'Usage: node infra/verify-organization.mjs <project-id> <org-id> --by <your email> [--revoke] [--apply]';
const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  return i === -1 ? false : (args.splice(i, 1), true);
};
const apply = flag('--apply');
const revoke = flag('--revoke');
const byAt = args.indexOf('--by');
const by = byAt === -1 ? undefined : args.splice(byAt, 2)[1]?.trim().toLowerCase();
const [projectId, orgId] = args;
if (!projectId || !/^[A-Za-z0-9-]{1,100}$/.test(orgId ?? '') || args.length !== 2 || !by?.includes('@') || by.startsWith('--') || args.some((a) => a.startsWith('--'))) {
  console.error(usage);
  process.exit(1);
}

const app = initializeApp({ projectId });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const orgRef = db.collection('organizations').doc(orgId);
const snap = await orgRef.get();
if (!snap.exists) {
  console.error(`No organization ${orgId} in ${projectId}.`);
  process.exit(1);
}
const org = snap.data();
const members = await db.collection('memberships').where('orgId', '==', orgId).get();
const owners = members.docs.map((d) => d.data()).filter((m) => m.role === 'owner' && m.status === 'active');
console.log(`"${org.name}" (${orgId}), plan ${org.billing?.plan}, created ${org.createdAt}`);
console.log(`  owners: ${owners.map((m) => m.email).join(', ') || '(none)'}; billing email: ${org.billing?.email}`);
console.log(`  ${members.size} member(s); ${org.verifiedAt ? `verified ${org.verifiedAt} by ${org.verifiedBy}` : 'not verified'}`);

if (revoke ? !org.verifiedAt : !!org.verifiedAt) {
  console.log(revoke ? 'Not verified; nothing to withdraw.' : 'Already verified; nothing to do.');
  process.exit(0);
}
if (!apply) {
  console.log(revoke ? 'Would withdraw verification: calls, alerts and family dashboards stop at once.' : 'Would verify it. Re-run with --apply.');
  process.exit(0);
}

const at = new Date().toISOString();
const auditRef = orgRef.collection('audit').doc(`${at}_${randomUUID()}`);
// Decided against what is stored at the moment of writing; returned rather than thrown, because
// the SDK rolls back without waiting and an exiting script would leave the locks held.
const outcome = await db.runTransaction(async (tx) => {
  const current = (await tx.get(orgRef)).data();
  if (!current || (revoke ? !current.verifiedAt : !!current.verifiedAt)) return 'unchanged';
  tx.update(
    orgRef,
    revoke ? { verifiedAt: FieldValue.delete(), verifiedBy: FieldValue.delete(), updatedAt: at } : { verifiedAt: at, verifiedBy: by, updatedAt: at },
  );
  tx.create(auditRef, {
    id: auditRef.id,
    orgId,
    at,
    // Not one of the organization's members: shown by email in its activity log.
    actor: { uid: 'operator', email: by },
    action: revoke ? 'organization.unverified' : 'organization.verified',
    target: { type: 'organization', id: orgId, label: current.name },
  });
  return revoke ? 'withdrawn' : 'verified';
});
if (outcome === 'unchanged') {
  console.error('The organization was changed or deleted meanwhile; nothing done. Run it again to see where it stands.');
  process.exit(1);
}
console.log(`"${org.name}" ${outcome}.`);
