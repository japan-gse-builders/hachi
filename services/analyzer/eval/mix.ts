/**
 * Assembles a SYNTHETIC stereo call recording in the voice gateway's format: 8 kHz 16-bit PCM,
 * channel 0 (left) = resident, channel 1 (right) = Hachi.
 */
import { speechSegments, type Turn } from '@hachi/core';
import { gaussian, rng } from './scenario.js';

export interface Clip {
  speaker: 'resident' | 'agent';
  pcm: Int16Array;
  /** Silence after the previous clip ends. */
  gapBeforeMs: number;
  /** Transcript text for this clip. */
  text: string;
}

export interface MixOptions {
  sampleRate: number;
  tailMs?: number;
  /** Level of the background hiss on the resident's line. */
  noiseDbfs?: number;
  noiseSeed?: number;
}

export interface MixedCall {
  wav: Buffer;
  transcript: Turn[];
  durationMs: number;
}

/** Cuts the leading and trailing silence of a synthesised clip so scripted gaps are exact. */
export function trimSilence(pcm: Int16Array, sampleRate: number): Int16Array {
  const segs = speechSegments(pcm, sampleRate);
  if (!segs.length) return pcm;
  const from = Math.floor((segs[0]!.startMs * sampleRate) / 1000);
  const to = Math.min(pcm.length, Math.ceil((segs[segs.length - 1]!.endMs * sampleRate) / 1000));
  return pcm.slice(from, to);
}

export function stereoWav(left: Int16Array, right: Int16Array, sampleRate: number): Buffer {
  const frames = Math.max(left.length, right.length);
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(left[i] ?? 0, i * 4);
    data.writeInt16LE(right[i] ?? 0, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const clamp16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));

/** Places each clip `gapBeforeMs` after the previous one ends and builds the matching transcript. */
export function mixCall(clips: Clip[], opts: MixOptions): MixedCall {
  const { sampleRate, tailMs = 1000, noiseDbfs = -70, noiseSeed = 1 } = opts;
  const toSamples = (ms: number) => Math.round((ms * sampleRate) / 1000);
  const toMs = (n: number) => (n * 1000) / sampleRate;
  const placed: { clip: Clip; start: number }[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const start = cursor + toSamples(clip.gapBeforeMs);
    placed.push({ clip, start });
    cursor = start + clip.pcm.length;
  }
  const total = cursor + toSamples(tailMs);
  const left = new Int16Array(total);
  const right = new Int16Array(total);
  for (const { clip, start } of placed) (clip.speaker === 'resident' ? left : right).set(clip.pcm, start);
  if (noiseDbfs > -120) {
    const r = rng(noiseSeed);
    const sd = 32768 * 10 ** (noiseDbfs / 20);
    for (let i = 0; i < total; i++) left[i] = clamp16(left[i]! + sd * gaussian(r));
  }
  const transcript: Turn[] = placed.map(({ clip, start }) => ({
    speaker: clip.speaker,
    text: clip.text,
    startMs: Math.round(toMs(start)),
    endMs: Math.round(toMs(start + clip.pcm.length)),
  }));
  return { wav: stereoWav(left, right, sampleRate), transcript, durationMs: Math.round(toMs(total)) };
}
