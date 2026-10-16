// Music bed, sound effects and the final mix for the pitch video, synthesised here so nothing
// needs a licence. Everything is 48 kHz stereo Float32 until writeWav.
import { readFileSync, writeFileSync } from 'node:fs';

export const RATE = 48000;
const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function stereo(seconds) {
  const n = Math.ceil(seconds * RATE);
  return [new Float32Array(n), new Float32Array(n)];
}

export function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  let fmt;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (fmt.bits !== 16 || fmt.rate !== RATE) throw new Error(`${file}: expected 16-bit ${RATE} Hz`);
      const frames = size / 2 / fmt.channels;
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = b.readInt16LE(p + 8 + i * 2 * fmt.channels) / 32768;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

export function writeWav(file, [l, r]) {
  const n = l.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, b);
}

/** One note: summed partials with a fast attack and an exponential decay; `pan` -1..1. */
function note(buf, at, dur, freq, amp, { partials = [[1, 1]], attack = 0.006, decay = 1, release = 0.25, pan = 0, vibrato = 0 } = {}) {
  const [L, R] = buf;
  const s0 = Math.floor(at * RATE);
  // Stop once the decay has made it inaudible.
  const total = Math.floor(Math.min(dur + release, attack + decay * 9) * RATE);
  const gl = amp * Math.cos((pan + 1) * Math.PI / 4);
  const gr = amp * Math.sin((pan + 1) * Math.PI / 4);
  const mults = partials.map((p) => p[0]);
  const amps = partials.map((p) => p[1]);
  const decays = partials.map((p) => p[2] ?? 0);
  const phase = new Float64Array(partials.length);
  const np = partials.length;
  for (let i = 0; i < total; i++) {
    const idx = s0 + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / RATE;
    let env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    const f = vibrato ? freq * (1 + vibrato * Math.sin(TAU * 5 * t)) : freq;
    let v = 0;
    for (let k = 0; k < np; k++) {
      phase[k] += (TAU * f * mults[k]) / RATE;
      v += amps[k] * Math.sin(phase[k]) * (decays[k] ? Math.exp(-t / decays[k]) : 1);
    }
    L[idx] += v * env * gl;
    R[idx] += v * env * gr;
  }
}

function noise(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** A small Schroeder reverb, mixed in place. */
function reverb([L, R], wet = 0.25, size = 1) {
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.floor(d * size * (RATE / 44100)));
  const all = [225, 556].map((d) => Math.floor(d * (RATE / 44100)));
  for (const [ch, spread] of [[L, 0], [R, 23]]) {
    const dry = Float32Array.from(ch);
    const acc = new Float32Array(ch.length);
    for (const d0 of combs) {
      const d = d0 + spread;
      const line = new Float32Array(d);
      let p = 0;
      let lp = 0;
      for (let i = 0; i < ch.length; i++) {
        const out = line[p];
        lp = out * 0.7 + lp * 0.3;
        line[p] = dry[i] + lp * 0.8;
        acc[i] += out;
        p = (p + 1) % d;
      }
    }
    for (const d of all) {
      const line = new Float32Array(d);
      let p = 0;
      for (let i = 0; i < ch.length; i++) {
        const buf = line[p];
        const out = -acc[i] + buf;
        line[p] = acc[i] + buf * 0.5;
        acc[i] = out;
        p = (p + 1) % d;
      }
    }
    for (let i = 0; i < ch.length; i++) ch[i] = dry[i] + (acc[i] / combs.length) * wet;
  }
}

const KEYS = { partials: [[1, 1], [2, 0.32], [3, 0.1], [4, 0.04], [7, 0.12, 0.05]], decay: 1.6, release: 0.4 };
const PLUCK = { partials: [[1, 1], [2, 0.4, 0.3], [3, 0.15, 0.15]], decay: 0.35, release: 0.1 };
const PAD = { partials: [[1, 1], [1.003, 0.8], [0.997, 0.8], [2, 0.15]], attack: 1.6, decay: 60, release: 2.2 };

