// Gives the demo residents (demo-*, synthetic) and test residents (test-*) already in Firestore the
// made-up names from services/analyzer/eval/demo-names.json, as seed-demo.ts and
// seed-test-resident.mjs now create them. Cases and calls keep their resident IDs, so nothing else
// changes. Prints the changes only, unless --apply is given.
// Usage: node infra/rename-demo-residents.mjs <project-id> [--apply]
// Requires `gcloud auth application-default login`.
import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const [projectId, flag] = process.argv.slice(2);
if (!projectId || (flag !== undefined && flag !== '--apply')) {
  console.error('Usage: node infra/rename-demo-residents.mjs <project-id> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const names = JSON.parse(await readFile(new URL('../services/analyzer/eval/demo-names.json', import.meta.url), 'utf8'));
const db = getFirestore(initializeApp({ projectId }));
const now = new Date().toISOString();

const withPrefix = async (prefix) =>
  (await db.collection('residents').where(FieldPath.documentId(), '>=', prefix).where(FieldPath.documentId(), '<', `${prefix.slice(0, -1)}.`).get()).docs;

const changes = [];
for (const doc of await withPrefix('demo-')) {
  const r = doc.data();
  const demo = names.residents[doc.id.slice('demo-'.length)];
  if (r.synthetic !== true || !demo) continue;
  changes.push({ doc, from: r.name, update: { name: demo.name, householdNotes: demo.householdNotes, ...(r.staff ? { 'staff.name': names.staff } : {}) } });
}
(await withPrefix('test-')).forEach((doc, i) => {
  const r = doc.data();
  const name = names.testResidents[i % names.testResidents.length];
  const surname = name.split(' ').at(-1);
  changes.push({
    doc,
    from: r.name,
    update: { name, ...(r.staff ? { 'staff.name': names.staff } : {}), ...(r.family ? { 'family.name': `Emma ${surname}` } : {}) },
  });
});

for (const { doc, from, update } of changes) {
  console.log(`${doc.id}: ${from} -> ${update.name}`);
  if (apply) await doc.ref.update({ ...update, updatedAt: now });
}
console.log(apply ? `renamed ${changes.length} resident(s)` : `${changes.length} resident(s) would be renamed; run again with --apply`);
