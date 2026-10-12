// Local review harness only. No cloud credentials, real residents or outbound workers.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures } from './preview-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || 5190);
const requireFromRepo = createRequire(join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromRepo.resolve('vite')));
const { default: react } = await import(pathToFileURL(requireFromRepo.resolve('@vitejs/plugin-react')));
const { MemoryStore } = await import(pathToFileURL(join(root, 'packages/store/dist/index.js')));
const { PRIVACY_NOTICE, domainStates } = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')));
const { buildApp } = await import(pathToFileURL(join(root, 'services/api/dist/app.js')));
const { buildResident } = await import(pathToFileURL(join(root, 'services/api/dist/residents.js')));
const { residentInputSchema } = await import(pathToFileURL(join(root, 'services/api/dist/schemas.js')));

fixtures.queue.items.push({caseId: 'case-5', residentId: 'res-5', residentName: 'Edith (demo)', rule: 'R1', urgency: 'emergency', summary: 'Asked for immediate help during the call.'});

const verifier = {
  async verify(token) {
    if (token === 'demo-staff') return {uid: 'demo-staff', role: 'staff'};
    if (token === 'demo-family') return {uid: 'demo-family', email: 'family@example.invalid', emailVerified: true};
    throw new Error('Unknown local preview account');
  },
};

async function makeApi() {
  const store = new MemoryStore();
  const now = new Date();
  const at = new Date(now.getTime() - 30 * 60_000).toISOString();
  for (let i = 0; i < fixtures.queue.items.length; i++) {
    const item = fixtures.queue.items[i];
    const input = residentInputSchema.parse({
      name: item.residentName.replace('(synthetic)', '(demo)'),
      preferredName: item.residentName.split(' ')[0],
      phone: '+81900000000' + (i + 1),
      callTime: '10:00', timeZone: 'Asia/Tokyo',
      vulnerability: {livesAlone: i === 0, hasCloseSupporter: i !== 0, needsCare: i === 0, chronicConditions: i === 0 ? ['Arthritis (fictional)'] : []},
      householdNotes: 'Fictional resident for local testing.',
      staff: {name: 'Demo care team', phone: '+81300000000', email: 'staff@example.invalid'},
      family: {name: 'Demo family member', relationship: 'Daughter', email: 'family@example.invalid'},
      serviceStartedAt: new Date(now.getTime() - 35 * 86400_000).toISOString(),
      callConsent: {accepted: true, noticeVersion: PRIVACY_NOTICE.version},
    });
    const resident = {...buildResident(input, item.residentId, now, 'demo-staff'), synthetic: true};
    await store.createResident(resident);
    const calls = Array.from({length: 14}, (_, day) => {
      const startedAt = new Date(Date.parse(at) - day * 86400_000).toISOString();
      const foodId = day < 2 ? 'food.ate_little' : 'food.ate_well';
      const tags = [{id: foodId, turn: 1, basis: 'said', confidence: 0.9},
        {id: 'social.family_contact', turn: 3, basis: 'said', confidence: 0.9}];
      return {
        id: 'call-' + (day + 1), residentId: resident.id, source: 'imported', synthetic: true,
        status: 'completed', channel: 'pstn', startedAt,
        endedAt: new Date(Date.parse(startedAt) + 240_000).toISOString(), durationSec: 240,
        transcript: day < 2 ? fixtures.detail.calls[0].transcript : [
          {speaker: 'agent', text: 'How have your meals been today?', startMs: 0, endMs: 3000},
          {speaker: 'resident', text: 'I ate well today and enjoyed my lunch.', startMs: 4000, endMs: 8000},
          {speaker: 'agent', text: 'Has your family been in touch?', startMs: 9000, endMs: 12000},
          {speaker: 'resident', text: 'Yes, my daughter called yesterday.', startMs: 13000, endMs: 17000},
        ],
        summary: fixtures.detail.calls[0].summary, familySummary: fixtures.detail.calls[0].summary,
        wellbeing: {tags, domains: domainStates(tags.map(t => t.id)), headline: 'Enjoyed hearing from her daughter; still has little appetite.'},
        analysisPending: false, createdAt: startedAt,
      };
    });
    await store.addCalls(calls);
    await store.putCase({
      id: item.caseId, residentId: resident.id, rule: item.rule, autoUrgency: item.urgency,
      status: 'open', firstDetectedAt: at, updatedAt: at,
      detections: [{residentId: resident.id, rule: item.rule, urgency: item.urgency,
        confidence: 0.9, summary: item.summary, detectedAt: at,
        evidence: [{callId: 'call-1', quote: calls[0].transcript[1].text, startMs: 25000, endMs: 32000}]}],
      notifications: i === 0 ? [
        {recipient: 'staff', channel: 'email', address: 'staff@example.invalid', sentAt: at},
        {recipient: 'family', channel: 'email', address: 'family@example.invalid', sentAt: at},
      ] : [],
    });
  }
  const pending = residentInputSchema.parse({
    name: 'Claire (demo — approval needed)', preferredName: 'Claire', phone: '+819000000006',
    callTime: '10:00', timeZone: 'Asia/Tokyo',
    vulnerability: {livesAlone: false, hasCloseSupporter: true, needsCare: false, chronicConditions: []},
    staff: {name: 'Demo care team', phone: '+81300000000', email: 'staff@example.invalid'},
  });
  await store.createResident({...buildResident(pending, 'pending-1', now, 'demo-staff'), synthetic: true});
  const original = (await store.listCasesByResident('res-2'))[0];
  await store.putCase({...original, id: 'closed-case', status: 'closed', detections: [{...original.detections[0], summary: 'Earlier speech concern, now resolved.'}], outcome: {anomalyConfirmed: true, note: 'Fictional resolved case'}});
  return buildApp({store, verifier, signer: {sign: async () => {throw new Error('No recordings in the local preview');}}});
}