/** D major, warm: Dmaj9, Bm7, Gmaj7, A6/9; a tenser section; then a resolving outro. */
const CALM = [[50, [62, 66, 69, 73, 76]], [47, [62, 66, 69, 71, 74]], [43, [62, 66, 67, 71, 74]], [45, [61, 64, 66, 69, 71]]];
const TENSE = [[47, [59, 62, 66, 71]], [43, [59, 62, 67, 71]], [47, [59, 62, 66, 71]], [42, [58, 61, 66, 70]]];

/**
 * One bar grid from `start` to `end`; `moodAt(t)` picks 'calm' | 'drive' | 'tense' for each bar.
 * A held Dmaj9 rings out at `end`.
 */
export function music(duration, start, end, moodAt) {
  const buf = stereo(duration + 4);
  const beat = 60 / 84;
  const bar = beat * 4;
  let calm = 0;
  let tense = 0;
  for (let t = start; t < end - bar * 0.5; t += bar) {
    const mood = moodAt(t + 0.1);
    const loud = mood === 'drive' ? 1.15 : 1;
    if (mood === 'tense') {
      const [root, voicing] = TENSE[tense++ % TENSE.length];
      note(buf, t, bar, midi(root - 12), 0.16, { partials: [[1, 1], [2, 0.2]], attack: 0.4, decay: 8, release: 1.2 });
      voicing.forEach((n, k) => note(buf, t, bar, midi(n), 0.035, { ...PAD, pan: k % 2 ? 0.4 : -0.4 }));
      // A low pulse, like a held breath.
      for (let b = 0; b < 4; b++) note(buf, t + b * beat, 0.12, midi(root - 12), 0.12, { partials: [[1, 1], [2, 0.3, 0.05]], decay: 0.18, release: 0.05 });
      continue;
    }
    const [root, voicing] = CALM[calm++ % CALM.length];
    note(buf, t, bar, midi(root - 12), 0.13 * loud, { partials: [[1, 1], [2, 0.25]], decay: 2.2, release: 0.6 });
    voicing.forEach((n, k) => note(buf, t + k * 0.012, bar * 0.95, midi(n), 0.045 * loud, { ...KEYS, pan: (k / (voicing.length - 1)) * 1.2 - 0.6 }));
    voicing.forEach((n, k) => note(buf, t, bar, midi(n), 0.012, { ...PAD, pan: k % 2 ? 0.5 : -0.5 }));
    // Gentle arpeggio; busier when the story is moving.
    const steps = mood === 'drive' ? 8 : 4;
    const pattern = [0, 2, 4, 3, 1, 3, 4, 2];
    for (let s = 0; s < steps; s++) {
      const n = voicing[pattern[s] % voicing.length] + 12;
      note(buf, t + s * (bar / steps), 0.25, midi(n), 0.03 * loud, { ...PLUCK, pan: s % 2 ? 0.55 : -0.55 });
    }
  }
  [50, 57, 62, 66, 69, 73, 76].forEach((n, k) => note(buf, end + k * 0.03, 3.5, midi(n), 0.05, { ...KEYS, decay: 3, pan: (k / 6) * 1.2 - 0.6 }));
  reverb(buf, 0.35, 1.1);
  return buf;
}

// ---------------------------------------------------------------- sound effects

