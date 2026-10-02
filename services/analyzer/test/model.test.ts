import { describe, expect, it, vi } from 'vitest';
import { formatTranscript, GeminiReviewer, RESPONSE_JSON_SCHEMA, reviewInstruction, ReviewError, reviewSchema } from '../src/model.js';
import { review, TRANSCRIPT } from './fixtures.js';

function reviewer(impl: () => Promise<{ text?: string }>) {
  const generateContent = vi.fn((_req: unknown) => impl());
  return { generateContent, r: new GeminiReviewer({ models: { generateContent } } as never, 'gemini-3.8-flash') };
}

const input = { preferredName: 'Maggie', transcript: TRANSCRIPT, staffLocale: 'ja' as const };

describe('prompt', () => {
  it('labels turns with their index and speaker', () => {
    const text = formatTranscript('Maggie', TRANSCRIPT);
    expect(text).toContain('Resident: Maggie');
    expect(text).toContain('[0] Hachi: Good morning Maggie');
    expect(text).toContain('[3] Resident: Not really');
  });

  it('asks for the staff summary in the staff language and plain English for family', () => {
    expect(reviewInstruction('ja')).toContain('in Japanese');
    expect(reviewInstruction('en')).toContain('staffSummary: for care staff, in English');
    expect(reviewInstruction('ja')).toContain('familySummary: for family, in plain, warm English');
    expect(reviewInstruction('ja')).toMatch(/hedged/);
    expect(reviewInstruction('ja')).toMatch(/denials/);
  });

  it('requires every field of the review in the JSON schema', () => {
    expect([...RESPONSE_JSON_SCHEMA.required].sort()).toEqual(Object.keys(reviewSchema.shape).sort());
  });
});

describe('GeminiReviewer', () => {
  it('requests structured JSON and validates it', async () => {
    const { r, generateContent } = reviewer(async () => ({ text: JSON.stringify(review()) }));
    await expect(r.review(input)).resolves.toEqual(review());
    const req = generateContent.mock.calls[0]![0] as { model: string; config: Record<string, unknown> };
    expect(req.model).toBe('gemini-3.8-flash');
    expect(req.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: RESPONSE_JSON_SCHEMA });
    expect(r.model).toBe('gemini-3.8-flash');
  });

  it('treats rate limits, server errors and network errors as retryable', async () => {
    for (const err of [Object.assign(new Error('quota'), { status: 429 }), Object.assign(new Error('down'), { status: 503 }), new Error('ECONNRESET')]) {
      const { r } = reviewer(async () => Promise.reject(err));
      await expect(r.review(input)).rejects.toMatchObject({ name: 'ReviewError', retryable: true });
    }
  });

  it('treats a bad request as permanent', async () => {
    const { r } = reviewer(async () => Promise.reject(Object.assign(new Error('bad'), { status: 400 })));
    const err = await r.review(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect((err as ReviewError).retryable).toBe(false);
  });

  it('retries invalid or incomplete output', async () => {
    for (const text of [undefined, 'not json', JSON.stringify({ ...review(), topicCoherence: 2 }), JSON.stringify({ emergencies: [] })]) {
      const { r } = reviewer(async () => ({ ...(text === undefined ? {} : { text }) }));
      await expect(r.review(input)).rejects.toMatchObject({ retryable: true });
    }
  });
});
