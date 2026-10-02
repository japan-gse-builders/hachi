import { CloudTasksClient } from '@google-cloud/tasks';
import { CloudTasksQueue, GoogleOidcVerifier } from '@hachi/cloud';
import { FirestoreStore } from '@hachi/store';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { OAuth2Client } from 'google-auth-library';
import { buildApp } from './app.js';
import { FcmPush, SendGridEmail, TwilioSms, TwilioVoiceAlert, type Senders } from './channels.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);

// Google credentials come from the Cloud Run service account (Application Default Credentials).
const firebase = initializeApp();
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });
const messaging = getMessaging(firebase);

const senders: Senders = {
  sms: new TwilioSms({ ...config.twilio, from: config.twilio.smsFrom, allowedPrefixes: config.smsAllowedPrefixes }),
  voice: new TwilioVoiceAlert({ ...config.twilio, from: config.twilio.voiceFrom, sayVoice: config.sayVoice }),
  push: new FcmPush((m) => messaging.send(m)),
  ...(config.email ? { email: new SendGridEmail(config.email) } : {}),
};

const app = buildApp({
  store: new FirestoreStore(db),
  senders,
  queue: new CloudTasksQueue(new CloudTasksClient(), {
    project: config.tasks.project,
    location: config.tasks.location,
    queue: config.tasks.queue,
    targetBaseUrl: config.publicBaseUrl,
    serviceAccountEmail: config.tasks.invokerServiceAccount,
  }),
  verifier: new GoogleOidcVerifier(new OAuth2Client(), config.publicBaseUrl, config.allowedCallers),
  now: () => new Date(),
  config,
  logger: true,
});

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
