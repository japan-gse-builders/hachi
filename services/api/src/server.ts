import { CloudTasksClient } from '@google-cloud/tasks';
import { CloudTasksQueue } from '@hachi/cloud';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { buildApp } from './app.js';
import { FirebaseTokenVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { GcsMediaSigner } from './gcs.js';
import { FirestoreStore } from '@hachi/store';

const config = loadConfig(process.env);

// Credentials come from the Cloud Run service account (Application Default Credentials).
const firebase = initializeApp();
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });

const app = buildApp({
  store: new FirestoreStore(db),
  verifier: new FirebaseTokenVerifier(getAuth(firebase)),
  signer: new GcsMediaSigner(getStorage(firebase), config.recordingsBucket),
  corsOrigins: config.corsOrigins,
  spend: config.spend,
  gateway: config.gateway,
  ...(config.calls
    ? {
        calls: {
          queue: new CloudTasksQueue(new CloudTasksClient(), {
            project: config.calls.project,
            location: config.calls.location,
            queue: config.calls.queue,
            // The telephony service checks the token's audience against its own URL.
            targetBaseUrl: config.calls.telephonyBaseUrl,
            serviceAccountEmail: config.calls.invokerServiceAccount,
          }),
          cooldownMs: config.calls.cooldownMs,
        },
      }
    : {}),
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
