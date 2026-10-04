import { randomUUID } from 'node:crypto';
import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleGenAI } from '@google/genai';
import { CloudTasksQueue, GoogleOidcVerifier } from '@hachi/cloud';
import { FirestoreStore } from '@hachi/store';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { OAuth2Client } from 'google-auth-library';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { GeminiReviewer } from './model.js';
import { GcsRecordings, GeminiListener } from './voice.js';

const config = loadConfig(process.env);

// Google credentials come from the Cloud Run service account (Application Default Credentials).
const firebase = initializeApp();
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });

const ai = new GoogleGenAI({ enterprise: true, project: config.project, location: config.gemini.location });
const tasks = new CloudTasksClient();
const queue = (name: string, targetBaseUrl: string) =>
  new CloudTasksQueue(tasks, {
    project: config.project,
    location: config.tasks.location,
    queue: name,
    targetBaseUrl,
    serviceAccountEmail: config.tasks.invokerServiceAccount,
  });

const app = buildApp({
  store: new FirestoreStore(db),
  reviewer: new GeminiReviewer(ai, config.gemini.model),
  recordings: new GcsRecordings(getStorage(firebase)),
  listener: new GeminiListener(ai, config.gemini.model),
  queue: queue(config.tasks.queue, config.publicBaseUrl),
  ...(config.notifierBaseUrl ? { notifications: queue(config.tasks.notifyQueue, config.notifierBaseUrl) } : {}),
  verifier: new GoogleOidcVerifier(new OAuth2Client(), config.publicBaseUrl, config.allowedCallers),
  now: () => new Date(),
  newId: randomUUID,
  config,
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
