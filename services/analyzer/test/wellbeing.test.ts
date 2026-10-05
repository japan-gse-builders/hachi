import type { CallTag } from '@hachi/core';
import { describe, expect, it } from 'vitest';
import type { ModelTag } from '../src/model.js';
import {
  familyHeadline,
  groundTags,
  HEADLINE_MAX_CHARS,
  MIN_INFERRED_CONFIDENCE,
  MIN_INFERRED_MOOD_CONFIDENCE,
  MIN_SAID_CONFIDENCE,
  wellbeingFrom,
} from '../src/wellbeing.js';
import { review, TRANSCRIPT } from './fixtures.js';

const tag = (id: string, turn: number, basis: ModelTag['basis'], confidence: number): ModelTag => ({ id, turn, basis, confidence });

describe('groundTags', () => {
  it('keeps only vocabulary tags that cite a resident turn', () => {
    const kept = groundTags(
      [tag('body.tired', 1, 'said', 0.9), tag('body.sleepy', 1, 'said', 0.9), tag('food.ate_little', 2, 'said', 0.9), tag('food.skipped_meals', 9, 'said', 0.9)],
      TRANSCRIPT,
    );
    expect(kept).toEqual([{ id: 'body.tired', turn: 1, basis: 'said', confidence: 0.9 }]);
  });

  it('needs more confidence for inferred tags than for said ones', () => {
    expect(MIN_INFERRED_CONFIDENCE).toBeGreaterThan(MIN_SAID_CONFIDENCE);
    const kept = groundTags(
      [
        tag('body.tired', 1, 'said', MIN_SAID_CONFIDENCE),
        tag('food.ate_little', 3, 'said', MIN_SAID_CONFIDENCE - 0.01),
        tag('activity.stayed_in', 1, 'inferred', MIN_INFERRED_CONFIDENCE),
        tag('social.no_contact', 3, 'inferred', MIN_INFERRED_CONFIDENCE - 0.01),
      ],
      TRANSCRIPT,
    );
    expect(kept.map((t) => t.id)).toEqual(['body.tired', 'activity.stayed_in']);
  });

  it('needs even more confidence to infer mood, which small talk easily suggests', () => {
    expect(MIN_INFERRED_MOOD_CONFIDENCE).toBeGreaterThan(MIN_INFERRED_CONFIDENCE);
    const kept = groundTags(
      [
        tag('mood.cheerful', 1, 'inferred', MIN_INFERRED_MOOD_CONFIDENCE - 0.01),
        tag('mood.lonely', 3, 'inferred', MIN_INFERRED_MOOD_CONFIDENCE),
        tag('mood.calm', 1, 'said', MIN_SAID_CONFIDENCE),
      ],
      TRANSCRIPT,
    );
    expect(kept.map((t) => t.id)).toEqual(['mood.lonely', 'mood.calm']);
  });

  it('keeps one tag per id, preferring what was said, then the more confident', () => {
    const kept = groundTags(
      [
        tag('food.ate_little', 1, 'inferred', 0.95),
        tag('food.ate_little', 3, 'said', 0.6),
        tag('food.ate_little', 3, 'said', 0.8),
        tag('food.ate_little', 1, 'said', 0.7),
        tag('food.ate_little', 1, 'inferred', 0.99),
      ],
      TRANSCRIPT,
    );
    expect(kept).toEqual([{ id: 'food.ate_little', turn: 3, basis: 'said', confidence: 0.8 }]);
  });
});

describe('familyHeadline', () => {
  const cheerful: CallTag[] = [{ id: 'mood.cheerful', turn: 1, basis: 'said', confidence: 0.9 }];
  const walked: CallTag[] = [{ id: 'activity.went_out', turn: 1, basis: 'said', confidence: 0.9 }];

  it('keeps one plain sentence, tidied', () => {
    expect(familyHeadline('  Maggie went for a walk and\n ate a good lunch.  ', walked)).toBe('Maggie went for a walk and ate a good lunch.');
    expect(familyHeadline("Maggie's garden is doing well and she slept well.", [])).toBe("Maggie's garden is doing well and she slept well.");
    expect(familyHeadline('Maggie is feeling well and looking forward to her grandson visiting.', [])).toBe(
      'Maggie is feeling well and looking forward to her grandson visiting.',
    );
  });

  it('describes mood only when a kept mood tag backs it, so it matches the mood tile', () => {
    expect(familyHeadline('Maggie was cheerful and enjoyed her walk.', cheerful)).toBe('Maggie was cheerful and enjoyed her walk.');
    for (const s of [
      'Edith seemed cheerful and in good spirits, just a little tired.',
      'Margaret seemed well rested and content.',
      'Maggie spoke happily about her grandson.',
      'Walter seemed a bit down today.',
      'Maggie was calm and relaxed.',
      'She sounded low.',
      'Maggie felt lonely this week.',
    ]) {
      expect(familyHeadline(s, walked)).toBeUndefined();
    }
  });

  it('drops empty, long or quoting sentences', () => {
    expect(familyHeadline('   ', [])).toBeUndefined();
    expect(familyHeadline('a'.repeat(HEADLINE_MAX_CHARS + 1), [])).toBeUndefined();
    for (const q of ['She said "I am fine".', 'She said “I am fine”.', 'She said ‘I am fine’.', '「元気」と言った。']) expect(familyHeadline(q, [])).toBeUndefined();
  });

  it('drops diagnosis words and anything about how she speaks (FAM-03)', () => {
    for (const s of [
      'Maggie may be showing signs of dementia.',
      'She seemed depressed today.',
      'Maggie sounded a little confused about the day.',
      'Her speech was slower than usual.',
      'Maggie spoke more slowly than usual.',
      'She asked about her medication.',
      'She has a chest infection.',
    ]) {
      expect(familyHeadline(s, cheerful)).toBeUndefined();
    }
  });
});

describe('wellbeingFrom', () => {
  it('derives domain states from the kept tags only', () => {
    const w = wellbeingFrom(review({ tags: [tag('sleep.slept_well', 1, 'said', 0.9), tag('sleep.slept_badly', 0, 'said', 0.9)], headline: '' }), TRANSCRIPT);
    expect(w).toEqual({
      tags: [{ id: 'sleep.slept_well', turn: 1, basis: 'said', confidence: 0.9 }],
      domains: { body: 'unmentioned', food: 'unmentioned', sleep: 'good', mood: 'unmentioned', social: 'unmentioned', activity: 'unmentioned', practical: 'unmentioned', speech: 'unmentioned' },
    });
  });

  it('drops a cheerful headline when the inferred cheerful tag did not pass', () => {
    const headline = 'Maggie seemed cheerful and slept well.';
    const weak = review({ tags: [tag('sleep.slept_well', 1, 'said', 0.9), tag('mood.cheerful', 1, 'inferred', 0.85)], headline });
    expect(wellbeingFrom(weak, TRANSCRIPT).headline).toBeUndefined();
    const strong = review({ tags: [tag('sleep.slept_well', 1, 'said', 0.9), tag('mood.cheerful', 1, 'inferred', 0.95)], headline });
    expect(wellbeingFrom(strong, TRANSCRIPT).headline).toBe(headline);
  });
});
