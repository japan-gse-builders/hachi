import { describe, expect, it } from 'vitest';
import { concatPcm, decodeMuLaw, Downsampler, encodeMuLaw, pcmFromBytes, pcmToBytes, Upsampler, wavFile } from '../src/audio.js';
import { CallRecorder } from '../src/recorder.js';

function sine(freq: number, rate: number, samples: number, amp = 10_000): Int16Array {
  return Int16Array.from({ length: samples }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate)));
}

function rms(pcm: Int16Array, skip = 0): number {
  let s = 0;
  for (let i = skip; i < pcm.length; i++) s += pcm[i]! ** 2;
  return Math.sqrt(s / (pcm.length - skip));
}

describe('μ-law', () => {
  it('encodes silence as 0xFF and decodes it back to 0', () => {
    expect([...encodeMuLaw(new Int16Array([0, 0]))]).toEqual([0xff, 0xff]);
    expect([...decodeMuLaw(new Uint8Array([0xff, 0x7f]))]).toEqual([0, 0]);
  });

  it('round-trips within the G.711 quantization error', () => {
    for (const v of [-32768, -20000, -1000, -10, 10, 1000, 8000, 20000, 32767]) {
      const back = decodeMuLaw(encodeMuLaw(new Int16Array([v])))[0]!;
      expect(Math.sign(back)).toBe(Math.sign(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(8, Math.abs(v) * 0.07));
    }
  });

  it('is symmetric for positive and negative samples', () => {
    const pos = decodeMuLaw(encodeMuLaw(new Int16Array([12345])))[0]!;
    const neg = decodeMuLaw(encodeMuLaw(new Int16Array([-12345])))[0]!;
    expect(neg).toBe(-pos);
  });

  it('decodes every code to a 16-bit value that re-encodes to itself', () => {
    const codes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const again = encodeMuLaw(decodeMuLaw(codes));
    for (let i = 0; i < 256; i++) {
      // 0x7F and 0xFF are both zero.
      if (i !== 0x7f) expect(again[i]).toBe(i);
    }
  });
});

describe('PCM helpers', () => {
  it('converts little-endian bytes both ways', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const bytes = pcmToBytes(pcm);
    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect([...pcmFromBytes(bytes)]).toEqual([...pcm]);
  });

  it('reads from an offset buffer and ignores a trailing odd byte', () => {
    const backing = Buffer.from([9, 0x34, 0x12, 0x01]);
    expect([...pcmFromBytes(backing.subarray(1))]).toEqual([0x1234]);
  });

  it('concatenates chunks', () => {
    expect([...concatPcm([new Int16Array([1, 2]), new Int16Array([]), new Int16Array([3])])]).toEqual([1, 2, 3]);
  });
});

describe('Upsampler', () => {
  it('doubles the rate with interpolation that continues across chunks', () => {
    const up = new Upsampler();
    expect([...up.process(new Int16Array([100, 200]))]).toEqual([50, 100, 150, 200]);
    expect([...up.process(new Int16Array([0]))]).toEqual([100, 0]);
  });
});

describe('Downsampler', () => {
  it('keeps every third sample across arbitrary chunk sizes', () => {
    const one = new Downsampler();
    const input = sine(500, 24_000, 2400);
    const whole = one.process(input);
    expect(whole.length).toBe(800);

    const chunked = new Downsampler();
    const parts = [chunked.process(input.subarray(0, 7)), chunked.process(input.subarray(7, 1001)), chunked.process(input.subarray(1001))];
    expect([...concatPcm(parts)]).toEqual([...whole]);
  });

  it('passes speech frequencies and attenuates content above the telephone band', () => {
    const speech = new Downsampler().process(sine(1000, 24_000, 4800));
    const high = new Downsampler().process(sine(7000, 24_000, 4800));
    expect(rms(speech, 20) / (10_000 / Math.SQRT2)).toBeGreaterThan(0.9);
    expect(rms(high, 20) / (10_000 / Math.SQRT2)).toBeLessThan(0.1);
  });

  it('clamps to 16 bits and resets its state', () => {
    const d = new Downsampler();
    const loud = d.process(new Int16Array(300).fill(32767));
    expect(Math.max(...loud)).toBeLessThanOrEqual(32767);
    d.process(new Int16Array([1]));
    d.reset();
    expect([...d.process(new Int16Array(3))]).toEqual([0]);
  });
});

