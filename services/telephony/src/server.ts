import { CloudTasksClient } from '@google-cloud/tasks';
import { CloudTasksQueue, GoogleOidcVerifier } from '@hachi/cloud';
import { FirestoreStore } from '@hachi/store';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { TwilioVoice } from './twilio.js';

const config = loadConfig(process.env);

// Google credentials come from the Cloud Run service account (Application Default Credentials).
const firebase = initializeApp();
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });

const app = buildApp({
  store: new FirestoreStore(db),
  queue: new CloudTasksQueue(new CloudTasksClient(), {
    project: config.tasks.project,
    location: config.tasks.location,
    queue: config.tasks.callQueue,
    targetBaseUrl: config.publicBaseUrl,
    serviceAccountEmail: config.tasks.invokerServiceAccount,
  }),
  telephony: new TwilioVoice(config.twilio),
  verifier: new GoogleOidcVerifier(new OAuth2Client(), config.publicBaseUrl, config.allowedCallers),
  twilioAuthToken: config.twilio.authToken,
  config,
  now: () => new Date(),
  newToken: () => crypto.randomUUID(),
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
