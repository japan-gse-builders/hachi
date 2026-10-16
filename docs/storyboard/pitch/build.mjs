#!/usr/bin/env node
// The animated pitch video. Voices first (their lengths set the timeline), then music and sound
// effects on that timeline, then pitch.html rendered frame by frame in headless Chrome at 1080p.
//
//   node docs/storyboard/pitch/build.mjs            → out/hachi-pitch.mp4 (+ .srt)
//   node docs/storyboard/pitch/build.mjs --audio    → voices, timeline and mix only (then open pitch.html to preview)
//   node docs/storyboard/pitch/build.mjs --from 60 --to 80   → render only that stretch, for checking
//
// Needs macOS (say), Google Chrome and ffmpeg.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mix, music, readWav, writeWav } from './sound.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30;
const { values: args } = parseArgs({ options: { audio: { type: 'boolean' }, from: { type: 'string' }, to: { type: 'string' }, stills: { type: 'string' }, 'no-captions': { type: 'boolean' } } });

/** Narrator, Hachi and the people Hachi calls must never sound alike. Calls go through a phone line. */
const VOICES = {
  narr: { voice: 'Daniel', rate: 158, gain: 1 },
  hachi: { voice: 'Samantha', rate: 162, gain: 0.85, phone: true },
  edith: { voice: 'Moira', rate: 142, gain: 0.9, phone: true },
  walter: { voice: 'Daniel', rate: 140, gain: 0.9, phone: true, pitch: 0.86 },
};

/** `spoken` overrides what the voice reads when its pronunciation is wrong; captions keep `text`. */
const n = (id, text, spoken) => ({ id, kind: 'narr', text, spoken });
const line = (id, kind, text) => ({ id, kind, text });
const pause = (id, seconds) => ({ id, kind: 'pause', seconds });

/** The story, scene by scene. pitch.html refers to these ids. */
const SCENES = [
  { id: 'open', beats: [
    pause('o_ring', 3.1),
    line('o_h1', 'hachi', "Good morning, Edith! It's Hachi, calling for our daily chat. How did you sleep?"),
    line('o_e1', 'edith', 'Oh, not too badly, thank you, dear. I slept right through the night.'),
    pause('o_title', 3.4),
  ] },
  { id: 'problem', mood: 'calm', beats: [
    n('p1', "That's Edith. She's eighty-two, and she lives on her own."),
    n('p2', 'Her son Michael calls every Sunday, from the other side of the world.'),
    n('p3', "Her care team would love to check on her every day. But they can't call everyone."),
    n('p4', 'And most check-in apps expect a smartphone, an account, and updates.'),
    n('p5', "Edith has a phone by her chair. For Hachi, that's enough."),
  ] },
  { id: 'call', mood: 'drive', beats: [
    n('c1', "Every morning, Hachi gives her a ring. It says it's an AI, and that the call is recorded."),
    line('c_h0', 'hachi', 'How did you sleep?'),
    line('c_e0', 'edith', 'Not too badly, thank you, dear. I slept right through the night.'),
    line('c_h', 'hachi', 'What did you have for breakfast?'),
    line('c_e', 'edith', 'Toast with jam, and a lovely cup of tea.'),
    n('c2', 'It feels like a chat. But Hachi is listening to what she says, and to how she says it.'),
  ] },
  { id: 'queue', mood: 'drive', beats: [
    n('q1', 'For the care team, it all becomes one short list.'),
    n('q2', 'Who needs attention first, and why, in a single line.'),
    n('q3', "Even the people Hachi couldn't reach are on it. Silence never counts as good news."),
  ] },
  { id: 'change', mood: 'calm', beats: [
    n('ch1', 'Take Edith. Nothing she said was worrying. But listen.'),
    line('ch_e', 'edith', 'I went to get bread from the... from the... from the... from the bakery, near the station.'),
    n('ch2', "Compared with her own last four weeks, she's slower to answer, and restarting her sentences more often."),
    n('ch3', 'Not a diagnosis. A nudge to check in early, with the recording as proof.'),
  ] },
  { id: 'emergency', mood: 'tense', beats: [
    pause('e_ring', 1.0),
    line('e_h0', 'hachi', 'Good morning, Walter! How are you feeling today?'),
    line('e_w', 'walter', "Not good. I've got a tight pain in my chest... and it's going down my arm."),
    n('e1', "When it's urgent, Hachi doesn't wait for the call to end."),
    line('e_h', 'hachi', "Walter, if you can, call an ambulance. I'm bringing your daughter and your care team onto the line, right now."),
    n('e2', 'It rings his daughter and his care worker, and joins them to the call.'),
    n('e3', 'And if someone picks up but never speaks, that raises an alert too.'),
  ] },
  { id: 'family', mood: 'calm', beats: [
    n('f1', 'Michael gets his own view of how his mum is doing, day by day.'),
    n('f2', 'But never the recordings or transcripts. So Edith can speak freely.'),
  ] },
  { id: 'tech', mood: 'drive', beats: [
    n('t1', 'Under the hood, Twilio carries the call through Cloud Run to the Gemini Live API, in real time.',
      'Under the hood, Twilio carries the call through Cloud Run to the Gemini Lyve API, in real time.'),
    n('t2', 'Afterwards, Gemini reviews every call. And a monthly budget cap never blocks an emergency.'),
  ] },
  { id: 'close', mood: 'calm', beats: [
    n('z1', "We're starting in Japan, one of the oldest societies on earth, with older people who speak English."),
    n('z2', 'Next: English speakers everywhere.'),
    n('z3', 'Because all they need is a phone.'),
    pause('z_end', 4.2),
  ] },
];

