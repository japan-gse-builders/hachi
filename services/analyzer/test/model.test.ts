import { WELLBEING_TAG_IDS } from '@hachi/core';
import { describe, expect, it, vi } from 'vitest';
import { formatTranscript, GeminiReviewer, RESPONSE_JSON_SCHEMA, reviewInstruction, ReviewError, reviewSchema } from '../src/model.js';
import { review, TRANSCRIPT } from './fixtures.js';

function reviewer(impl: () => Promise<{ text?: string }>) {
  const generateContent = vi.fn((_req: unknown) => impl());
  return { generateContent, r: new GeminiReviewer({ models: { generateContent } } as never, 'gemini-3.8-flash') };
}

const input = { preferredName: 'Maggie', transcript: TRANSCRIPT, staffLocale: 'en' as const };

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

  it('lets the model choose tags only from the vocabulary, each citing a turn', () => {
    const item = RESPONSE_JSON_SCHEMA.properties.tags.items;
    expect(item.properties.id.enum).toEqual(WELLBEING_TAG_IDS);
    expect(item.properties.basis.enum).toEqual(['said', 'inferred']);
    expect([...item.required].sort()).toEqual(['basis', 'confidence', 'id', 'turn']);
    const prompt = reviewInstruction('en');
    for (const id of WELLBEING_TAG_IDS) expect(prompt).toContain(`- ${id}: `);
    expect(prompt).toContain('- food.ate_little: Ate little (ate much less than usual or no appetite)');
    expect(prompt).toMatch(/chosen ONLY from the list/);
    expect(prompt).toMatch(/headline: one short sentence for family/);
    expect(prompt).toMatch(/no quotes/);
  });
});

describe('review schema', () => {
  it('drops malformed tags without failing the review', () => {
    const r = reviewSchema.parse({
      ...review(),
      tags: [
        { id: 'body.tired', turn: 1, basis: 'said', confidence: 0.9 },
        { id: 'body.tired', turn: -1, basis: 'said', confidence: 0.9 },
        { id: 'body.tired', turn: 1, basis: 'guessed', confidence: 0.9 },
        { id: 'body.tired', turn: 1, basis: 'said', confidence: 3 },
        'body.tired',
      ],
      headline: '  Maggie sounded well.  ',
    });
    expect(r.tags).toEqual([{ id: 'body.tired', turn: 1, basis: 'said', confidence: 0.9 }]);
    expect(r.headline).toBe('Maggie sounded well.');
  });

  it('reads a review without tags or headline as having none, and caps the number of tags', () => {
    const { tags: _t, headline: _h, ...old } = review();
    expect(reviewSchema.parse(old)).toMatchObject({ tags: [], headline: '' });
    expect(reviewSchema.parse({ ...old, tags: 'none', headline: 42 })).toMatchObject({ tags: [], headline: '' });
    const many = Array.from({ length: 50 }, () => ({ id: 'body.tired', turn: 1, basis: 'said', confidence: 0.9 }));
    expect(reviewSchema.parse({ ...old, tags: many, headline: '' }).tags).toHaveLength(30);
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
