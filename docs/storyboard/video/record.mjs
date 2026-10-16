#!/usr/bin/env node
// 動画の画面の場面（3〜7）を、ローカルプレビューを実際に操作して収録する。Chrome DevTools Protocol を
// Node 22 の WebSocket で直接使うので、npm の追加パッケージは要らない。
//
//   PREVIEW_FIXTURE=docs/storyboard/video/preview-fixture.mjs npm run preview:local -- 5196   # 別の端末で
//   node docs/storyboard/video/build.mjs     # 1 回目：timeline.json（台詞ごとの時刻）を作る
//   node docs/storyboard/video/record.mjs    # out/clips/*.mp4 を作る（場面を絞るなら引数に名前）
//   node docs/storyboard/video/build.mjs     # 2 回目：静止画の代わりに収録した場面を使う
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5196';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const timeline = JSON.parse(readFileSync(join(out, 'timeline.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hides the preview-only controls and adds a visible pointer, since a recording has no cursor. */
const PAGE_SETUP = `
(() => {
  const css = \`
    aside[aria-label="Demo controls"] { display: none !important; }
    #rec-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none;
      transition: transform 700ms cubic-bezier(.4,0,.2,1); }
    #rec-cursor svg { filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
    .rec-ring { outline: 4px solid #1f4d3a !important; outline-offset: 6px; border-radius: 12px; transition: outline-color 300ms; }
    .rec-click { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      border: 3px solid #1f4d3a; pointer-events: none; animation: rec-pop 600ms ease-out forwards; }
    @keyframes rec-pop { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }\`;
  const add = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const c = document.createElement('div');
    c.id = 'rec-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.5 16 L12 24 L15.5 22.5 L12 14.8 L19.5 14.8 Z" fill="#1c1915" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.transform = 'translate(1400px, 900px)';
    document.body.append(c);
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add) : add();
  const visible = (el) => el.getClientRects().length > 0;
  window.__rec = {
    find(text, root = document) {
      const all = [...root.querySelectorAll('body *')].filter((el) => visible(el) && el.textContent.includes(text));
      return all.find((el) => ![...el.children].some((ch) => ch.textContent.includes(text))) ?? null;
    },
    el(target) { return typeof target === 'string' && !target.startsWith('text=') ? document.querySelector(target) : this.find(target.slice(5)); },
    /** Scrolls so the element's top sits \`offset\` px below the top of the window, eased over \`ms\`. */
    scrollTo(target, offset = 90, ms = 1600) {
      const el = typeof target === 'number' ? null : this.el(target);
      const goal = Math.max(0, Math.min(el ? el.getBoundingClientRect().top + scrollY - offset : target, document.documentElement.scrollHeight - innerHeight));
      const from = scrollY, t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        scrollTo(0, from + (goal - from) * e);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    center(target) {
      const el = this.el(target);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    pointAt(x, y) { document.getElementById('rec-cursor').style.transform = \`translate(\${x - 3}px, \${y - 2}px)\`; },
    pop(x, y) {
      const d = document.createElement('div');
      d.className = 'rec-click';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      document.body.append(d);
      setTimeout(() => d.remove(), 700);
    },
    ring(target, closest) {
      let el = this.el(target);
      if (el && closest) el = el.closest(closest) ?? el;
      el?.classList.add('rec-ring');
    },
    unring() { document.querySelectorAll('.rec-ring').forEach((e) => e.classList.remove('rec-ring')); },
  };
})();`;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
      } else if (msg.method) this.handlers.get(msg.method)?.(msg.params);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) { this.handlers.set(method, fn); }
}

