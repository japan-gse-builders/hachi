// Explicit operator action only. The default preview needs no cloud credentials and makes no writes.
import { parseArgs } from 'node:util';
import { buildDemoData } from '../services/api/dist/demo.js';

const usage = `Usage: npm run demo:companies -- [--project PROJECT_ID --viewer-email EMAIL] [--apply]
Without --apply: preview fictional records locally; no cloud access.
With --apply: add the demo to the named project for an existing, verified Firebase account.
Existing records are never overwritten. No emails, invitations, Auth users, or calls are created.`;

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, 'viewer-email': { type: 'string' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log(usage); return; }
  const projectId = values.project?.trim();
  const email = values['viewer-email']?.trim().toLowerCase();
  if (values.apply && (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !email?.includes('@'))) {
    throw new Error(`--apply requires an explicit project ID and viewer email.\n${usage}`);
  }
  let data = buildDemoData(new Date());
  console.table(data.organizations.map((o) => ({
    Company: o.name,
    Employees: data.memberships.filter((m) => m.orgId === o.id).length,
    Patients: data.residents.filter((r) => r.orgId === o.id).length,
  })));
  console.log(`${data.calls.length} fictional completed calls; ${data.cases.length} sample cases. All patients are synthetic, with no dialable numbers.`);
  if (!values.apply) {
    console.log('Preview only. No cloud access or writes. See docs/DEMO_COMPANIES.md to add these records to a hosted demo.');
    return;
  }
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { seedDemoCompanies } = await import('../services/api/dist/demo-seed.js');
  const app = initializeApp({ projectId });
  try {
    const viewer = await getAuth(app).getUserByEmail(email);
    if (viewer.disabled || !viewer.emailVerified) throw new Error('The viewer must be an existing, enabled Firebase account with a verified email.');
    data = buildDemoData(new Date(), { uid: viewer.uid, email,
      ...(viewer.displayName ? { name: viewer.displayName } : {}) });
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    const result = await seedDemoCompanies(db, data);
    console.log(`${projectId}: created ${result.created} demo records; preserved ${result.preserved} existing records.`);
    console.log(`${email} can select the three demo companies in Hachi. Their existing organizations are unchanged.`);
    console.log('Demo companies remain unverified; no outbound contact is enabled. Fictional employees are directory entries, not sign-in accounts.');
  } finally { await deleteApp(app); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
