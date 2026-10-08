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
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
