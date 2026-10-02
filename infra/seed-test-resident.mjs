// Registers a fresh test resident whose daily call is a couple of minutes from now, so the
// deployed pipeline places a real call end to end. Each resident is called at most once a day,
// so every run creates a new resident and deactivates the previous test residents.
// Usage: node infra/seed-test-resident.mjs <project-id> <phone E.164> [HH:mm|now] [family phone E.164]
// The family phone receives emergency SMS and alert calls (a Verified Caller ID on a Twilio trial).
// Requires `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const E164 = /^\+[1-9]\d{6,14}$/;
const usage = 'Usage: node infra/seed-test-resident.mjs <project-id> <phone E.164> [HH:mm|now] [family phone E.164]';
const [projectId, phone, time, familyPhone] = process.argv.slice(2);
if (!projectId || !E164.test(phone ?? '') || (familyPhone && !E164.test(familyPhone)) || (time && time !== 'now' && !/^\d{2}:\d{2}$/.test(time))) {
  console.error(usage);
  process.exit(1);
}

const timeZone = 'Asia/Tokyo';
const local = (d, opts) => new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', ...opts }).format(d);
const callTime = time && time !== 'now' ? time : local(new Date(Date.now() + 2 * 60_000), { hour: '2-digit', minute: '2-digit' });
const stamp = local(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\D/g, '');
const id = `test-${stamp}`;

const db = getFirestore(initializeApp({ projectId }));
const now = new Date().toISOString();

const previous = await db.collection('residents').where('name', '==', 'Test Resident').where('active', '==', true).get();
for (const doc of previous.docs) await doc.ref.update({ active: false, updatedAt: now });
if (!previous.empty) console.log(`deactivated ${previous.size} earlier test resident(s): ${previous.docs.map((d) => d.id).join(', ')}`);

await db.collection('residents').doc(id).create({
  id,
  name: 'Test Resident',
  preferredName: 'there',
  phone,
  channel: 'pstn',
  callTime,
  timeZone,
  vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
  staff: { name: 'Test Staff', phone },
  ...(familyPhone ? { family: { name: 'Test Family', sms: familyPhone, voice: familyPhone } } : {}),
  familyLookup: familyPhone ? [familyPhone] : [],
  serviceStartedAt: now,
  active: true,
  createdAt: now,
  updatedAt: now,
});
console.log(`${id} will be called at ${callTime} (${timeZone}) on ${phone}`);
if (familyPhone) console.log(`family contact (SMS + alert call): ${familyPhone}`);
