/**
 * Registers SYNTHETIC demo residents built from the R3 evaluation scenario, so the staff queue
 * shows real R3 cases with playable evidence. Each call is uploaded to the recordings bucket and
 * analysed in date order by the production worker (`analyzeCall`), exactly as live calls are.
 * Dates are shifted so the last call is today. Residents are paused (no calls are placed) and have
 * no contact details, so nobody is called or notified. Everything is marked `synthetic: true`.
 * Names and household notes are made up (`demo-names.json`). Gemini results cached by `eval:r3`
 * are reused.
 *
 *   npm run seed:demo -w @hachi/analyzer -- --org <orgId> [--seed 2026] [--people syn-c1,syn-c2,syn-s1] [--dry-run] [--reset]
 *     [--family-login-of <residentId>]
 *
 * --org is the organization whose staff will see the demo residents.
 *
 * --reset first deletes those demo residents (only if marked synthetic) with their calls, cases
 * and recordings, so the demo can be rebuilt with today's dates and current code.
 *
 * --family-login-of lets the family emails of that resident open the demo family dashboards. Only
 * `familyLookup` is set, never `family`, because notifications go to `family`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import type { TaskQueue } from '@hachi/cloud';
import { FirestoreStore, type CallRecord, type Resident } from '@hachi/store';
import { parseSpendSettings } from '@hachi/core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { formatTranscript, GeminiReviewer, reviewInstruction, type CallReviewer, type ModelReview, type ReviewInput } from '../src/model.js';
import { GeminiListener, LISTENING_INSTRUCTION, type ListeningReview, type RecordingSource, type SpeechListener } from '../src/voice.js';
import { analyzeCall, type WorkerDeps } from '../src/worker.js';
import { mixCall, trimSilence, type Clip } from './mix.js';
import { generateScenario, HACHI_VOICE, hashSeed, type PersonProfile, type ScriptedCall } from './scenario.js';
import { CloudTts, TTS_SAMPLE_RATE } from './tts.js';

const { values: args } = parseArgs({
  options: {
    seed: { type: 'string', default: '2026' },
    people: { type: 'string', default: 'syn-c1,syn-c2,syn-s1' },
    'dry-run': { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    'family-login-of': { type: 'string' },
    org: { type: 'string' },
  },
});
const orgId: string = args.org?.trim() ?? '';
if (!orgId) throw new Error('Pass --org <organization id>: the demo residents belong to that organization’s staff');

const CACHE = join(import.meta.dirname, '.cache');
const demoNames = JSON.parse(await readFile(join(import.meta.dirname, 'demo-names.json'), 'utf8')) as {
  staff: string;
  residents: Record<string, { name: string; householdNotes: string }>;
};
const project = process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'hachicall-nao';
const bucket = process.env.RECORDINGS_BUCKET?.trim();
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const appBaseUrl = process.env.APP_BASE_URL?.trim() || 'https://hachicall.web.app';
if (!bucket) throw new Error('Set RECORDINGS_BUCKET to the recordings bucket');
const seed = Number(args.seed);
const DAY = 86_400_000;

const sha = (...parts: (string | Buffer)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};

async function cached<T>(file: string, compute: () => Promise<T>): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    const value = await compute();
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }
}

class CachedListener implements SpeechListener {
  constructor(private readonly inner: SpeechListener) {}
  get model() {
    return this.inner.model;
  }
  listen(wav: Buffer): Promise<ListeningReview> {
    return cached(join(CACHE, 'gemini', `listen-${sha(this.inner.model, LISTENING_INSTRUCTION, wav)}.json`), () => this.inner.listen(wav));
  }
}

class CachedReviewer implements CallReviewer {
  constructor(private readonly inner: CallReviewer) {}
  get model() {
    return this.inner.model;
  }
  review(input: ReviewInput): Promise<ModelReview> {
    const key = sha(this.inner.model, reviewInstruction(input.staffLocale), formatTranscript(input.preferredName, input.transcript));
    return cached(join(CACHE, 'gemini', `review-${key}.json`), () => this.inner.review(input));
  }
}

const tts = new CloudTts(join(CACHE, 'tts'), project);

async function render(call: ScriptedCall, profile: PersonProfile) {
  const clips: Clip[] = [];
  for (const t of call.turns) {
    const pcm = t.speaker === 'agent' ? await tts.synth(HACHI_VOICE, t.spoken, 1) : await tts.synth(profile.voice, t.spoken, profile.speakingRate);
    clips.push({ speaker: t.speaker, pcm: trimSilence(pcm, TTS_SAMPLE_RATE), gapBeforeMs: t.gapBeforeMs, text: t.text });
  }
  return mixCall(clips, { sampleRate: TTS_SAMPLE_RATE, noiseSeed: hashSeed(seed, call.id, 'noise') });
}

const firebase = initializeApp({ projectId: project });
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });
const store = new FirestoreStore(db);
const objects = getStorage(firebase).bucket(bucket);
const wavs = new Map<string, Buffer>();
const recordings: RecordingSource = {
  read: async (uri) => {
    const wav = wavs.get(uri);
    if (!wav) throw new Error(`Recording not rendered: ${uri}`);
    return wav;
  },
};
const noQueue: TaskQueue = { enqueue: async () => 'created' };
const ai = new GoogleGenAI({ enterprise: true, project, location: process.env.GEMINI_LOCATION?.trim() || 'global' });
const deps: WorkerDeps = {
  store,
  reviewer: new CachedReviewer(new GeminiReviewer(ai, model)),
  listener: new CachedListener(new GeminiListener(ai, model)),
  recordings,
  queue: noQueue,
  now: () => new Date(),
  newId: randomUUID,
  config: { leaseSec: 300, settleSec: 0, modelAttempts: 3, staffLocale: 'en', appBaseUrl, spend: parseSpendSettings(process.env) },
};

const wanted = args.people.split(',').map((s) => s.trim());
const scenario = generateScenario(seed);
const people = scenario.people.filter((p) => wanted.includes(p.profile.id));
if (people.length !== wanted.length) throw new Error(`Unknown people in --people; known: ${scenario.people.map((p) => p.profile.id).join(', ')}`);
const unnamed = wanted.filter((id) => !demoNames.residents[id]);
if (unnamed.length) throw new Error(`No demo name for ${unnamed.join(', ')} in demo-names.json`);

// Last call today at the scenario's time of day; whole days so local dates stay consistent.
const lastCall = Math.max(...people.flatMap((p) => p.calls.map((c) => Date.parse(c.startedAt))));
const today = new Date();
const shift = Math.floor((today.getTime() - lastCall) / DAY) * DAY;
const shifted = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
const serviceStartedAt = shifted(scenario.serviceStartedAt);

let familyLogins: string[] = [];
if (args['family-login-of']) {
  const owner = await store.getResident(args['family-login-of']);
  if (!owner) throw new Error(`No resident ${args['family-login-of']}`);
  familyLogins = owner.familyLookup.filter((c) => c.includes('@'));
  if (familyLogins.length === 0) throw new Error(`${owner.id} has no family email to reuse`);
  console.log(`demo family dashboards open to ${familyLogins.length} family email(s) of ${owner.id}`);
}

async function seedPerson({ profile: p, calls }: (typeof people)[number]): Promise<void> {
  const residentId = `demo-${p.id}`;
  const existing = await store.getResident(residentId);
  if (existing && args.reset) {
    if (!existing.synthetic) throw new Error(`${residentId} is not marked synthetic; refusing to delete it`);
    const cases = await db.collection('cases').where('residentId', '==', residentId).get();
    console.log(`${residentId}: ${args['dry-run'] ? 'would delete' : 'deleting'} resident, its calls, ${cases.size} case(s) and recordings`);
    if (!args['dry-run']) {
      for (const c of cases.docs) {
        const outbox = await db.collection('outbox').where('caseId', '==', c.id).get();
        await Promise.all(outbox.docs.map((o) => o.ref.delete()));
        await db.recursiveDelete(c.ref);
      }
      await db.recursiveDelete(db.collection('residents').doc(residentId));
      await objects.deleteFiles({ prefix: `synthetic-demo/${residentId}/` });
    }
  } else if (existing) {
    console.log(`${residentId} already exists; skipped (delete it first to re-seed)`);
    return;
  }
  const named = demoNames.residents[p.id]!;
  const resident: Resident = {
    id: residentId,
    name: named.name,
    preferredName: p.name,
    phone: '',
    channel: 'pstn',
    callTime: '10:00',
    timeZone: 'Asia/Tokyo',
    vulnerability: { livesAlone: true, hasCloseSupporter: false, needsCare: false, chronicConditions: [] },
    householdNotes: named.householdNotes,
    staff: { name: demoNames.staff, phone: '' },
    orgId,
    // As family access, so the API keeps them whenever it recomputes `familyLookup`.
    familyAccess: familyLogins.filter((c) => c.includes('@')).map((email) => ({ email, addedAt: serviceStartedAt, addedBy: 'seed-demo' })),
    familyLookup: familyLogins,
    serviceStartedAt,
    active: false,
    synthetic: true,
    createdAt: serviceStartedAt,
    updatedAt: new Date().toISOString(),
  };
  console.log(`${residentId}: ${named.name}, ${p.change} (${p.note}), ${calls.length} calls from ${calls[0]!.startedAt.slice(0, 10)} (+${shift / DAY} days)`);
  if (args['dry-run']) return;
  await store.createResident(resident);

  for (const sc of calls) {
    const mixed = await render(sc, p);
    const path = `synthetic-demo/${residentId}/${sc.id}.wav`;
    const audioUri = `gs://${bucket}/${path}`;
    await objects.file(path).save(mixed.wav, { contentType: 'audio/wav', resumable: false });
    wavs.set(audioUri, mixed.wav);
    const startedAt = shifted(sc.startedAt);
    const endedAt = new Date(Date.parse(startedAt) + mixed.durationMs).toISOString();
    const call: CallRecord = {
      id: sc.id,
      residentId,
      source: 'live',
      synthetic: true,
      status: 'completed',
      channel: 'pstn',
      startedAt,
      endedAt,
      durationSec: Math.round(mixed.durationMs / 1000),
      localDate: startedAt.slice(0, 10),
      audioUri,
      transcript: mixed.transcript,
      conversation: { endedBy: 'agent', at: endedAt },
      analysisPending: true,
      createdAt: startedAt,
    };
    await store.createCallIfAbsent(call);
    let result = await analyzeCall(deps, { residentId, callId: sc.id }, 0);
    for (let attempt = 1; result.outcome === 'retry' && attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      result = await analyzeCall(deps, { residentId, callId: sc.id }, attempt);
    }
    const saved = await store.getCall(residentId, sc.id);
    const f = saved?.speech?.features;
    console.log(
      `  ${p.name} day ${String(sc.day).padStart(2)} ${result.outcome}${'rules' in result && result.rules.length ? ` ${result.rules.join(',')}` : ''}` +
        (f ? ` latency ${f.responseLatencyMs ?? '-'} ms, repairs ${f.repairRate?.toFixed(1) ?? '-'}/100` : ''),
    );
  }
}

// People are independent; each person's calls stay in date order because their baseline builds on them.
await Promise.all(people.map(seedPerson));
console.log('done');
