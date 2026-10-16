#!/usr/bin/env node
// docs/DEMO_SCRIPT.md の台本から、字幕と仮の音声付きの下書き動画を作る。
// 画面は storyboard/frames.html のコマ（静止画にゆっくり寄る）、声は macOS の say。
// 必要なもの：macOS、Google Chrome、ffmpeg（brew install ffmpeg）。
// 使い方：node docs/storyboard/video/build.mjs → docs/storyboard/video/out/hachi-demo-draft.mp4 と .srt
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const board = dirname(here);
const out = join(here, 'out');
const work = join(out, 'work');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30;
const COLOR = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
/** Silence at the start of each shot, and after each line. */
const LEAD = 0.3;
const GAP = { narrator: 0.4, hachi: 0.5, edith: 0.6 };

/** Hachi and the narrator must not sound alike (DEMO_SCRIPT.md, ナレーションの声). */
const VOICES = {
  narrator: { voice: process.env.NARRATOR_VOICE ?? 'Daniel', rate: Number(process.env.NARRATOR_RATE ?? 130) },
  hachi: { voice: 'Samantha', rate: 150, phone: true },
  edith: { voice: 'Moira', rate: 125, phone: true },
};

const n = (text, extra = {}) => ({ who: 'narrator', text, sub: text, ...extra });
const call = (who, text, extra = {}) => ({ who, text, sub: `${who === 'hachi' ? 'Hachi' : 'Edith'}: ${text}`, ...extra });

/** One entry per frame of storyboard/frames.html, in order. Narration matches DEMO_SCRIPT.md word for word. */
const SHOTS = [
  // 1. 通話の声から入る
  { frame: '01-hook', cues: [call('hachi', 'Good morning Edith, this is Hachi calling for our daily chat.', { sub: 'Good morning Edith, this is Hachi calling for our daily chat.' })] },
  { frame: '02-title', hold: 2.5 },
  // 2. 世界の問題と出発点
  { frame: '03-world', cues: [n('Around the world, more older people live alone.'), n('Family is often far away, and care staff cannot call everyone every day.')] },
  { frame: '04-phone', cues: [n('Many will never use an app, but they still answer the phone.')] },
  { frame: '05-japan', cues: [n('We are starting with English speakers in Japan, one of the oldest societies in the world.')] },
  // 3. Edith と毎日の電話
  {
    frame: '06-call',
    cues: [
      n('Meet Edith. She lives alone, and her son is far away.', { cap: 'All people shown are fictional.' }),
      n('Hachi calls her every day. It says it is an AI and that the call is recorded.'),
      call('hachi', 'How did you sleep last night?'),
      call('edith', 'Oh, not too badly, thank you. I slept right through the night for once.'),
      n('Health and meals come up naturally.', { cap: 'Calls start only after the person agrees, and staff record that agreement.' }),
      n('Hachi listens to what she says, and to how she says it.', { cap: 'Each call also includes two questions from standard health checklists.' }),
    ],
  },
  // 4. 職員の待ち行列
  { frame: '07-queue', cues: [n('Staff start from one queue that says who to look at first, and why.'), n('It also shows who Hachi could not reach, so a missed call never looks like a good day.')] },
  // 5. Edith の小さな変化
  {
    frame: '08-change',
    cues: [
      n('Nothing Edith said was alarming. But listen.'),
      call('edith', 'I went to get bread from the from the bakery near the station.'),
      n('She is slower to answer than usual, and restarts her sentences more often.'),
      n('Hachi compares her only with herself, over the past four weeks.'),
      n('Not a diagnosis: a sign of change, with the recording as evidence.'),
    ],
  },
  // 6. 緊急と沈黙
  {
    frame: '09-emergency',
    cues: [
      n('If someone is in danger now, like chest pain or a fall, Hachi acts during the call.'),
      n('It asks them to call an ambulance if they can, and phones staff and family to join the call.', {
        cap: '"It\'s probably nothing, but my chest hurts" still counts. Past events and other people\'s problems do not.',
      }),
      n('Answering and saying nothing raises an alert too.'),
    ],
  },
  // 7. 家族の画面
  {
    frame: '10-family',
    cues: [
      n("Families get a simpler view: today's call, two weeks at a glance, and what keeps coming up."),
      n('They never get recordings, transcripts or speech analysis, so Edith can talk freely.'),
      n('The API enforces that.'),
    ],
  },
  // 8. 仕組み
  {
    frame: '11-arch',
    cues: [n('Twilio streams the call through Cloud Run to the Gemini Live API, and Gemini reviews every call afterwards.'), n('A monthly AI budget can pause routine calls, but never an emergency alert.')],
  },
  // 9. 評価とこれから
  { frame: '12-eval', cues: [n('On synthetic recordings, Hachi found all ten scripted changes, with no false alarms.'), n('Real phone audio will be harder.')] },
  { frame: '13-close', cues: [n('Today, Hachi calls English speakers in Japan.'), n('Next, English speakers anywhere.'), n('All they need is a phone.')], tail: 2.5 },
];

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const duration = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
/** Round up to a whole video frame, so audio and pictures never drift apart. */
const frames = (seconds) => Math.ceil(seconds * FPS);

function screenshot(url, file, transparent = false) {
  run(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=3000',
    '--window-size=1280,720', `--screenshot=${file}`, ...(transparent ? ['--default-background-color=00000000'] : []), url,
  ]);
}

function silence(file, nFrames) {
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(nFrames / FPS), '-c:a', 'pcm_s16le', file]);
}

