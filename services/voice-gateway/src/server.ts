import { CloudTasksClient } from '@google-cloud/tasks';
import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';
import { analysisTask, CloudTasksQueue } from '@hachi/cloud';
import { FirestoreStore } from '@hachi/store';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { EmergencyService } from './emergency.js';
import { GeminiLiveConnector } from './live.js';
import type { RecordingSink } from './session.js';

const config = loadConfig(process.env);

// All Google credentials come from the Cloud Run service account (Application Default Credentials).
const db = getFirestore(initializeApp());
db.settings({ ignoreUndefinedProperties: true });
const store = new FirestoreStore(db);

const bucket = new Storage().bucket(config.recordingsBucket);
const recordings: RecordingSink = {
  async save(path, wav) {
    await bucket.file(path).save(wav, { contentType: 'audio/wav', resumable: false });
    return `gs://${bucket.name}/${path}`;
  },
};

const ai = new GoogleGenAI({ enterprise: true, project: config.project, location: config.gemini.location });
const tasks = new CloudTasksClient();
const taskQueue = (queue: string, targetBaseUrl: string) =>
  new CloudTasksQueue(tasks, {
    project: config.project,
    location: config.tasks.location,
    queue,
    targetBaseUrl,
    serviceAccountEmail: config.tasks.invokerServiceAccount,
  });

const app = buildApp({
  store,
  live: new GeminiLiveConnector(ai, config.gemini.model, config.gemini.voice),
  emergency: new EmergencyService({
    store,
    queue: taskQueue(config.tasks.emergencyQueue, config.telephonyBaseUrl),
    ...(config.notifierBaseUrl ? { notifications: taskQueue(config.tasks.notifyQueue, config.notifierBaseUrl) } : {}),
    appBaseUrl: config.appBaseUrl,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }),
  recordings,
  ...(config.analyzerBaseUrl
    ? {
        analysis: {
          request: (residentId: string, callId: string, key: string) =>
            taskQueue(config.tasks.analysisQueue, config.analyzerBaseUrl!).enqueue(
              // A minute later, so a reconnected stream can add its turns before the review.
              analysisTask(residentId, callId, key, new Date(Date.now() + 60_000)),
            ).then(() => undefined),
        },
      }
    : {}),
  config: {
    maxConversationSec: config.maxConversationSec,
    silence: config.silence,
    ...(config.forcedLiveDrop ? { forcedLiveDrop: config.forcedLiveDrop } : {}),
  },
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
