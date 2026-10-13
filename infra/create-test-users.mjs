// Creates (or resets) one staff and one family test account that sign in with a password.
// Passwords are generated on each run and written only to the output file, never to the console.
// The staff account is staff once it belongs to an organization: sign in and create one, accept an
// invitation, or run `node infra/add-member.mjs <project-id> <org-id> <staff-email>`.
// The family account sees a resident once a staff member enters its email as that resident's family email.
// Usage: node infra/create-test-users.mjs <project-id> <staff-email> <family-email> [output-file]
// Requires `gcloud auth application-default login`.
import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const usage = 'Usage: node infra/create-test-users.mjs <project-id> <staff-email> <family-email> [output-file]';
const [projectId, staffEmail, familyEmail, out = 'credentials-test-users.json'] = process.argv.slice(2);
if (!projectId || !staffEmail?.includes('@') || !familyEmail?.includes('@') || staffEmail === familyEmail) {
  console.error(usage);
  process.exit(1);
}

const auth = getAuth(initializeApp({ projectId }));

async function upsert(email, displayName) {
  const password = randomBytes(18).toString('base64url');
  const fields = { email, password, displayName, emailVerified: true, disabled: false };
  let user;
  try {
    user = await auth.updateUser((await auth.getUserByEmail(email)).uid, fields);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser(fields);
  }
  return { email, password, uid: user.uid };
}

const staff = await upsert(staffEmail, 'Test Staff');
const family = await upsert(familyEmail, 'Test Family');

const file = resolve(out);
writeFileSync(file, JSON.stringify({ projectId, staff, family }, null, 2) + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`staff  ${staff.email} (${staff.uid})`);
console.log(`family ${family.email} (${family.uid})`);
console.log(`Passwords written to ${file}`);
