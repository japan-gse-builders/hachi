import { parseWav, tokenize } from '@hachi/core';
import { describe, expect, it, vi } from 'vitest';
import { ReviewError } from '../src/model.js';
import { GcsRecordings, GeminiListener, LISTENING_JSON_SCHEMA, listeningSchema, measureRecording } from '../src/voice.js';
import { FakeListener, listening, recording, TRANSCRIPT } from './fixtures.js';

function listener(impl: () => Promise<{ text?: string }>) {
  const generateContent = vi.fn((_req: unknown) => impl());
  return { generateContent, l: new GeminiListener({ models: { generateContent } } as never, 'gemini-3.8-flash') };
}

describe('GcsRecordings', () => {
  it('downloads the object named by a gs:// URI', async () => {
    const download = vi.fn(async () => [Buffer.from('wav')]);
    const file = vi.fn(() => ({ download }));
    const bucket = vi.fn(() => ({ file }));
    const r = new GcsRecordings({ bucket } as never);
    await expect(r.read('gs://hachi-rec/res-1/call-1.wav')).resolves.toEqual(Buffer.from('wav'));
    expect(bucket).toHaveBeenCalledWith('hachi-rec');
    expect(file).toHaveBeenCalledWith('res-1/call-1.wav');
  });

  it('rejects anything that is not a gs:// object', async () => {
    const r = new GcsRecordings({ bucket: vi.fn() } as never);
    for (const uri of ['https://example.org/a.wav', 'gs://bucket-only', 'gs:///path']) await expect(r.read(uri)).rejects.toThrow('gs://');
  });
});

describe('GeminiListener', () => {
  it('sends the audio inline and asks for structured JSON', async () => {
    const { l, generateContent } = listener(async () => ({ text: JSON.stringify(listening()) }));
    await expect(l.listen(Buffer.from('RIFF'))).resolves.toEqual(listening());
    const req = generateContent.mock.calls[0]![0] as { model: string; contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[]; config: Record<string, unknown> };
    expect(req.model).toBe('gemini-3.8-flash');
    expect(req.contents[0]!.parts[0]!.inlineData).toEqual({ mimeType: 'audio/wav', data: Buffer.from('RIFF').toString('base64') });
    expect(req.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: LISTENING_JSON_SCHEMA, temperature: 0 });
    expect(l.model).toBe('gemini-3.8-flash');
  });

  it('requires every field in the JSON schema', () => {
    expect([...LISTENING_JSON_SCHEMA.required].sort()).toEqual(Object.keys(listeningSchema.shape).sort());
  });

  it('retries outages and bad output but not bad requests', async () => {
    for (const err of [Object.assign(new Error('quota'), { status: 429 }), Object.assign(new Error('down'), { status: 500 }), new Error('ECONNRESET')]) {
      await expect(listener(async () => Promise.reject(err)).l.listen(Buffer.alloc(0))).rejects.toMatchObject({ retryable: true });
    }
    const bad = await listener(async () => Promise.reject(Object.assign(new Error('too large'), { status: 400 }))).l.listen(Buffer.alloc(0)).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ReviewError);
    expect(bad).toMatchObject({ retryable: false });
    for (const text of [undefined, 'not json', JSON.stringify({ ...listening(), audioQuality: 3 }), JSON.stringify({ verbatim: 'x', disfluencies: [{ quote: 'x', kind: 'cough', atSec: 1 }], audioQuality: 1 })]) {
      await expect(listener(async () => (text === undefined ? {} : { text })).l.listen(Buffer.alloc(0))).rejects.toMatchObject({ retryable: true });
    }
  });
});

describe('measureRecording', () => {
  it('times answers from the audio and counts repairs the model heard', async () => {
    const fake = new FakeListener();
    const m = await measureRecording(recording(), TRANSCRIPT, fake);
    expect(m.responseLatencyMs).toBe(1000);
    expect(m.repairRate).toBeCloseTo((3 / tokenize(listening().verbatim).length) * 100);
    expect(m.audioQuality).toBe(0.9);
    expect(m.examples).toEqual([
      { kind: 'slow_response', quote: TRANSCRIPT[1]!.text, startMs: 5000 },
      { kind: 'slow_response', quote: TRANSCRIPT[3]!.text, startMs: 13000 },
      { kind: 'false_start', quote: 'grand- grandson', startMs: 7200 },
      { kind: 'repetition', quote: 'a a biscuit', startMs: 15100 },
    ]);
    const sent = parseWav(fake.heard[0]!);
    expect(sent.channels).toHaveLength(1);
    expect(sent.sampleRate).toBe(8000);
  });

  it('does not ask the model when the resident barely spoke', async () => {
    const fake = new FakeListener();
    const m = await measureRecording(recording([[5000, 7000]]), TRANSCRIPT, fake);
    expect(fake.heard).toHaveLength(0);
    expect(m).toMatchObject({ responseLatencyMs: 1000, repairRate: null, audioQuality: null });
  });

  it('has no repair rate when the model heard no words', async () => {
    const fake = new FakeListener();
    fake.fallback = listening({ verbatim: '', disfluencies: [] });
    expect((await measureRecording(recording(), TRANSCRIPT, fake)).repairRate).toBeNull();
  });

  it('keeps only examples it can point to in the transcript', async () => {
    const m = await measureRecording(recording(), TRANSCRIPT.slice(0, 2), new FakeListener());
    expect(m.examples.filter((e) => e.kind === 'slow_response')).toHaveLength(1);
    expect(m.examples).toHaveLength(3);
  });

  it('fails on a recording it cannot read', async () => {
    await expect(measureRecording(Buffer.from('nope'), TRANSCRIPT, new FakeListener())).rejects.toThrow('Not a WAV');
  });
});