export const SFX = {
  /** An old-fashioned trilling telephone ring, two bursts. */
  ring(buf, at) {
    for (const burst of [0, 1.5]) {
      for (let k = 0; k < 18; k++) {
        const f = k % 2 ? 1318 : 1046;
        note(buf, at + burst + k * 0.05, 0.045, f, 0.05, { partials: [[1, 1], [2, 0.3], [3, 0.12]], attack: 0.002, decay: 0.2, release: 0.01, pan: 0.1 });
      }
    }
  },
  /** The ringback tone a caller hears, for bridging family and staff in. */
  ringback(buf, at, pan = 0) {
    for (const f of [440, 480]) note(buf, at, 0.9, f, 0.035, { attack: 0.02, decay: 30, release: 0.05, pan });
  },
  connect(buf, at) {
    note(buf, at, 0.08, midi(88), 0.07, { partials: [[1, 1], [2, 0.2]], decay: 0.12, release: 0.05 });
    note(buf, at + 0.09, 0.12, midi(93), 0.07, { partials: [[1, 1], [2, 0.2]], decay: 0.2, release: 0.08 });
  },
  pop(buf, at, pitch = 0) {
    const [L, R] = buf;
    const s0 = Math.floor(at * RATE);
    let ph = 0;
    for (let i = 0; i < RATE * 0.09; i++) {
      const t = i / RATE;
      const f = (720 + pitch * 60) * Math.exp(-t * 18) + 260;
      ph += (TAU * f) / RATE;
      const v = Math.sin(ph) * Math.exp(-t * 38) * 0.11;
      if (s0 + i < L.length) { L[s0 + i] += v; R[s0 + i] += v; }
    }
  },
  tick(buf, at) {
    note(buf, at, 0.02, 2400, 0.03, { attack: 0.001, decay: 0.012, release: 0.005 });
  },
  whoosh(buf, at, dur = 0.55) {
    const [L, R] = buf;
    const rnd = noise(Math.floor(at * 1000));
    const s0 = Math.floor(at * RATE);
    let lp = 0, bp = 0;
    for (let i = 0; i < RATE * dur; i++) {
      const p = i / (RATE * dur);
      const fc = 300 + 2600 * Math.sin(Math.PI * p) ** 2;
      const a = Math.min(1, (fc * TAU) / RATE);
      lp += a * (rnd() - lp);
      bp += a * (lp - bp);
      const v = (lp - bp) * Math.sin(Math.PI * p) ** 2 * 0.5;
      const idx = s0 + i;
      if (idx < L.length) { L[idx] += v * (1 - p); R[idx] += v * p; }
    }
  },
  chime(buf, at, root = 81) {
    for (const [n, a] of [[root, 0.07], [root + 7, 0.05], [root + 12, 0.035]]) {
      note(buf, at, 2.2, midi(n), a, { partials: [[1, 1], [2.76, 0.35, 0.6], [5.4, 0.18, 0.25], [8.9, 0.08, 0.1]], decay: 1.4, release: 0.6 });
    }
  },
  alert(buf, at) {
    for (let k = 0; k < 2; k++) {
      note(buf, at + k * 0.42, 0.16, midi(76), 0.07, { partials: [[1, 1], [2, 0.4], [3, 0.2]], decay: 0.3, release: 0.05 });
      note(buf, at + k * 0.42 + 0.18, 0.16, midi(72), 0.07, { partials: [[1, 1], [2, 0.4], [3, 0.2]], decay: 0.3, release: 0.05 });
    }
  },
  join(buf, at) {
    [69, 73, 76].forEach((n, k) => note(buf, at + k * 0.07, 0.25, midi(n + 12), 0.05, { ...PLUCK, decay: 0.5 }));
  },
  ping(buf, at, n = 0) {
    const scale = [74, 76, 78, 81, 83, 86, 88, 90];
    note(buf, at, 0.3, midi(scale[n % scale.length]), 0.035, { ...PLUCK, decay: 0.6, pan: ((n % 5) - 2) / 3 });
  },
};

/**
 * Lays voices and effects over the music and ducks the music under speech.
 * `voices`: [{at, data: Float32Array mono, gain}]; `effects`: [{at, name, args}].
 */
export function mix(duration, voices, effects, bed) {
  const [L, R] = stereo(duration);
  const voiceL = new Float32Array(L.length);
  for (const v of voices) {
    const s0 = Math.floor(v.at * RATE);
    for (let i = 0; i < v.data.length && s0 + i < L.length; i++) voiceL[s0 + i] += v.data[i] * v.gain;
  }
  const fx = stereo(duration);
  for (const e of effects) SFX[e.name](fx, e.at, ...(e.args ?? []));
  // Duck: follow the voice level, quick down, slow up.
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const level = Math.min(1, Math.abs(voiceL[i]) * 8);
    env = level > env ? env + (level - env) * 0.002 : env + (level - env) * 0.00004;
    const g = 0.5 - 0.32 * Math.min(1, env * 1.6);
    const m = i < bed[0].length ? [bed[0][i] * g, bed[1][i] * g] : [0, 0];
    L[i] = voiceL[i] + fx[0][i] + m[0];
    R[i] = voiceL[i] + fx[1][i] + m[1];
  }
  return [L, R];
}
