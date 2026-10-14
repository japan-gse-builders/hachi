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

fixtures.queue.items.push({caseId: 'case-5', residentId: 'res-5', residentName: 'Edith Carter', rule: 'R1', urgency: 'emergency', summary: 'Asked for immediate help during the call.'});

const verifier = {
  async verify(token) {
    if (token === 'demo-staff') return {uid: 'demo-staff', email: 'demo@example.invalid', emailVerified: true, name: 'Aiko Tanaka', authTime: Math.floor(Date.now() / 1000)};
    if (token === 'demo-family') return {uid: 'demo-family', email: 'family@example.invalid', emailVerified: true};
    throw new Error('Unknown local preview account');
  },
};

const demoStaff = {uid: 'demo-staff', email: 'demo@example.invalid', name: 'Aiko Tanaka'};
const PORTRAIT_BY_NAME = {
  'Margaret Ellis': 'grandmother-2', 'Arthur Nakamura': 'grandfather-1', 'Dorothy Ishii': 'grandmother-1',
  'Harold Brooks': 'grandfather-4', 'Edith Carter': 'grandmother-3',
};
const portraitOf = (name) => PORTRAIT_BY_NAME[name];

const ORG = 'org-sakura';

/** The demo account owns one organization and helps out at a second, so the switcher shows. */
function seedAccounts(store, now) {
  const joined = new Date(now.getTime() - 60 * 86400_000).toISOString();
  // The internal organization is verified; the trial one is not, so its calls and alerts are off.
  const org = (id, name, plan) => ({
    id, name, timeZone: 'Asia/Tokyo', status: 'active',
    ...(plan === 'internal' ? {verifiedAt: joined, verifiedBy: 'migration'} : {}),
    billing: {plan, email: 'billing@example.invalid', limits: plan === 'internal' ? {residents: 1000, members: 200} : {residents: 20, members: 10}},
    createdAt: joined, createdBy: 'demo-staff', updatedAt: joined,
  });
  const member = (orgId, uid, email, name, role) => ({orgId, uid, email, name, role, status: 'active', joinedAt: joined, updatedAt: joined});
  store.seedAccounts({
    organizations: [org(ORG, 'Sakura Home Care', 'internal'), org('org-midori', 'Midori Day Service', 'trial')],
    memberships: [
      member(ORG, 'demo-staff', 'demo@example.invalid', 'Aiko Tanaka', 'owner'),
      member(ORG, 'demo-colleague', 'colleague@example.invalid', 'Yuki Sato', 'member'),
      member(ORG, 'demo-nurse', 'nurse@example.invalid', 'Kenji Mori', 'admin'),
      member('org-midori', 'demo-staff', 'demo@example.invalid', 'Aiko Tanaka', 'admin'),
    ],
  });
}

async function makeApi() {
  const store = new MemoryStore();
  const now = new Date();
  const at = new Date(now.getTime() - 30 * 60_000).toISOString();
  seedAccounts(store, now);
  for (let i = 0; i < fixtures.queue.items.length; i++) {
    const item = fixtures.queue.items[i];
    const input = residentInputSchema.parse({
      name: item.residentName,
      preferredName: item.residentName.split(' ')[0],
      portrait: portraitOf(item.residentName),
      phone: '+81900000000' + (i + 1),
      callTime: '10:00', timeZone: 'Asia/Tokyo',
      vulnerability: {livesAlone: i === 0, hasCloseSupporter: i !== 0, needsCare: i === 0, chronicConditions: i === 0 ? ['Arthritis'] : []},
      householdNotes: i === 0 ? 'Lives alone. Daughter Sarah phones from overseas on weekends.' : 'A neighbor looks in most days.',
      staff: {name: 'Aiko Tanaka', phone: '+81300000000', email: 'staff@example.invalid'},
      family: {name: 'Sarah ' + item.residentName.split(' ').at(-1), relationship: 'Daughter', email: 'family@example.invalid'},
      serviceStartedAt: new Date(now.getTime() - 35 * 86400_000).toISOString(),
      callConsent: {accepted: true, noticeVersion: PRIVACY_NOTICE.version},
    });
    // One resident belongs to a colleague, so the read-only view can be tried too.
    const owner = i === 2 ? {uid: 'demo-colleague', email: 'colleague@example.invalid', name: 'Yuki Sato'} : demoStaff;
    const resident = {...buildResident(input, item.residentId, ORG, now, owner), synthetic: true};
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
      id: item.caseId, orgId: ORG, residentId: resident.id, rule: item.rule, autoUrgency: item.urgency,
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
    name: 'Claire Watanabe', preferredName: 'Claire', portrait: 'grandmother-4', phone: '+819000000006',
    callTime: '10:00', timeZone: 'Asia/Tokyo',
    vulnerability: {livesAlone: false, hasCloseSupporter: true, needsCare: false, chronicConditions: []},
    staff: {name: 'Aiko Tanaka', phone: '+81300000000', email: 'staff@example.invalid'},
  });
  // Nobody responsible yet, as residents registered before ownership existed can be.
  const {owner: _unassigned, ...pendingResident} = buildResident(pending, 'pending-1', ORG, now, demoStaff);
  await store.createResident({...pendingResident, synthetic: true});
  // Margaret has a second open case under another rule, so the queue shows her once with both.
  const meals = (await store.listCasesByResident('res-1'))[0];
  await store.putCase({...meals, id: 'case-1-speech', rule: 'R3', autoUrgency: 'watch', notifications: [],
    detections: [{...meals.detections[0], rule: 'R3', urgency: 'watch', summary: 'Pausing more than usual between words.'}]});
  const original = (await store.listCasesByResident('res-2'))[0];
  await store.putCase({...original, id: 'closed-case', status: 'closed', detections: [{...original.detections[0], summary: 'Earlier speech concern, now resolved.'}], outcome: {anomalyConfirmed: true, note: 'Spoke with her son; she is sleeping better now.'}});
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
const staffUser = {uid: 'demo-staff', email: 'demo@example.invalid', emailVerified: true, providerData: [{providerId: 'password'}]};
const staffToken = async () => 'demo-staff';
const signOut = async () => {location.href = '/privacy';};
export const useStaffSession = () => ({user: staffUser, ready: true, token: staffToken, signOut});
export const useAuth = () => ({
 user: location.pathname === '/privacy' ? null : location.pathname.startsWith('/family') ? {uid: 'demo-family', email: 'family@example.invalid', emailVerified: true} : staffUser,
 role: location.pathname.startsWith('/family') ? 'family' : 'staff', ready: true, token,
 signOut, confirmEmail: noop, signIn: noop,
 signInWithGoogle: noop, sendPasswordReset: noop, sendSignInLink: noop, finishSignInLink: noop,
 isSignInLink: () => false, storedLinkEmail: () => null,
 hasPassword: true, changePassword: noop, reloadUser: noop,
});`;

const server = await createServer({
  configFile: false, envDir: false, root: join(root, 'apps/web'),
  plugins: [{
    name: 'local-interactive-preview', enforce: 'pre',
    transform(_code, id) {if (id === join(root, 'apps/web/src/auth.tsx')) return authPreview;},
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
