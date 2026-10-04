import { describe, expect, it } from 'vitest';
import {
  frameLevels,
  measureVoiceTiming,
  mergeSegments,
  monoWav,
  parseWav,
  responseGaps,
  speechSegments,
  type Segment,
} from '../src/voice.js';

const RATE = 8000;

/** A quiet line with "speech" (a 300 Hz tone) during the given segments. */
function line(durationMs: number, speech: Segment[], amplitude = 8000): Int16Array {
  const out = new Int16Array((durationMs * RATE) / 1000);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? 20 : -20;
  for (const s of speech) {
    for (let i = (s.startMs * RATE) / 1000; i < (s.endMs * RATE) / 1000 && i < out.length; i++) {
      out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 300 * i) / RATE));
    }
  }
  return out;
}

function stereoWav(left: Int16Array, right: Int16Array): Buffer {
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i++) {
    data.writeInt16LE(left[i]!, i * 4);
    data.writeInt16LE(right[i] ?? 0, i * 4 + 2);
  }
  const header = monoWav(new Int16Array(0), RATE);
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('parseWav / monoWav', () => {
  it('round-trips mono and reads stereo channels apart', () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);
    expect(parseWav(monoWav(samples, RATE))).toEqual({ sampleRate: RATE, channels: [samples] });
    const stereo = parseWav(stereoWav(Int16Array.from([1, 2]), Int16Array.from([3, 4])));
    expect(stereo.channels.map((c) => [...c])).toEqual([[1, 2], [3, 4]]);
  });

  it('skips unknown chunks and rejects files it cannot read', () => {
    const wav = monoWav(Int16Array.from([5, 6]), RATE);
    const list = Buffer.from('LIST\u0003\u0000\u0000\u0000abc\u0000', 'latin1');
    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
    expect([...parseWav(withList).channels[0]!]).toEqual([5, 6]);

    expect(() => parseWav(Buffer.from('nope'))).toThrow('Not a WAV');
    const float = Buffer.from(wav);
    float.writeUInt16LE(3, 20);
    expect(() => parseWav(float)).toThrow('16-bit PCM');
    expect(() => parseWav(wav.subarray(0, 36))).toThrow('no data');
    const dataFirst = Buffer.concat([wav.subarray(0, 12), wav.subarray(36)]);
    expect(() => parseWav(dataFirst)).toThrow('before format');
  });
});

describe('speech segments', () => {
  it('finds speech above the line noise and ignores clicks', () => {
    const samples = line(5000, [{ startMs: 1000, endMs: 2000 }, { startMs: 3000, endMs: 3060 }]);
    expect(speechSegments(samples, RATE)).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });

  it('keeps short gaps between words inside one segment', () => {
    const samples = line(4000, [{ startMs: 500, endMs: 1000 }, { startMs: 1200, endMs: 1800 }]);
    expect(speechSegments(samples, RATE)).toEqual([{ startMs: 500, endMs: 1800 }]);
  });

  it('handles speech running to the end and silence-only lines', () => {
    expect(speechSegments(line(2000, [{ startMs: 1500, endMs: 2000 }]), RATE)).toEqual([{ startMs: 1500, endMs: 2000 }]);
    expect(speechSegments(new Int16Array(8000), RATE)).toEqual([]);
    expect(frameLevels(new Int16Array(160), RATE)).toEqual([-120]);
  });

  it('merges segments closer than the gap', () => {
    expect(mergeSegments([{ startMs: 0, endMs: 100 }, { startMs: 150, endMs: 200 }, { startMs: 900, endMs: 1000 }], 100)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 900, endMs: 1000 },
    ]);
  });
});

describe('responseGaps', () => {
  const agent = [{ startMs: 0, endMs: 2000 }, { startMs: 5000, endMs: 7000 }];

  it('measures from the end of Hachi speaking to the start of the answer', () => {
    expect(responseGaps([{ startMs: 3500, endMs: 4500 }, { startMs: 8000, endMs: 9000 }], agent).map((g) => g.gapMs)).toEqual([1500, 1000]);
  });

  it('treats Hachi pausing briefly mid-sentence as one turn', () => {
    const split = [{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 2000 }];
    expect(responseGaps([{ startMs: 3000, endMs: 4000 }], split).map((g) => g.gapMs)).toEqual([1000]);
  });

  it('skips interruptions, echo, unanswered turns and very long silences', () => {
    expect(responseGaps([{ startMs: 1500, endMs: 2500 }], agent)).toEqual([]);
    expect(responseGaps([{ startMs: 2050, endMs: 2100 }, { startMs: 6000, endMs: 6500 }], [{ startMs: 0, endMs: 2000 }]).map((g) => g.gapMs)).toEqual([4000]);
    expect(responseGaps([], agent)).toEqual([]);
    expect(responseGaps([{ startMs: 30_000, endMs: 31_000 }], [{ startMs: 0, endMs: 2000 }])).toEqual([]);
  });
});

describe('measureVoiceTiming', () => {
  it('reports the median response time and how long each side talked', () => {
    const resident = line(16000, [{ startMs: 3000, endMs: 5000 }, { startMs: 9000, endMs: 11000 }, { startMs: 13600, endMs: 15000 }]);
    const agent = line(16000, [{ startMs: 0, endMs: 2000 }, { startMs: 6000, endMs: 7000 }, { startMs: 12000, endMs: 13000 }]);
    const t = measureVoiceTiming(parseWav(stereoWav(resident, agent)));
    expect(t.gaps.map((g) => g.gapMs)).toEqual([1000, 2000, 600]);
    expect(t.responseLatencyMs).toBe(1000);
    expect(t.residentSpeechMs).toBe(5400);
    expect(t.agentSpeechMs).toBe(4000);
  });

  it('averages the middle two for an even number of answers and is null without any', () => {
    const resident = line(9000, [{ startMs: 3000, endMs: 4000 }, { startMs: 7000, endMs: 8000 }]);
    const agent = line(9000, [{ startMs: 0, endMs: 2000 }, { startMs: 4500, endMs: 5000 }]);
    expect(measureVoiceTiming(parseWav(stereoWav(resident, agent))).responseLatencyMs).toBe(1500);
    const silent = line(4000, []);
    expect(measureVoiceTiming(parseWav(stereoWav(silent, line(4000, [{ startMs: 0, endMs: 1000 }])))).responseLatencyMs).toBeNull();
  });

  it('needs both channels', () => {
    expect(() => measureVoiceTiming({ sampleRate: RATE, channels: [new Int16Array(10)] })).toThrow('resident and a Hachi channel');
  });
});
