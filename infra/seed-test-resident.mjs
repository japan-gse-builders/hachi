// Registers a fresh test resident whose daily call is a couple of minutes from now, so the
// deployed pipeline places a real call end to end. Each resident is called at most once a day,
// so every run creates a new resident and deactivates the previous test residents.
// Test residents get made-up names from services/analyzer/eval/demo-names.json, in order.
// Usage: node infra/seed-test-resident.mjs <project-id> --org <org-id> <phone E.164> [HH:mm|now] [family phone E.164]
// --org is the organization whose staff will see the resident (and its cases).
// The family phone receives emergency SMS and alert calls (a Verified Caller ID on a Twilio trial).
// Requires `gcloud auth application-default login`.
import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const E164 = /^\+[1-9]\d{6,14}$/;
const usage = 'Usage: node infra/seed-test-resident.mjs <project-id> --org <org-id> <phone E.164> [HH:mm|now] [family phone E.164]';
const args = process.argv.slice(2);
const orgFlag = args.indexOf('--org');
const orgId = orgFlag >= 0 ? args.splice(orgFlag, 2)[1] : undefined;
const [projectId, phone, time, familyPhone] = args;
if (!projectId || !orgId || !E164.test(phone ?? '') || (familyPhone && !E164.test(familyPhone)) || (time && time !== 'now' && !/^\d{2}:\d{2}$/.test(time))) {
  console.error(usage);
  process.exit(1);
}

const names = JSON.parse(await readFile(new URL('../services/analyzer/eval/demo-names.json', import.meta.url), 'utf8'));
const timeZone = 'Asia/Tokyo';
const local = (d, opts) => new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', ...opts }).format(d);
const callTime = time && time !== 'now' ? time : local(new Date(Date.now() + 2 * 60_000), { hour: '2-digit', minute: '2-digit' });
const stamp = local(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\D/g, '');
const id = `test-${stamp}`;

const db = getFirestore(initializeApp({ projectId }));
const now = new Date().toISOString();
const org = await db.collection('organizations').doc(orgId).get();
if (!org.exists) {
  console.error(`No organization ${orgId} in ${projectId}.`);
  process.exit(1);
}
if (!org.data().verifiedAt) {
  console.warn(`Note: ${orgId} is not verified, so Hachi will not ring this resident. See infra/verify-organization.mjs.`);
}

const earlier = await db.collection('residents').where(FieldPath.documentId(), '>=', 'test-').where(FieldPath.documentId(), '<', 'test.').get();
const previous = earlier.docs.filter((d) => d.data().active === true);
for (const doc of previous) await doc.ref.update({ active: false, updatedAt: now });
if (previous.length) console.log(`deactivated ${previous.length} earlier test resident(s): ${previous.map((d) => d.id).join(', ')}`);

const name = names.testResidents[earlier.size % names.testResidents.length];
const surname = name.split(' ').at(-1);
await db.collection('residents').doc(id).create({
  id,
  orgId,
  name,
  preferredName: 'there',
  phone,
  channel: 'pstn',
  callTime,
  timeZone,
  vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
  staff: { name: names.staff, phone },
  ...(familyPhone ? { family: { name: `Emma ${surname}`, sms: familyPhone, voice: familyPhone } } : {}),
  familyLookup: familyPhone ? [familyPhone] : [],
  serviceStartedAt: now,
  active: true,
  createdAt: now,
  updatedAt: now,
});
console.log(`${id} (${name}) will be called at ${callTime} (${timeZone}) on ${phone}`);
if (familyPhone) console.log(`family contact (SMS + alert call): ${familyPhone}`);
