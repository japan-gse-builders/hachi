// Marks an existing Firebase Auth user as staff. The web app rejects anyone without this claim.
// Usage: node infra/set-staff-claim.mjs <project-id> <staff-email>
// Requires `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [projectId, email] = process.argv.slice(2);
if (!projectId || !email?.includes('@')) {
  console.error('Usage: node infra/set-staff-claim.mjs <project-id> <staff-email>');
  process.exit(1);
}

const auth = getAuth(initializeApp({ projectId }));
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role: 'staff' });
console.log(`${email} can now open the staff screens. Sign out and back in so the new claim is used.`);
