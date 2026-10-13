// One-off, safe to re-run: moves a deployment from "staff are accounts with role=staff" to
// organizations (ADR 0004).
//
// - Creates one organization, on the `internal` plan and verified, if it does not exist yet. An
//   existing one must already be verified (infra/verify-organization.mjs), or nothing is done.
// - Every enabled Auth account with the legacy custom claim role=staff and an email becomes a
//   member: --owner as owner, everyone else as admin, so nobody loses anything they could do.
//   Accounts that already have a membership of this organization are left as they are, and an
//   account handled by an earlier run is never added again (so removing someone sticks).
// - Residents, cases and outbox entries without an `orgId` are given one: their resident's when it
//   has one, otherwise this organization's. Records that already have one are never changed.
//
// Run it once before deploying the organization-aware services and once after: the services
// that were still running in between may have written records without an orgId.
//
// Dry run by default; nothing is written without --apply. Emails are masked in the output.
// Usage: node infra/migrate-organizations.mjs <project-id> --name "<organization name>" --owner <email>
//          [--org-id <id>] [--time-zone Asia/Tokyo] [--apply]
// Requires `gcloud auth application-default login`.
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const INTERNAL_LIMITS = { residents: 1000, members: 200 };
const BATCH_LIMIT = 400;
const usage = 'Usage: node infra/migrate-organizations.mjs <project-id> --name "<organization name>" --owner <email> [--org-id <id>] [--time-zone <IANA zone>] [--apply]';

function parseArgs(argv) {
  const opts = { apply: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (['--name', '--owner', '--org-id', '--time-zone'].includes(a)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = value;
    }
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  console.error(usage);
  process.exit(1);
}
const [projectId] = opts.positional;
const name = opts.name?.trim();
const ownerEmail = opts.owner?.trim().toLowerCase();
const timeZone = opts['time-zone'] ?? 'Asia/Tokyo';
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
// Membership ids are `${orgId}_${uid}`, so an organization id must not contain an underscore.
const orgId = opts['org-id'] ?? `org-${slug(name ?? '') || 'migrated'}`;
if (!projectId || opts.positional.length !== 1 || !name || !ownerEmail?.includes('@') || !/^[A-Za-z0-9-]{1,100}$/.test(orgId)) {
  console.error(usage);
  process.exit(1);
}
try {
  new Intl.DateTimeFormat('en', { timeZone });
} catch {
  console.error(`Unknown time zone: ${timeZone}`);
  process.exit(1);
}

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const { apply } = opts;
const mask = (email) => email.replace(/^(.).*(@.*)$/, '$1***$2');
const at = new Date().toISOString();

// ---- Who is staff today ----

const staff = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const u of page.users) {
    if (u.customClaims?.role !== 'staff' || !u.email || u.disabled) continue;
    staff.push({ uid: u.uid, email: u.email.trim().toLowerCase(), name: u.displayName || undefined, verified: u.emailVerified });
  }
  pageToken = page.pageToken;
} while (pageToken);
console.log(`${staff.length} staff account(s) with the legacy claim in ${projectId}`);

const owner = staff.find((s) => s.email === ownerEmail);
if (!owner) {
  console.error(`--owner ${mask(ownerEmail)} is not an enabled staff account (custom claim role=staff) in ${projectId}.`);
  process.exit(1);
}

// ---- The organization ----

// The residents moved into it are called and alerted for today, so the organization it creates is
// verified (ADR 0004, "Verification"). One that exists unverified was either made by someone else
// or had its verification withdrawn on purpose; neither is this script's to decide.
const orgRef = db.collection('organizations').doc(orgId);
const existing = await orgRef.get();
if (existing.exists && !existing.data().verifiedAt) {
  console.error(
    `Organization ${orgId} ("${existing.data().name}") exists but is not verified, so the residents moved into it would not be called.\n` +
      'If it is yours, verify it first with infra/verify-organization.mjs; otherwise choose another --org-id.',
  );
  process.exit(1);
}
if (existing.exists) {
  console.log(`Organization ${orgId} exists ("${existing.data().name}", verified); not changed.`);
} else {
  console.log(`Organization ${orgId} "${name}" (${timeZone}, plan internal, verified) will be created, owned by ${mask(owner.email)}.`);
  if (apply) {
    const org = {
      id: orgId,
      name,
      timeZone,
      status: 'active',
      verifiedAt: at,
      verifiedBy: 'migration',
      billing: { plan: 'internal', email: owner.email, limits: INTERNAL_LIMITS },
      createdAt: at,
      createdBy: 'migration',
      updatedAt: at,
    };
    const ref = orgRef.collection('audit').doc(`${at}_${randomUUID()}`);
    const batch = db.batch();
    batch.create(orgRef, org);
    batch.create(ref, {
      id: ref.id,
      orgId,
      at,
      actor: { uid: 'migration' },
      action: 'organization.created',
      target: { type: 'organization', id: orgId, label: name },
      detail: { members: staff.length },
    });
    await batch.commit();
  }
}

// ---- Memberships ----

// Every account handled is recorded, so that a later run never brings back someone who has since
// been removed or has left: the legacy claim stays on their account.
const ledgerRef = db.collection('migrations').doc(`organizations-${orgId}`);
const handled = new Set((await ledgerRef.get()).data()?.members ?? []);
let created = 0;
for (const s of staff) {
  if (handled.has(s.uid)) continue;
  const ref = db.collection('memberships').doc(`${orgId}_${s.uid}`);
  const exists = (await ref.get()).exists;
  const role = s.uid === owner.uid ? 'owner' : 'admin';
  if (!exists) {
    created++;
    console.log(`member ${mask(s.email)}: ${role}${s.verified ? '' : ' (WARNING: email not verified; they must confirm it before the staff pages open)'}`);
  }
  if (!apply) continue;
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) {
      tx.create(ref, {
        orgId,
        uid: s.uid,
        email: s.email,
        ...(s.name ? { name: s.name } : {}),
        role,
        status: 'active',
        joinedAt: at,
        updatedAt: at,
      });
    }
    tx.set(ledgerRef, { orgId, members: FieldValue.arrayUnion(s.uid), updatedAt: at }, { merge: true });
  });
}
console.log(`${created} membership(s) to create.`);

// ---- orgId on every record that has none ----

const residentOrg = new Map();
async function backfill(collection, orgOf) {
  const snap = await db.collection(collection).get();
  const missing = snap.docs.filter((d) => !d.data().orgId);
  console.log(`${collection}: ${snap.size} document(s), ${missing.length} without an orgId`);
  if (!apply) return;
  for (let i = 0; i < missing.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    // The precondition makes a document changed since it was read fail the batch rather than be overwritten.
    for (const d of missing.slice(i, i + BATCH_LIMIT)) batch.update(d.ref, { orgId: orgOf(d.data()) }, { lastUpdateTime: d.updateTime });
    await batch.commit();
  }
}

await backfill('residents', () => orgId);
for (const d of (await db.collection('residents').get()).docs) residentOrg.set(d.id, d.data().orgId ?? orgId);
const fromResident = (data) => residentOrg.get(data.residentId) ?? orgId;
await backfill('cases', fromResident);
await backfill('outbox', fromResident);

console.log(apply ? 'Applied.' : 'Dry run: nothing written. Re-run with --apply to write these changes.');
console.log('The legacy role=staff claims are left in place; nothing reads them any more.');