const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const ffmpeg = (a) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const duration = (f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));

/** Speaks a line into a 48 kHz mono WAV, cached by voice and text. */
function speak(kind, text) {
  const v = VOICES[kind];
  const key = createHash('sha1').update(JSON.stringify([v, text])).digest('hex').slice(0, 12);
  const wav = join(out, 'tts', `${kind}-${key}.wav`);
  if (!existsSync(wav)) {
    const aiff = wav.replace(/\.wav$/, '.aiff');
    run('say', ['-v', v.voice, '-r', String(v.rate), '-o', aiff, text]);
    const filters = [
      ...(v.pitch ? [`asetrate=22050*${v.pitch}`, 'aresample=22050', `atempo=${(1 / v.pitch).toFixed(3)}`] : []),
      ...(v.phone ? ['highpass=f=320', 'lowpass=f=3300', 'acompressor=threshold=0.1:ratio=3'] : ['highpass=f=70']),
    ];
    ffmpeg(['-i', aiff, '-af', filters.join(','), '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  }
  return wav;
}

mkdirSync(join(out, 'tts'), { recursive: true });

// ---------------------------------------------------------------- timeline
const beats = [];
const scenes = [];
let t = 0.3;
for (const [si, scene] of SCENES.entries()) {
  if (si) t += 0.55;
  const start = si ? t - 0.35 : 0;
  for (const b of scene.beats) {
    const file = b.kind === 'pause' ? null : speak(b.kind, b.spoken ?? b.text);
    const len = file ? duration(file) : b.seconds;
    beats.push({ id: b.id, kind: b.kind, text: b.text ?? null, scene: scene.id, start: +t.toFixed(3), end: +(t + len).toFixed(3), file });
    t += len + (b.kind === 'pause' ? 0 : b.kind === 'narr' ? 0.32 : 0.42);
  }
  scenes.push({ id: scene.id, mood: scene.mood ?? null, start: +start.toFixed(3) });
}
const total = +(t + 0.2).toFixed(3);
scenes.forEach((s, i) => { s.end = scenes[i + 1]?.start ?? total; });
// Loudness per video frame, so on-screen waveforms move with the actual speech.
const envelopes = {};
let peak = 0;
for (const b of beats.filter((x) => x.file)) {
  const pcm = readWav(b.file);
  const step = 48000 / FPS;
  const env = [];
  for (let i = 0; i < pcm.length; i += step) {
    let s = 0;
    for (let j = i; j < Math.min(pcm.length, i + step); j++) s += pcm[j] * pcm[j];
    env.push(Math.sqrt(s / step));
  }
  envelopes[b.id] = env;
  peak = Math.max(peak, ...env);
}
for (const id in envelopes) envelopes[id] = envelopes[id].map((v) => +Math.min(1, (v / peak) * 1.6).toFixed(2));
const timeline = { duration: total, beats: beats.map(({ file, ...b }) => b), scenes };
writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 1));
writeFileSync(join(out, 'timeline.js'), `window.TL = ${JSON.stringify({ ...timeline, envelopes })};\n`);
console.log(`timeline ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')} · ${beats.filter((b) => b.kind === 'narr').reduce((a, b) => a + b.text.split(/\s+/).length, 0)} narrated words`);

// Same reference syntax as pitch.html: "id", "id.end", "id~0.5" (fraction through), "@scene", plus "+0.3".
const B = Object.fromEntries(beats.map((b) => [b.id, b]));
const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
function at(ref) {
  const m = ref.match(/^(@?\w+)(\.end)?(~[\d.]+)?((?:[+-][\d.]+)*)$/);
  const base = m[1].startsWith('@') ? S[m[1].slice(1)] : B[m[1]];
  if (!base) throw new Error(`Unknown reference ${ref}`);
  let v = m[2] ? base.end : base.start;
  if (m[3]) v = base.start + (base.end - base.start) * Number(m[3].slice(1));
  return v + (m[4].match(/[+-][\d.]+/g) ?? []).reduce((x, o) => x + Number(o), 0);
}

// ---------------------------------------------------------------- audio
const effects = [
  ['ring', 'o_ring+0.25'], ['connect', 'o_h1-0.3'], ['chime', 'o_title+0.2'],
  ...scenes.slice(1).map((s) => ['whoosh', `@${s.id}-0.05`]),
  ['pop', 'p1+0.3'], ['pop', 'p2+0.15', [2]], ['pop', 'p3+0.1', [1]],
  ...[0, 1, 2, 3].map((k) => ['tick', `p4~${(0.35 + k * 0.14).toFixed(2)}`]), ['join', 'p5~0.55'],
  ['pop', 'c1~0.45'], ['pop', 'c1~0.7', [2]], ['pop', 'c2~0.42', [1]], ['pop', 'c2~0.72', [3]],
  ...[0, 1, 2, 3].map((k) => ['pop', `q1+${(0.5 + k * 0.22).toFixed(2)}`, [k]]), ['pop', 'q3+0.3', [4]],
  ['pop', 'ch2~0.78', [5]],
  ['alert', 'e_w~0.5'], ['ringback', 'e2+0.15', [-0.5]], ['ringback', 'e2+0.45', [0.5]], ['join', 'e2~0.8'], ['pop', 'e3+0.4', [1]],
  ...[0, 1, 2, 3, 4, 5].map((k) => ['tick', `f1+${(0.6 + k * 0.12).toFixed(2)}`]), ['pop', 'f2+0.4', [2]],
  ...[0, 1, 2, 3].map((k) => ['pop', `t1~${(0.12 + k * 0.2).toFixed(2)}`, [k]]), ['pop', 't2~0.7', [5]],
  ['chime', 'z1~0.3+0.04', [74]], ['pop', 'z1~0.3+0.02', [3]], ...Array.from({ length: 12 }, (_, k) => ['ping', `z2+${(0.62 + k * 0.13).toFixed(2)}`, [k]]), ['chime', 'z3~0.8'],
].map(([name, ref, a]) => ({ name, at: at(ref), args: a }));

if (!args.stills) {
const voices = beats.filter((b) => b.file).map((b) => ({ at: b.start, data: readWav(b.file), gain: VOICES[b.kind].gain }));
const musicStart = at('o_title');
const musicEnd = at('z3~0.8');
const moodAt = (time) => scenes.findLast((s) => s.start <= time)?.mood ?? 'calm';
const bed = music(total, musicStart, musicEnd, moodAt);
writeWav(join(out, 'mix.wav'), mix(total, voices, effects, bed));
console.log('audio mixed');
}

writeFileSync(join(out, 'hachi-pitch.srt'), beats.filter((b) => b.kind === 'narr').map((b, i) => {
  const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
  return `${i + 1}\n${ts(b.start)} --> ${ts(b.end + 0.2)}\n${b.text}\n`;
}).join('\n'));

if (args.audio) process.exit(0);

// ---------------------------------------------------------------- pictures
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9334;
const profile = join(out, 'chrome-profile');
// A Chrome left over from an interrupted run would still own the port; only ever ours, by profile path.
try { execFileSync('pkill', ['-f', profile]); await sleep(500); } catch {}
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--allow-file-access-from-files', '--no-first-run', '--force-color-profile=srgb', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((x) => x.type === 'page')).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  // Without these, headless Chrome stops producing frames for a page that is not animating on its own.
  await cdp.send('Page.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__driven = true; window.__captions = ${!args['no-captions']};` });
  await cdp.send('Page.navigate', { url: pathToFileURL(join(here, 'pitch.html')).href });
  for (let i = 0; i < 100 && !(await evaluate('window.__ready === true').catch(() => false)); i++) await sleep(150);
  const problems = await evaluate('window.__problems');
  if (problems?.length) throw new Error(`pitch.html: ${problems.join('; ')}`);
  if (args.stills) {
    mkdirSync(join(out, 'stills'), { recursive: true });
    for (const s of args.stills.split(',')) {
      await evaluate(`renderFrame(${Number(s)})`);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, 'stills', `${s}.png`), Buffer.from(data, 'base64'));
    }
    console.log(`stills in ${join(out, 'stills')}`);
  } else {

  const from = Number(args.from ?? 0);
  const to = Math.min(total, Number(args.to ?? total));
  const partial = args.from || args.to;
  const video = join(out, partial ? 'preview-video.mp4' : 'video.mp4');
  const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round((to - from) * FPS);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await evaluate(`renderFrame(${(from + f / FPS).toFixed(4)})`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    if (!enc.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => enc.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${frames} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));

  const final = join(out, partial ? 'preview.mp4' : 'hachi-pitch.mp4');
  ffmpeg(['-i', video, '-ss', String(from), '-t', String(to - from), '-i', join(out, 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', final]);
  console.log(final);
  }
} finally {
  chrome.kill();
}