let api = await makeApi();
await api.ready();

const authPreview = `
export const authReady = true;
export const firebaseApp = null;
export const AuthProvider = ({children}) => children;
const noop = async () => {};
const token = async () => location.pathname.startsWith('/family') ? 'demo-family' : 'demo-staff';
export const useAuth = () => ({
 user: location.pathname === '/privacy' ? null : {email: 'demo@example.invalid', emailVerified: true},
 role: location.pathname.startsWith('/family') ? 'family' : 'staff', ready: true, token,
 signOut: async () => {location.href = '/privacy';}, confirmEmail: noop, signIn: noop,
 signInWithGoogle: noop, sendPasswordReset: noop, sendSignInLink: noop, finishSignInLink: noop,
 isSignInLink: () => false, storedLinkEmail: () => null,
});`;

const banner = `<aside style="padding:12px 20px;background:#dcebe1;color:#1f4d3a;font:16px/1.5 system-ui;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
<strong>Local demo · Fictional data · No calls or messages</strong>
<a href="/staff">Staff queue</a><a href="/staff/residents">Residents</a>
<a href="/family/residents/res-1">Family view</a><a href="/privacy">Privacy</a>
<button type="button" onclick="fetch('/__preview/reset',{method:'POST'}).then(r=>{if(r.ok)location.reload()})" style="font:inherit;padding:6px 12px">Reset demo</button></aside>`;

const server = await createServer({
  configFile: false, envDir: false, root: join(root, 'apps/web'),
  plugins: [{
    name: 'local-interactive-preview', enforce: 'pre',
    transform(_code, id) {if (id === join(root, 'apps/web/src/auth.tsx')) return authPreview;},
    transformIndexHtml(html) {return html.replace('<body>', '<body>' + banner);},
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = req.url || '/';
        if (url === '/__preview/reset' && req.method === 'POST') {
          await api.close(); api = await makeApi(); await api.ready();
          res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}'); return;
        }
        if (!url.startsWith('/api/') && url !== '/privacy-notice') return next();
        try {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 5 * 1024 * 1024) {res.writeHead(413); res.end(); return;}
            chunks.push(chunk);
          }
          const result = await api.inject({method: req.method, url, headers: req.headers,
            ...(chunks.length ? {payload: Buffer.concat(chunks)} : {})});
          res.writeHead(result.statusCode, result.headers); res.end(result.rawPayload);
        } catch (error) {
          console.error(error);
          res.writeHead(500, {'content-type': 'application/json'}); res.end('{"error":"Local preview error"}');
        }
      });
    },
  }, react()],
  server: {host: '127.0.0.1', port, strictPort: true, fs: {allow: [root]}},
});
await server.listen();
console.log('Hachi interactive preview: http://127.0.0.1:' + port);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  await server.close(); await api.close(); process.exit(0);
});
