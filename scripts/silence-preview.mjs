// Local, fictional call simulation. Exercises CallSession and the real post-call rules;
// Gemini, Twilio, cloud storage and notification delivery are never connected.
import { createServer } from 'node:http';
import { MemoryStore } from '../packages/store/dist/index.js';
import { PRIVACY_NOTICE, prioritize } from '../packages/core/dist/index.js';
import { recordDetections } from '../packages/store/dist/index.js';
import { CallSession } from '../services/voice-gateway/dist/session.js';
import { loadConfig } from '../services/voice-gateway/dist/config.js';
import { NoResponseService } from '../services/voice-gateway/dist/noResponse.js';
import { analyse } from '../services/analyzer/dist/analysis.js';
const config = loadConfig({
  ...process.env, GOOGLE_CLOUD_PROJECT: 'local-hachi-demo', RECORDINGS_BUCKET: 'local-demo-recordings',
  TELEPHONY_BASE_URL: 'https://telephony.example.invalid', TASKS_INVOKER_SA: 'local@example.invalid',
});
let current;
async function stop() { if (current) await current.session.finish('resident'); }
async function start() {
  await stop();
  const store = new MemoryStore(), at = new Date().toISOString();
  const resident = { id: 'local-silence-resident', name: 'Margaret Ellis', preferredName: 'Margaret', phone: '+819000000001',
    channel: 'pstn', callTime: '10:00', timeZone: 'Asia/Tokyo', vulnerability: {livesAlone: true, hasCloseSupporter: true, needsCare: false, chronicConditions: []},
    staff: {name: 'Demo care team', phone: '+81300000000', email: 'staff@example.invalid'},
    familyLookup: [], serviceStartedAt: at, active: true, synthetic: true,
    callConsent: {accepted: true, noticeVersion: PRIVACY_NOTICE.version, recordedAt: at, recordedBy: 'demo-staff'}, createdAt: at, updatedAt: at };
  await store.createResident(resident);
  await store.createCallIfAbsent({id: 'local-call', residentId: resident.id, source: 'live', synthetic: true, status: 'in_progress', channel: 'pstn', startedAt: at, streamToken: 'local-only-token', analysisPending: false, createdAt: at});
  const events = [], began = Date.now();
  const add = (message) => events.push({seconds: ((Date.now() - began) / 1000).toFixed(1), message});
  let handlers, closed = false;
  const socket = {
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg.event === 'mark') setTimeout(() => {
        if (!closed) { add('Prompt playback finished'); void session.onMessage(JSON.stringify(msg)); }
      }, 200);
    },
    close() { closed = true; add('Call ended'); },
  };
  const live = {async connect(_setup, h) {
    handlers = h;
    return {
      sendAudio() {}, respondToTool() {}, close() {}, drop() {},
      sendText(text) {
        const message = text.includes('still no answer') ? 'Still no answer. I will let your care team know.' : text.includes('has not said') ? 'Can you hear me? A yes or a sound is enough.' : text.includes('gone quiet') ? 'Are you still there? Are you all right?' : 'Hello, this is Hachi. Can you hear me?';
        add(message); h.outputTranscript(message); h.audio(new Int16Array(4800).fill(1000)); h.turnComplete();
      },
    };
  }};
  const reporter = new NoResponseService({store, appBaseUrl: 'http://127.0.0.1', newId: () => 'local-r1-case'});
  const session = new CallSession({store, live, noResponse: {async flag(input) { const id = await reporter.flag(input); add('R1 flagged: no response after all check-in prompts. The cause is unknown.'); return id; }}, emergency: {async raise() { throw new Error('Emergency transport is disabled in this demo'); }}, recordings: {async save() { return 'gs://local-only/fictional.wav'; }},
    analysis: {async request() {
      const call = await store.getCall(resident.id, 'local-call');
      const result = analyse({resident, call, transcript: call.transcript ?? [], history: [], review: null, now: new Date()});
      if (result.detections.length) {
        await recordDetections(store, resident, result.detections, {now: new Date(), newId: () => 'local-r1-case', appBaseUrl: 'http://127.0.0.1', locale: 'en'});
        add('R1 flagged: no response after all check-in prompts. The cause is unknown.');
      } else if (!call.conversation?.noResponseCaseId) add('No R1 flag');
    }}, log: {info() {}, warn() {}, error() {}}, config,
  }, socket);
  current = {store, session, events, resident, reply: () => handlers?.inputTranscript('Yes, I can hear you')};
  await session.onMessage(JSON.stringify({event: 'start', start: {streamSid: 'local-stream', customParameters: {residentId: resident.id, callId: 'local-call', streamToken: 'local-only-token'}}}));
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hachi silence test</title><style>
body{font:18px/1.5 system-ui;background:#f4f0e6;color:#1c1915;margin:0;padding:24px}main{max-width:850px;margin:auto}.card{background:white;padding:24px;border-radius:16px;margin:16px 0}h1,h2{color:#1f4d3a}button{font:inherit;padding:12px 16px;background:#1f4d3a;color:white;border:0;border-radius:12px;cursor:pointer;margin:4px;min-height:48px}button:focus-visible{outline:3px solid #1849a0;outline-offset:3px}li{margin:8px 0}.flag{border-left:8px solid #b3261e}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.5 system-ui}</style>
<main><h1>Hachi silence test</h1><p><strong>Local simulation · Fictional resident · No calls or messages</strong></p><p>This exercises the call timer and R1 rules. The displayed prompts simulate playback; they do not test Gemini's voice or telephone timing.</p>
<section class="card"><h2>Try the no-response sequence</h2><p>Start a call and leave it unanswered. The waits before successive checks are ${(config.silence.intervalsSec ?? Array(config.silence.prompts).fill(config.silence.promptSec)).join(', ')} seconds, starting after each prompt has played. After the last prompt, Hachi waits a final ${config.silence.promptSec} seconds. Continued silence creates an R1 flag.</p><button id="start">Start silent call</button><button id="reply">Reply now</button><button id="stop">End test</button></section>
<section class="card"><h2>Timeline</h2><ol id="events" aria-live="polite"></ol><p id="status">Ready to start</p></section><section class="card" id="outcome"><h2>Outcome</h2><pre id="result">No case yet</pre></section><section class="card"><h2>Configured turn detection</h2><pre id="config"></pre><p>Unset fields retain Gemini defaults. A real phone comparison is needed to measure their effect.</p></section></main>
<script>
for(const action of ['start','reply','stop'])document.getElementById(action).onclick=async()=>{await fetch('/'+action,{method:'POST'});await refresh()};
let last='';async function refresh(){const s=await(await fetch('/state')).json();const text=JSON.stringify(s.events);if(text!==last){last=text;const list=document.getElementById('events');list.replaceChildren(...s.events.map(e=>{const li=document.createElement('li');li.textContent=e.seconds+'s · '+e.message;return li}))}document.getElementById('status').textContent=s.status;document.getElementById('result').textContent=s.case?JSON.stringify(s.case,null,2):'No case yet';document.getElementById('outcome').className=s.case?'card flag':'card';document.getElementById('config').textContent=JSON.stringify(s.settings,null,2)};setInterval(refresh,300);refresh();
</script></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (req.url === '/start') await start();
      else if (req.url === '/reply' && current) { current.reply(); await stop(); }
      else if (req.url === '/stop') await stop();
      else {res.writeHead(404); res.end(); return;}
      res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}'); return;
    }
    if (req.url === '/state') {
      const cases = current ? await current.store.listCasesByResident(current.resident.id) : [];
      const c = cases[0];
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({events: current?.events ?? [], status: current?.session.currentState ?? 'Ready to start',
        settings: {automaticActivityDetection: config.gemini.activityDetection ?? 'Model defaults (unset)', silence: config.silence},
        case: c ? {rule: c.rule, urgency: c.autoUrgency, summary: c.detections.at(-1).summary, reason: prioritize(c, cases, current.resident.vulnerability, new Date(), 'en').reason, evidence: c.detections.at(-1).evidence} : null})); return;
    }
    res.writeHead(200, {'content-type':'text/html','cache-control':'no-store'}); res.end(html);
  } catch (error) {console.error(error); res.writeHead(500); res.end('Local test failed');}
});
const port = Number(process.argv[2] || 5191);
server.listen(port, '127.0.0.1', () => console.log('Hachi silence preview: http://127.0.0.1:' + port));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => {await stop(); server.close(); process.exit(0);});