/** One browser tab, with helpers that run inside the page. */
class Tab {
  constructor(cdp) { this.cdp = cdp; }
  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  rec(call) { return this.eval(`window.__rec.${call}`); }
  async goto(path, readyText) {
    await this.cdp.send('Page.navigate', { url: BASE + path });
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      if (await this.eval(`!!window.__rec && !!window.__rec.find(${JSON.stringify(readyText)})`).catch(() => false)) break;
    }
    await sleep(900);
  }
  async scroll(target, offset, ms = 1600) {
    await this.rec(`scrollTo(${JSON.stringify(target)}, ${offset ?? 90}, ${ms})`);
    await sleep(ms + 100);
  }
  /** Moves the drawn pointer, then sends a real mouse move so hover states appear. */
  async point(target) {
    const c = await this.rec(`center(${JSON.stringify(target)})`);
    if (!c) {
      console.warn(`  nothing to point at: ${target}`);
      return null;
    }
    await this.rec(`pointAt(${c.x}, ${c.y})`);
    await sleep(750);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    return c;
  }
  async click(target) {
    const c = await this.point(target);
    if (!c) return;
    await this.rec(`pop(${c.x}, ${c.y})`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
    }
    await sleep(300);
  }
}

/** Captures what Chrome paints, with the time of each frame, between start() and stop(). */
class Recorder {
  constructor(tab, dir) {
    this.tab = tab;
    this.dir = dir;
    this.frames = [];
    tab.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      if (this.recording) {
        const file = join(dir, `f${String(this.frames.length).padStart(5, '0')}.jpg`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        this.frames.push({ file, t: metadata.timestamp });
      }
      tab.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
  }
  async start(size) {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.recording = true;
    await this.tab.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 });
    // A frame is only sent when something changes; nudge one out so the clip starts at once.
    await this.tab.rec('pointAt(innerWidth * 0.6, innerHeight * 0.7)');
    for (let i = 0; i < 40 && !this.frames.length; i++) await sleep(25);
    this.t0 = this.frames[0]?.t ?? Date.now() / 1000;
  }
  /** Ends the clip `seconds` after it started and writes it as a constant 30 fps video. */
  async stopAt(seconds, file, filter) {
    const wait = this.t0 + seconds - Date.now() / 1000;
    if (wait > 0) await sleep(wait * 1000);
    this.recording = false;
    await this.tab.cdp.send('Page.stopScreencast');
    const list = [];
    this.frames.forEach((f, i) => {
      const next = this.frames[i + 1]?.t ?? this.t0 + seconds;
      list.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    list.push(`file '${this.frames.at(-1).file}'`);
    writeFileSync(join(this.dir, 'frames.txt'), list.join('\n'));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(this.dir, 'frames.txt'),
      '-vf', `${filter},fps=30,format=yuv420p`, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', file]);
    console.log(`${file.split('/').pop()}: ${this.frames.length} frames, ${seconds.toFixed(1)} s`);
  }
}

const DESKTOP = { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false };
const PHONE = { width: 400, height: 540, deviceScaleFactor: 2, mobile: true };
const DESKTOP_FILTER = 'scale=1280:720:flags=lanczos';
/** The phone screen sits in a dark frame on the page colour, above where the subtitles go. */
const PHONE_FILTER = 'scale=420:567:flags=lanczos,pad=440:587:10:10:color=0x1c1915,pad=1280:720:420:20:color=0xf4efe4';

/**
 * Each scene: where to start, then what to do as each line begins. `cue(i)` waits until line i of
 * that shot (timeline.json) starts, so the screen moves with the narration.
 */
const SCENES = {
  async '06-call'(tab, cue) {
    await cue(1, 0.6);
    await tab.click('details.case-transcript summary');
    await tab.scroll('details.case-transcript', 110, 1400);
    await cue(3);
    await tab.rec(`ring("text=I slept right through the night", "p")`);
    await cue(4);
    await tab.rec('unring()');
    await tab.scroll(0, 0, 1400);
    await tab.point('text=Calls');
    await cue(5, 0.3);
    await tab.point('text=Slower to answer');
  },
  async '07-queue'(tab, cue) {
    await cue(0, 1.2);
    await tab.scroll('text=Immediate action', 150, 2600);
    await cue(1);
    await tab.scroll('.queue-notices', 140, 1000);
    await tab.rec(`ring(".queue-notices")`);
    await tab.point('.queue-notices');
    await cue(1, 3.4);
    await tab.rec('unring()');
    await tab.scroll('text=Edith Carter', 260, 1100);
    await tab.point('text=Edith Carter');
    await tab.rec(`ring("text=Edith Carter", "li, article")`);
    await cue(1, 5.6);
    await tab.click('text=Edith Carter');
  },
  async '08-change'(tab, cue) {
    await cue(0, 0.4);
    await tab.point('.quote-words');
    await cue(1);
    await tab.rec(`ring(".quote-words", "blockquote")`);
    await cue(2);
    await tab.rec('unring()');
    await tab.scroll('text=Speech over time', 80, 1800);
    await tab.point('text=Time to answer:');
    await cue(3);
    await tab.scroll('.speech-hits', 260, 1200);
    await tab.point('.speech-hits .speech-hit:last-child');
  },
  async '09-emergency'(tab, cue) {
    await cue(0, 1.5);
    await tab.point('.quote-words');
    await cue(1, 0.8);
    await tab.scroll('#notifications-heading', 330, 1800);
    await tab.point('text=Family');
  },
  async '10-family'(tab, cue) {
    await cue(0, 1.8);
    await tab.scroll('#family-weeks-heading', 24, 1500);
    await cue(0, 4.4);
    await tab.scroll('#family-trends-heading', 24, 1500);
  },
};

const START = {
  '06-call': { path: '/staff/cases/demo-edith-case', ready: 'Edith Carter', device: DESKTOP },
  '07-queue': { path: '/staff', ready: 'Edith Carter', device: DESKTOP, prep: `document.querySelector('details.queue-filters').open = false` },
  '08-change': { path: '/staff/cases/demo-edith-case', ready: 'Speech over time', device: DESKTOP },
  '09-emergency': { path: '/staff/cases/demo-walter-case', ready: 'Walter Hughes', device: DESKTOP },
  '10-family': { path: '/family/residents/demo-edith', ready: 'What keeps coming up', device: PHONE, scroll: "text=Today's call" },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const profile = join(out, 'chrome-profile');
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--disable-gpu', '--no-first-run', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  const tab = new Tab(await Cdp.connect(target.webSocketDebuggerUrl));
  await tab.cdp.send('Page.enable');
  await tab.cdp.send('Runtime.enable');
  await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });
  mkdirSync(join(out, 'clips'), { recursive: true });

  for (const name of wanted) {
    const shot = timeline.find((s) => s.frame === name);
    const start = START[name];
    if (!shot || !start) throw new Error(`Unknown scene ${name}`);
    const d = start.device;
    await tab.cdp.send('Emulation.setDeviceMetricsOverride', { width: d.width, height: d.height, deviceScaleFactor: d.deviceScaleFactor, mobile: d.mobile });
    await tab.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await tab.goto(start.path, start.ready);
    if (start.prep) await tab.eval(start.prep);
    if (start.scroll) await tab.rec(`scrollTo(${JSON.stringify(start.scroll)}, 12, 1)`);
    await sleep(600);
    await tab.rec(`pointAt(${d.width * 0.62}, ${d.height * 0.72})`);
    await sleep(800);

    const rec = new Recorder(tab, join(out, 'frames', name));
    await rec.start({ w: d.width * d.deviceScaleFactor, h: d.height * d.deviceScaleFactor });
    const cue = async (i, after = 0) => {
      const at = rec.t0 + shot.cues[i].from + after - Date.now() / 1000;
      if (at > 0) await sleep(at * 1000);
    };
    await SCENES[name](tab, cue);
    await rec.stopAt(shot.seconds, join(out, 'clips', `${name}.mp4`), d.mobile ? PHONE_FILTER : DESKTOP_FILTER);
  }
} finally {
  chrome.kill();
}
