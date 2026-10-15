// Default: entirely local, synthetic inputs and in-memory transport. --publish explicitly sends
// the same synthetic events to an existing Pub/Sub topic using Application Default Credentials.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { hash } from '../services/analytics/dist/events.js';
import { exportCalls } from '../services/analytics/dist/worker.js';

const { values } = parseArgs({ options: { publish: { type: 'boolean', default: false },
  project: { type: 'string' }, topic: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('npm run demo:analytics [-- --publish --project PROJECT --topic TOPIC]\nDefault: no cloud access or real calls. --publish sends synthetic events only.');
  process.exit(0);
}
if (values.publish && (!values.project || !values.topic)) throw new Error('--publish requires explicit --project and --topic');
if (!values.publish && (values.project || values.topic)) throw new Error('Use --publish to send synthetic events to a cloud topic');

const now = new Date();
const date = now.toISOString().slice(0, 10);
const startedAt = `${date}T00:00:00.000Z`;
const orgId = 'hachi-analytics-demo';
const complete = { at: now.toISOString(), turns: 0,
  intake: { date, status: 'normal' }, memory: { topics: [], plans: [], likes: [] } };
const revision = (time) => `${String(Math.floor(time / 1000)).padStart(12, '0')}.${String(time % 1000 * 1e6).padStart(9, '0')}`;
const make = (name, changes = {}) => ({ orgId, synthetic: true, revision: revision(now.getTime()), updatedAt: now.toISOString(),
  call: { id: `${date}-${name}`, residentId: `synthetic-${name}`, source: 'live', synthetic: true,
    status: 'completed', channel: 'pstn', startedAt, endedAt: `${date}T00:02:00.000Z`,
    createdAt: startedAt, durationSec: 120, analysisPending: false, analysis: complete, ...changes } });
const snapshots = [
  make('normal'),
  make('unanswered', { status: 'no_answer', durationSec: undefined }),
  make('technical-failure', { status: 'failed', durationSec: undefined }),
  make('silence', { conversation: { at: startedAt, endedBy: 'silent_after_greeting', noResponseEscalated: true } }),
  make('pending', { analysisPending: true, analysis: undefined }),
  make('partial', { analysis: { ...complete, incomplete: [{ part: 'voice', failure: 'recording_missing' }] } }),
  make('historical-import', { source: 'imported' }),
  make('ongoing', { status: 'in_progress' }),
];
const receipts = new Map();
const events = [];
const source = {
  cursor: async () => null,
  saveCursor: async () => {},
  page: async () => ({ snapshots, next: null }),
  published: async (key) => receipts.get(key) ?? null,
  markPublished: async (key, value) => { receipts.set(key, value); },
};
const deps = { source, publisher: { publish: async (event) => { events.push(event); } }, now: () => now,
  settings: { orgIds: [orgId], includeRealData: false, lookbackDays: 30, pageSize: 100, maxPages: 5 } };
console.log('Hachi analytics demo — SYNTHETIC DATA ONLY');
console.log(values.publish ? 'Local checks first; then publish the synthetic messages to Google Cloud.'
  : 'Local simulation: no Google Cloud connection, phone calls, messages to people, or production changes.');
const first = await exportCalls(deps);
assert.equal(first.published, 6); assert.equal(first.excluded, 2);
const second = await exportCalls(deps);
assert.equal(second.published, 0);
const pending = events.find((e) => e.analysis_state === 'pending');
snapshots[4].call.analysisPending = false;
snapshots[4].call.analysis = complete;
snapshots[4].revision = revision(now.getTime() + 1);
snapshots[4].updatedAt = new Date(now.getTime() + 1).toISOString();
assert.equal((await exportCalls(deps)).published, 1);
// Mimic at-least-once delivery: an older pending event arrives again after its completed update.
const delivery = [...events, pending, pending];
const latest = new Map();
for (const e of delivery) {
  const before = latest.get(e.call_key);
  if (!before || `${e.source_revision}:${e.event_id}` > `${before.source_revision}:${before.event_id}`) latest.set(e.call_key, e);
}
const calls = [...latest.values()];
assert.equal(calls.length, 6);
assert.equal(calls.filter((e) => e.analysis_state === 'pending').length, 0);
assert.equal(calls.filter((e) => e.analysis_state === 'partial').length, 1);
assert(calls.every((e) => e.synthetic));
console.log(`First export: ${first.published} calls; imported/ongoing excluded: ${first.excluded}.`);
console.log('Repeat export: 0 new events. Analysis completion: 1 update. Two delayed duplicates do not change the totals.');
console.table([{
  'Call attempts': calls.length,
  Completed: calls.filter((e) => e.status === 'completed').length,
  Unanswered: calls.filter((e) => e.status === 'no_answer').length,
  Failed: calls.filter((e) => e.status === 'failed').length,
  'Analysis pending': 0, 'Analysis partial': 1,
  'In-call emergency flags': calls.filter((e) => e.emergency_flagged).length,
}]);
const organizationKey = hash(['hachi-organization-v1', orgId]);
console.log(`Demo organization_key: ${organizationKey}`);
console.log('PASS: export, deduplication, out-of-order updates, and synthetic-data checks.');
console.log('The local report simulates the BigQuery views; it does not execute BigQuery SQL.');

if (values.publish) {
  const { PubSub } = await import('@google-cloud/pubsub');
  const { PubSubEventPublisher, publisherOptions } = await import('../services/analytics/dist/publisher.js');
  const pubsub = new PubSub({ projectId: values.project });
  const topic = pubsub.topic(values.topic, publisherOptions);
  const publisher = new PubSubEventPublisher(topic);
  try {
    for (const event of delivery) {
      assert.equal(event.synthetic, true);
      assert.equal(event.organization_key, organizationKey);
      await publisher.publish(event);
    }
    console.log(`${delivery.length} synthetic messages accepted by ${values.project}/${values.topic}.`);
    console.log('Verify BigQuery delivery using the query in docs/ANALYTICS.md. Pub/Sub acceptance alone is not delivery confirmation.');
  } finally {
    await topic.flush();
    await pubsub.close();
  }
}