/** Speaks one line and pads it with its gap. Returns its length in frames. */
function speak(cue, file) {
  const { voice, rate, phone } = VOICES[cue.who];
  const raw = file.replace(/\.wav$/, '.aiff');
  run('say', ['-v', voice, '-r', String(rate), '-o', raw, cue.text]);
  const nFrames = frames(duration(raw) + GAP[cue.who]);
  const filter = [phone ? 'highpass=f=300,lowpass=f=3400' : 'anull', `apad=whole_dur=${nFrames / FPS}`].join(',');
  ffmpeg(['-i', raw, '-af', filter, '-ar', '48000', '-ac', '1', '-t', String(nFrames / FPS), '-c:a', 'pcm_s16le', file]);
  return nFrames;
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (v, w = 2) => String(v).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const audio = [];
const segments = [];
/** When each line starts within its shot, so record.mjs can time the clicks and scrolls to the words. */
const timeline = [];
const srt = [];
let clock = 0;
let k = 0;

for (const [i, shot] of SHOTS.entries()) {
  const base = join(work, `frame-${shot.frame}.png`);
  screenshot(`file://${join(board, 'frames.html')}#${shot.frame}&nosub`, base);

  const overlays = [];
  let t = 0;
  if (shot.hold) {
    const f = frames(shot.hold);
    const a = join(work, `a${k++}.wav`);
    silence(a, f);
    audio.push(a);
    t = f;
  } else {
    const lead = join(work, `a${k++}.wav`);
    silence(lead, frames(LEAD));
    audio.push(lead);
    t = frames(LEAD);
    for (const cue of shot.cues) {
      const a = join(work, `a${k++}.wav`);
      const len = speak(cue, a);
      audio.push(a);
      if (cue.sub || cue.cap) {
        const png = join(work, `sub${k}.png`);
        screenshot(`file://${join(here, 'sub.html')}#${encodeURIComponent(JSON.stringify({ sub: cue.sub, cap: cue.cap }))}`, png, true);
        overlays.push({ png, from: t / FPS, to: (t + len) / FPS - 0.1 });
      }
      if (cue.sub) srt.push({ from: clock + t / FPS, to: clock + (t + len) / FPS - 0.1, text: cue.sub });
      t += len;
    }
    if (shot.tail) {
      const a = join(work, `a${k++}.wav`);
      silence(a, frames(shot.tail));
      audio.push(a);
      t += frames(shot.tail);
    }
  }

  timeline.push({ frame: shot.frame, seconds: t / FPS, cues: overlays.map((o) => ({ from: o.from, to: o.to })) });

  // A recorded clip of the app (record.mjs) if there is one, else a slow push-in on the still, 4% over
  // the shot. Subtitles sit on top and do not move.
  const seg = join(work, `v${String(i).padStart(2, '0')}.mp4`);
  const clip = join(out, 'clips', `${shot.frame}.mp4`);
  const useClip = existsSync(clip);
  const inputs = [...(useClip ? ['-i', clip] : ['-i', base]), ...overlays.flatMap((o) => ['-loop', '1', '-t', String(t / FPS), '-i', o.png])];
  let graph = useClip
    ? `[0:v]fps=${FPS},scale=1280:720,setsar=1,tpad=stop_mode=clone:stop_duration=${Math.ceil(t / FPS)},trim=end_frame=${t}[v0]`
    : `[0:v]scale=2560:1440,zoompan=z='1+0.04*on/${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${t}:s=1280x720:fps=${FPS}[v0]`;
  overlays.forEach((o, j) => {
    graph += `;[v${j}][${j + 1}:v]overlay=0:0:enable='between(t,${o.from.toFixed(3)},${o.to.toFixed(3)})'[v${j + 1}]`;
  });
  // Recorded clips arrive as full-range JPEG colour and stills as limited range; mixing them shifts colours.
  graph += `;[v${overlays.length}]scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[vout]`;
  ffmpeg([...inputs, '-filter_complex', graph, '-map', '[vout]', '-frames:v', String(t), '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', ...COLOR, seg]);
  segments.push(seg);
  console.log(`${shot.frame.padEnd(13)} ${srtTime(clock).slice(3, 8)}  ${(t / FPS).toFixed(1)} s${useClip ? '  (recorded)' : ''}`);
  clock += t / FPS;
}

const list = (files) => files.map((f) => `file '${f}'`).join('\n');
writeFileSync(join(work, 'video.txt'), list(segments));
writeFileSync(join(work, 'audio.txt'), list(audio));
ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'video.txt'), '-c', 'copy', join(work, 'video.mp4')]);
ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'audio.txt'), '-c', 'copy', join(work, 'audio.wav')]);

const final = join(out, 'hachi-demo-draft.mp4');
ffmpeg([
  '-i', join(work, 'video.mp4'), '-i', join(work, 'audio.wav'),
  '-vf', `fade=in:st=0:d=0.5,fade=out:st=${(clock - 0.8).toFixed(2)}:d=0.8`, '-af', `afade=out:st=${(clock - 0.8).toFixed(2)}:d=0.8,loudnorm=I=-16:TP=-1.5`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', ...COLOR, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final,
]);
writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 1));
writeFileSync(join(out, 'hachi-demo-draft.srt'), srt.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join('\n'));
console.log(`\n${final}\ntotal ${Math.floor(clock / 60)}:${String(Math.round(clock % 60)).padStart(2, '0')} (limit 3:00)`);
