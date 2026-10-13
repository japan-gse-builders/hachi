// One-off: gives residents registered before ownership existed their responsible staff member,
// and records family accounts that were linked by hand as family access.
//
// - Owner: the staff account (custom claim role=staff) whose email matches the resident's staff
//   contact email. Residents without a match stay unassigned; staff take them on in the app.
// - Family access: emails in `familyLookup` that are not the family contact's become
//   `familyAccess` entries, so the API keeps them when it next recomputes `familyLookup`.
//
// Dry run by default; nothing is written without --apply. Emails are masked in the output.
// Usage: node infra/migrate-resident-owners.mjs <project-id> [--apply]
// Requires `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const FAMILY_ACCESS_MAX = 5;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [projectId] = args.filter((a) => a !== '--apply');
if (!projectId || args.some((a) => a.startsWith('--') && a !== '--apply')) {
  console.error('Usage: node infra/migrate-resident-owners.mjs <project-id> [--apply]');
  process.exit(1);
}

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : undefined);
const mask = (email) => email.replace(/^(.).*(@.*)$/, '$1***$2');

const staffByEmail = new Map();
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const u of page.users) {
    if (u.customClaims?.role !== 'staff' || !u.email || u.disabled) continue;
    staffByEmail.set(lower(u.email), { uid: u.uid, email: lower(u.email), ...(u.displayName ? { name: u.displayName } : {}) });
  }
  pageToken = page.pageToken;
} while (pageToken);
console.log(`${staffByEmail.size} staff account(s) in ${projectId}`);

/** What would change for one resident, or null when it needs nothing. */
function plan(r, at) {
  const changes = {};
  const notes = [];
  if (!r.owner) {
    const match = staffByEmail.get(lower(r.staff?.email));
    if (match) {
      changes.owner = { ...match, since: at };
      notes.push(`owner ${mask(match.email)}`);
    } else {
      notes.push('unassigned (no staff account matches its staff email)');
    }
  }
  if (!Array.isArray(r.familyAccess)) {
    const contact = new Set([lower(r.family?.email), r.family?.sms].filter(Boolean));
    const extra = (r.familyLookup ?? []).filter((c) => !contact.has(c));
    const emails = extra.filter((c) => c.includes('@'));
    const kept = emails.slice(0, FAMILY_ACCESS_MAX);
    changes.familyAccess = kept.map((email) => ({ email, addedAt: at, addedBy: 'migration' }));
    if (kept.length) notes.push(`family access ${kept.map(mask).join(', ')}`);
    if (emails.length > kept.length) notes.push(`WARNING: ${emails.length - kept.length} email(s) beyond the limit of ${FAMILY_ACCESS_MAX} will lose access on the next change`);
    const phones = extra.length - emails.length;
    if (phones) notes.push(`WARNING: ${phones} phone number(s) besides the contact's will lose access on the next change`);
  }
  return Object.keys(changes).length ? { changes, notes } : null;
}

const at = new Date().toISOString();
const snap = await db.collection('residents').get();
let toChange = 0;
let unassigned = 0;
for (const doc of snap.docs) {
  const p = plan(doc.data(), at);
  if (!p) continue;
  toChange++;
  if (!doc.data().owner && !p.changes.owner) unassigned++;
  console.log(`${doc.id}: ${p.notes.join('; ')}`);
  if (!apply) continue;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    const again = fresh.exists ? plan(fresh.data(), at) : null;
    if (again) tx.update(doc.ref, { ...again.changes, updatedAt: at });
  });
}
console.log(`${snap.size} resident(s), ${toChange} to update, ${unassigned} left unassigned.`);
console.log(apply ? 'Applied.' : 'Dry run: nothing written. Re-run with --apply to write these changes.');
