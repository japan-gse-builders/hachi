// Local review harness only. No cloud credentials, real residents or outbound workers.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || 5190);
const requireFromRepo = createRequire(join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromRepo.resolve('vite')));
const { default: react } = await import(pathToFileURL(requireFromRepo.resolve('@vitejs/plugin-react')));
const { MemoryStore } = await import(pathToFileURL(join(root, 'packages/store/dist/index.js')));
const { buildApp } = await import(pathToFileURL(join(root, 'services/api/dist/app.js')));
const { buildDemoData } = await import(pathToFileURL(join(root, 'services/api/dist/demo.js')));
const catalog = buildDemoData(new Date());
const people = catalog.memberships.map(m => ({...m, company: catalog.organizations.find(o => o.id === m.orgId).name}));
const defaultPerson = people[0];

const verifier = {
  async verify(token) {
    if (token === 'demo-family') return {uid: 'demo-family', email: 'family@example.invalid', emailVerified: true};
    const person = people.find(p => p.uid === token);
    if (!person) throw new Error('Unknown local preview account');
    return {uid: person.uid, email: person.email, emailVerified: true, name: person.name, authTime: Math.floor(Date.now() / 1000)};
  },
};

async function makeApi() {
  const store = new MemoryStore();
  const now = new Date();
  // Aiko also helps the two partner companies, so she can demonstrate the organization switcher.
  const data = buildDemoData(now, {uid: defaultPerson.uid, email: defaultPerson.email, name: defaultPerson.name});
  // Local-only contact placeholders and verification allow assignment/family screens to be tried.
  // No outbound workers or cloud adapters exist in this harness. The hosted seed keeps phones empty
  // and organizations unverified instead.
  for (const org of data.organizations) { org.verifiedAt = now.toISOString(); org.verifiedBy = 'local-preview'; }
  for (const member of data.memberships) member.phone = '+81300000000';
  store.seedAccounts(data);
  for (const resident of data.residents) {
    resident.staff.phone = '+81300000000';
    if (resident.id === 'demo-sakura-patient-1') {
      resident.family = {name: 'Sarah Ellis', relationship: 'Daughter', email: 'family@example.invalid'};
      resident.familyLookup = ['family@example.invalid'];
    }
    await store.createResident(resident);
  }
  await store.addCalls(data.calls);
  for (const c of data.cases) await store.putCase(c);
  return buildApp({store, verifier, signer: {sign: async () => {throw new Error('No recordings in the local preview');}}});
}

let api = await makeApi();
await api.ready();

const authPreview = `
import {createElement as h, Fragment} from 'react';
const people = ${JSON.stringify(people)};
const selected = people.find(p => p.uid === localStorage.getItem('hachi-preview-person')) || people[0];
export const authReady = true;
export const firebaseApp = null;
export const AuthProvider = ({children}) => h(Fragment, null,
  h('aside', {role: 'region', 'aria-label': 'Demo controls', style: {display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', background: '#e6efe9', borderBottom: '1px solid #c7d7cd', fontSize: '14px'}},
    h('span', null, h('strong', null, 'Demo preview'), ' · Fictional people and companies. No calls or emails.'),
    h('label', {style: {display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', maxWidth: '100%'}}, 'View as',
      h('select', {value: selected.uid, style: {width: 'auto', maxWidth: '100%'}, onChange: (e) => {localStorage.setItem('hachi-preview-person', e.target.value); location.href = '/staff';}},
        ...people.map(p => h('option', {key: p.uid, value: p.uid}, p.name + ' · ' + p.company + ' · ' + p.role))))), children);
const noop = async () => {};
const token = async () => location.pathname.startsWith('/family') ? 'demo-family' : selected.uid;
const staffUser = {uid: selected.uid, email: selected.email, emailVerified: true, providerData: [{providerId: 'password'}]};
const staffToken = async () => selected.uid;
const signOut = async () => {location.href = '/privacy';};
export const useStaffSession = () => ({user: staffUser, ready: true, token: staffToken, signOut});
export const useAuth = () => ({
 user: location.pathname === '/privacy' ? null : location.pathname.startsWith('/family') ? {uid: 'demo-family', email: 'family@example.invalid', emailVerified: true} : staffUser,
 role: location.pathname.startsWith('/family') ? 'family' : 'staff', ready: true, token,
 signOut, confirmEmail: noop, signIn: noop,
 signInWithGoogle: noop, sendPasswordReset: noop, sendSignInLink: noop,
 sendInvitationEmail: async () => {throw new Error('Email delivery is disabled in the local preview');},
 finishSignInLink: noop,
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