describe('wavFile', () => {
  it('writes a valid stereo 16-bit header and pads the shorter channel', () => {
    const wav = wavFile([new Int16Array([1, 2]), new Int16Array([3])], 8000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt32LE(28)).toBe(32_000);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.readUInt32LE(4)).toBe(36 + 8);
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(50)]).toEqual([1, 3, 2, 0]);
  });

  it('handles an empty recording', () => {
    expect(wavFile([new Int16Array(), new Int16Array()], 8000).length).toBe(44);
  });
});

describe('CallRecorder', () => {
  const loud = (n: number) => encodeMuLaw(new Int16Array(n).fill(8000));
  const silence = (n: number) => Buffer.alloc(n, 0xff);
  const channels = (wav: Buffer) => {
    const frames = (wav.length - 44) / 4;
    const left: number[] = [];
    const right: number[] = [];
    for (let f = 0; f < frames; f++) {
      left.push(wav.readInt16LE(44 + f * 4));
      right.push(wav.readInt16LE(46 + f * 4));
    }
    return { left, right };
  };

  it('tracks elapsed time from the resident audio', () => {
    const r = new CallRecorder();
    r.appendInbound(silence(160));
    r.appendInbound(silence(160));
    expect(r.elapsedMs).toBe(40);
  });

  it('places Hachi audio where it starts playing and queues consecutive chunks', () => {
    const r = new CallRecorder();
    r.appendInbound(silence(10));
    r.appendOutbound(loud(5));
    r.appendOutbound(loud(5));
    r.appendInbound(silence(30));
    const { left, right } = channels(r.toWav());
    expect(left).toHaveLength(40);
    expect(right.slice(0, 10).every((v) => v === 0)).toBe(true);
    expect(right.slice(10, 20).every((v) => v > 7000)).toBe(true);
    expect(right.slice(20).every((v) => v === 0)).toBe(true);
  });

  it('cuts audio that was cleared before it played', () => {
    const r = new CallRecorder();
    r.appendOutbound(loud(100));
    r.appendInbound(silence(30));
    r.clearOutbound();
    r.appendOutbound(loud(10));
    r.appendInbound(silence(70));
    const { right } = channels(r.toWav());
    expect(right.filter((v) => v > 7000)).toHaveLength(40);
    expect(right.slice(30, 40).every((v) => v > 7000)).toBe(true);
    expect(right.slice(40).every((v) => v === 0)).toBe(true);
  });

  it('keeps audio that already finished playing when cleared', () => {
    const r = new CallRecorder();
    r.appendOutbound(loud(10));
    r.appendInbound(silence(20));
    r.clearOutbound();
    expect(channels(r.toWav()).right.filter((v) => v > 7000)).toHaveLength(10);
  });

  it('drops queued audio entirely when cleared before it started', () => {
    const r = new CallRecorder();
    r.appendInbound(silence(10));
    r.appendOutbound(loud(10));
    r.appendOutbound(loud(10));
    r.clearOutbound();
    r.appendInbound(silence(10));
    const { right } = channels(r.toWav());
    expect(right.filter((v) => v !== 0)).toHaveLength(0);
  });

  it('extends the recording to cover Hachi audio still playing at the end', () => {
    const r = new CallRecorder();
    r.appendInbound(silence(5));
    r.appendOutbound(loud(20));
    expect(channels(r.toWav()).right).toHaveLength(25);
  });
});
