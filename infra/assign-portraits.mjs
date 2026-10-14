// Gives residents that have no picture yet a grandfather or grandmother illustration, chosen by
// their first name, taking the five of each in turn so neighbours on the list differ. A picture
// staff have already chosen is kept, and a first name not in FIRST_NAMES is left for staff to pick.
// Prints the changes only, unless --apply is given.
// Usage: node infra/assign-portraits.mjs <project-id> [--apply]
// Requires `gcloud auth application-default login`.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FIRST_NAMES = {
  grandfather: [
    'Arthur', 'Frank', 'George', 'Harold', 'Henry', 'Kenji', 'Peter', 'Robert', 'Thomas', 'Walter',
  ],
  grandmother: [
    'Alice', 'Dorothy', 'Edith', 'Grace', 'Hana', 'Irene', 'Joan', 'Lillian', 'Margaret', 'Mary', 'Nora', 'Ruth',
  ],
};
const VARIANTS = 5;

const [projectId, flag] = process.argv.slice(2);
if (!projectId || (flag !== undefined && flag !== '--apply')) {
  console.error('Usage: node infra/assign-portraits.mjs <project-id> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const db = getFirestore(initializeApp({ projectId }));
const now = new Date().toISOString();

const kindOf = (name) => {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return Object.keys(FIRST_NAMES).find((kind) => FIRST_NAMES[kind].includes(first));
};

const docs = (await db.collection('residents').get()).docs.sort((a, b) => a.id.localeCompare(b.id));
const next = { grandfather: 0, grandmother: 0 };
const changes = [];
const unknown = [];
for (const doc of docs) {
  const r = doc.data();
  if (r.portrait) continue;
  const kind = kindOf(r.name);
  if (!kind) {
    unknown.push(doc);
    continue;
  }
  changes.push({ doc, name: r.name, portrait: `${kind}-${(next[kind]++ % VARIANTS) + 1}` });
}

for (const { doc, name, portrait } of changes) {
  console.log(`${doc.id}: ${name} -> ${portrait}`);
  if (apply) await doc.ref.update({ portrait, updatedAt: now });
}
for (const doc of unknown) console.log(`${doc.id}: ${doc.data().name} -> left as is (first name not listed)`);
console.log(apply ? `gave ${changes.length} resident(s) a picture` : `${changes.length} resident(s) would get a picture; run again with --apply`);
