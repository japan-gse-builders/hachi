/**
 * SPK-01 from the recording itself: when each speaker is talking, and how long the resident takes
 * to answer after Hachi stops. Transcription arrives late and in chunks, so its timestamps are not
 * precise enough for response time.
 */

export interface PcmAudio {
  sampleRate: number;
  channels: Int16Array[];
}

export interface Segment {
  startMs: number;
  endMs: number;
}

/** Reads a 16-bit PCM WAV (the format the voice gateway records). */
export function parseWav(buf: Buffer): PcmAudio {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before format');
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('Only 16-bit PCM WAV is supported');
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * fmt.channels));
      const channels = Array.from({ length: fmt.channels }, () => new Int16Array(frames));
      for (let f = 0; f < frames; f++) {
        for (let c = 0; c < fmt.channels; c++) channels[c]![f] = buf.readInt16LE(body + (f * fmt.channels + c) * 2);
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data');
}

export function monoWav(samples: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i]!, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const FRAME_MS = 20;

/** Loudness of each 20 ms frame in dBFS. */
export function frameLevels(samples: Int16Array, sampleRate: number, frameMs = FRAME_MS): number[] {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0;
    for (let j = i; j < i + size; j++) sum += samples[j]! * samples[j]!;
    const rms = Math.sqrt(sum / size) / 32768;
    out.push(rms > 0 ? 20 * Math.log10(rms) : -120);
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return -120;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

export interface VadOptions {
  /** Speech must be this far above the line's own noise floor. */
  marginDb?: number;
  /** Never call anything quieter than this speech, however quiet the line is. */
  floorDb?: number;
  /** Silences shorter than this stay inside one segment (gaps between words). */
  bridgeMs?: number;
  /** Bursts shorter than this are clicks, not speech. */
  minSpeechMs?: number;
}

/** Energy-based voice activity with a threshold adapted to each line's background level. */
export function speechSegments(samples: Int16Array, sampleRate: number, opts: VadOptions = {}): Segment[] {
  const { marginDb = 15, floorDb = -50, bridgeMs = 300, minSpeechMs = 120 } = opts;
  const levels = frameLevels(samples, sampleRate);
  const threshold = Math.max(floorDb, percentile(levels, 10) + marginDb);
  const raw: Segment[] = [];
  let start = -1;
  levels.forEach((db, i) => {
    if (db >= threshold && start < 0) start = i;
    if (db < threshold && start >= 0) {
      raw.push({ startMs: start * FRAME_MS, endMs: i * FRAME_MS });
      start = -1;
    }
  });
  if (start >= 0) raw.push({ startMs: start * FRAME_MS, endMs: levels.length * FRAME_MS });
  return mergeSegments(raw, bridgeMs).filter((s) => s.endMs - s.startMs >= minSpeechMs);
}

export function mergeSegments(segments: Segment[], gapMs: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && s.startMs - last.endMs < gapMs) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out;
}

/** Hachi's speech is treated as one turn unless it pauses this long. */
const AGENT_TURN_GAP_MS = 800;
/** Room echo of Hachi's own voice can reach the resident's line just after Hachi stops. */
const ECHO_GUARD_MS = 150;
const MAX_RESPONSE_MS = 20_000;

export interface ResponseGap {
  /** When Hachi stopped speaking. */
  agentEndMs: number;
  /** When the resident started answering. */
  residentStartMs: number;
  gapMs: number;
}

/**
 * For each time Hachi finishes speaking, how long until the resident starts. Turns where the
 * resident was already talking (interrupting or answering early) or never answered are left out.
 */
export function responseGaps(resident: Segment[], agent: Segment[]): ResponseGap[] {
  const turns = mergeSegments(agent, AGENT_TURN_GAP_MS);
  const gaps: ResponseGap[] = [];
  turns.forEach((t, i) => {
    const next = turns[i + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    const overlapping = resident.some((r) => r.startMs < t.endMs && r.endMs > t.endMs);
    if (overlapping) return;
    const answer = resident.find((r) => r.startMs >= t.endMs + ECHO_GUARD_MS && r.startMs < next);
    if (!answer) return;
    const gapMs = answer.startMs - t.endMs;
    if (gapMs <= MAX_RESPONSE_MS) gaps.push({ agentEndMs: t.endMs, residentStartMs: answer.startMs, gapMs });
  });
  return gaps;
}

export interface VoiceTiming {
  /** Median response time, in ms. */
  responseLatencyMs: number | null;
  gaps: ResponseGap[];
  residentSpeechMs: number;
  agentSpeechMs: number;
}

/** Stereo call recording: channel 0 is the resident, channel 1 is Hachi. */
export function measureVoiceTiming(audio: PcmAudio): VoiceTiming {
  const [residentPcm, agentPcm] = audio.channels;
  if (!residentPcm || !agentPcm) throw new Error('The recording needs a resident and a Hachi channel');
  const resident = speechSegments(residentPcm, audio.sampleRate);
  const agent = speechSegments(agentPcm, audio.sampleRate);
  const gaps = responseGaps(resident, agent);
  const sorted = gaps.map((g) => g.gapMs).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const total = (s: Segment[]) => s.reduce((a, x) => a + x.endMs - x.startMs, 0);
  return { responseLatencyMs: median, gaps, residentSpeechMs: total(resident), agentSpeechMs: total(agent) };
}
