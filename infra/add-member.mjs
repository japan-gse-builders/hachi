// Makes an existing Firebase Auth account a member of an organization, without an invitation.
// For operators and test setups; in the app, admins invite people instead.
// Usage: node infra/add-member.mjs <project-id> <org-id> <email> [member|admin|owner]
// Requires `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const usage = 'Usage: node infra/add-member.mjs <project-id> <org-id> <email> [member|admin|owner]';
const [projectId, orgId, email, role = 'member'] = process.argv.slice(2);
if (!projectId || !/^[A-Za-z0-9-]{1,100}$/.test(orgId ?? '') || !email?.includes('@') || !['member', 'admin', 'owner'].includes(role) || process.argv.length > 6) {
  console.error(usage);
  process.exit(1);
}

const app = initializeApp({ projectId });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const org = await db.collection('organizations').doc(orgId).get();
if (!org.exists) {
  console.error(`No organization ${orgId} in ${projectId}.`);
  process.exit(1);
}
const user = await getAuth(app).getUserByEmail(email);
if (!user.emailVerified) console.warn('Note: this account has not confirmed its email; the staff pages stay closed until it does.');

const at = new Date().toISOString();
const ref = db.collection('memberships').doc(`${orgId}_${user.uid}`);
// Refusals are returned rather than thrown: the SDK rolls back without waiting, and a script that
// exits on the error leaves the transaction's locks held until they time out.
const outcome = await db.runTransaction(async (tx) => {
  const current = await tx.get(ref);
  if (current.exists && current.data().role === 'owner' && role !== 'owner') {
    const members = await tx.get(db.collection('memberships').where('orgId', '==', orgId));
    const others = members.docs.filter((d) => d.id !== ref.id && d.data().role === 'owner' && d.data().status === 'active');
    if (others.length === 0) return 'last_owner';
  }
  if (current.exists) {
    tx.update(ref, { role, status: 'active', updatedAt: at });
    return 'updated';
  }
  tx.create(ref, {
    orgId,
    uid: user.uid,
    email: user.email.trim().toLowerCase(),
    ...(user.displayName ? { name: user.displayName } : {}),
    role,
    status: 'active',
    joinedAt: at,
    updatedAt: at,
  });
  return 'added';
});
if (outcome === 'last_owner') {
  console.error(`${email} is the last active owner of "${org.data().name}"; make someone else an owner first.`);
  process.exit(1);
}
console.log(`${email} ${outcome} as ${role} of "${org.data().name}" (${orgId}).`);
