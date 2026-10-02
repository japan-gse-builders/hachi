/**
 * Audio plumbing between Twilio Media Streams (G.711 μ-law, 8 kHz, mono) and the Gemini Live API
 * (16-bit PCM: 16 kHz in, 24 kHz out).
 */

const BIAS = 0x84;
const CLIP = 32635;

function linearToMuLaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let s = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  s = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return s;
}

function muLawToLinear(u: number): number {
  const v = ~u & 0xff;
  const sign = v & 0x80;
  const exponent = (v >> 4) & 0x07;
  const mantissa = v & 0x0f;
  const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -sample : sample;
}

const DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) DECODE[i] = muLawToLinear(i);
const ENCODE = new Uint8Array(65536);
for (let i = -32768; i < 32768; i++) ENCODE[i & 0xffff] = linearToMuLaw(i);

export function decodeMuLaw(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]!]!;
  return out;
}

export function encodeMuLaw(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = ENCODE[pcm[i]! & 0xffff]!;
  return out;
}

export function pcmFromBytes(buf: Uint8Array): Int16Array {
  const n = buf.length >> 1;
  const out = new Int16Array(n);
  const view = new DataView(buf.buffer, buf.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function pcmToBytes(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i]!, i * 2);
  return out;
}

export function concatPcm(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

/** 8 kHz → 16 kHz by linear interpolation; keeps the last sample between chunks. */
export class Upsampler {
  private last = 0;

  process(pcm: Int16Array): Int16Array {
    const out = new Int16Array(pcm.length * 2);
    for (let i = 0; i < pcm.length; i++) {
      const s = pcm[i]!;
      out[2 * i] = (this.last + s) >> 1;
      out[2 * i + 1] = s;
      this.last = s;
    }
    return out;
  }
}

/** Windowed-sinc low-pass (cutoff 3.4 kHz at 24 kHz) so telephone audio does not alias. */
const TAPS = (() => {
  const n = 23;
  const fc = 3400 / 24000;
  const m = (n - 1) / 2;
  const taps = Array.from({ length: n }, (_, i) => {
    const x = i - m;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    return sinc * hamming;
  });
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map((t) => t / sum);
})();

/** 24 kHz → 8 kHz: low-pass, then keep every third sample. Stateful across chunks. */
export class Downsampler {
  private history = new Float64Array(TAPS.length - 1);
  private phase = 0;

  process(pcm: Int16Array): Int16Array {
    const h = this.history.length;
    const buf = new Float64Array(h + pcm.length);
    buf.set(this.history);
    for (let i = 0; i < pcm.length; i++) buf[h + i] = pcm[i]!;
    const out: number[] = [];
    let i = this.phase;
    for (; i < pcm.length; i += 3) {
      let acc = 0;
      for (let k = 0; k < TAPS.length; k++) acc += TAPS[k]! * buf[i + k]!;
      out.push(clamp16(acc));
    }
    this.phase = i - pcm.length;
    this.history = buf.slice(buf.length - h);
    return Int16Array.from(out);
  }

  reset(): void {
    this.history.fill(0);
    this.phase = 0;
  }
}

/** 16-bit PCM WAV. */
export function wavFile(channels: Int16Array[], sampleRate: number): Buffer {
  const frames = Math.max(0, ...channels.map((c) => c.length));
  const n = channels.length;
  const data = Buffer.alloc(frames * n * 2);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < n; c++) data.writeInt16LE(channels[c]![f] ?? 0, (f * n + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(n, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * n * 2, 28);
  header.writeUInt16LE(n * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
