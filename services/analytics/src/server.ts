import { PubSub } from '@google-cloud/pubsub';
import { GoogleOidcVerifier } from '@hachi/cloud';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { FirestoreAnalyticsSource } from './firestore.js';
import { PubSubEventPublisher, publisherOptions } from './publisher.js';

const config = loadConfig(process.env);
const db = getFirestore(initializeApp({ projectId: config.project }));
const pubsub = new PubSub({ projectId: config.project });
const topic = pubsub.topic(config.topic, publisherOptions);
const app = buildApp({ source: new FirestoreAnalyticsSource(db, config.topic),
  publisher: new PubSubEventPublisher(topic), settings: config, now: () => new Date(),
  verifier: new GoogleOidcVerifier(new OAuth2Client(), config.publicBaseUrl, config.allowedCallers), logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void app.close().then(() => topic.flush()).then(() => pubsub.close()).then(() => process.exit(0)); });
}
