import { decodeMuLaw, wavFile } from './audio.js';

const RATE = 8000;

/**
 * Stereo recording of one media stream: left = resident, right = Hachi.
 * The resident's audio arrives continuously (Twilio sends silence too), so its sample count is
 * the call clock. Hachi's audio is placed where it starts playing; audio cleared by a barge-in
 * was never heard, so it is cut from the recording.
 */
export class CallRecorder {
  private inbound: Buffer[] = [];
  private inboundSamples = 0;
  private outbound: { start: number; data: Buffer }[] = [];
  private outboundCursor = 0;

  appendInbound(mulaw: Buffer): void {
    this.inbound.push(mulaw);
    this.inboundSamples += mulaw.length;
  }

  appendOutbound(mulaw: Buffer): void {
    const start = Math.max(this.outboundCursor, this.inboundSamples);
    this.outbound.push({ start, data: mulaw });
    this.outboundCursor = start + mulaw.length;
  }

  clearOutbound(): void {
    const now = this.inboundSamples;
    this.outbound = this.outbound
      .filter((s) => s.start < now)
      .map((s) => (s.start + s.data.length > now ? { start: s.start, data: s.data.subarray(0, now - s.start) } : s));
    this.outboundCursor = now;
  }

  /** Milliseconds since the stream started. */
  get elapsedMs(): number {
    return Math.floor(this.inboundSamples / (RATE / 1000));
  }

  toWav(): Buffer {
    const left = decodeMuLaw(Buffer.concat(this.inbound));
    const length = Math.max(left.length, this.outboundCursor);
    const right = new Int16Array(length);
    for (const s of this.outbound) right.set(decodeMuLaw(s.data), s.start);
    return wavFile([left, right], RATE);
  }
}
