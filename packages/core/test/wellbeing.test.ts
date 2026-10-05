import { describe, expect, it } from 'vitest';
import {
  combineStates,
  DOMAIN_LABELS,
  domainStates,
  isWellbeingTagId,
  LIFE_DOMAINS,
  tagTrends,
  visibleToFamily,
  WELLBEING_DOMAINS,
  WELLBEING_TAG_IDS,
  WELLBEING_TAGS,
  wellbeingTag,
} from '../src/wellbeing.js';

describe('wellbeing tag vocabulary', () => {
  it('has unique ids named after their domain, with English and Japanese labels', () => {
    expect(new Set(WELLBEING_TAG_IDS).size).toBe(WELLBEING_TAGS.length);
    for (const t of WELLBEING_TAGS) {
      expect(t.id).toMatch(new RegExp(`^${t.domain}\\.[a-z_]+$`));
      expect(t.label.en.trim()).not.toBe('');
      expect(t.label.ja.trim()).not.toBe('');
    }
    for (const d of WELLBEING_DOMAINS) {
      expect(WELLBEING_TAGS.some((t) => t.domain === d)).toBe(true);
      expect(DOMAIN_LABELS.en[d]).toBeTruthy();
      expect(DOMAIN_LABELS.ja[d]).toBeTruthy();
    }
  });

  it('tells family about a recent fall even once recovered, but as a recovered fall', () => {
    expect(wellbeingTag('body.recovered_fall')).toMatchObject({ domain: 'body', polarity: 'concern', audience: 'family' });
    expect(wellbeingTag('body.recovered_fall').label.en).toContain('recovered');
    expect(domainStates(['body.recovered_fall', 'body.feeling_well']).body).toBe('mixed');
  });

  it('shows six life domains at a glance, without practical needs or speech', () => {
    expect(LIFE_DOMAINS).toEqual(['body', 'food', 'sleep', 'mood', 'social', 'activity']);
  });

  it('keeps speech staff-only and mood and practical needs behind consent (FAM-03)', () => {
    const audiences = (domain: string) => new Set(WELLBEING_TAGS.filter((t) => t.domain === domain).map((t) => t.audience));
    expect(audiences('speech')).toEqual(new Set(['staff']));
    expect(audiences('mood')).toEqual(new Set(['family_with_consent']));
    expect(audiences('practical')).toEqual(new Set(['family_with_consent']));
    for (const d of ['body', 'food', 'sleep', 'social', 'activity']) expect(audiences(d)).toEqual(new Set(['family']));
    expect(visibleToFamily('food.ate_little')).toBe(true);
    expect(visibleToFamily('mood.lonely')).toBe(false);
    expect(visibleToFamily('practical.money_worry')).toBe(false);
    expect(visibleToFamily('speech.slower')).toBe(false);
  });

  it('has positive and concern tags in every life domain, and only concerns for practical needs', () => {
    for (const d of LIFE_DOMAINS) {
      expect(WELLBEING_TAGS.filter((t) => t.domain === d).map((t) => t.polarity)).toEqual(expect.arrayContaining(['positive', 'concern']));
    }
    expect(WELLBEING_TAGS.filter((t) => t.domain === 'practical').every((t) => t.polarity === 'concern')).toBe(true);
  });

  it('recognises only ids in the list', () => {
    expect(isWellbeingTagId('food.ate_little')).toBe(true);
    expect(isWellbeingTagId('food.ate_pizza')).toBe(false);
    expect(isWellbeingTagId('__proto__')).toBe(false);
    expect(wellbeingTag('food.ate_little')).toMatchObject({ domain: 'food', polarity: 'concern', label: { en: 'Ate little' } });
  });
});

describe('domain states', () => {
  it('derives each domain from its tags and never treats silence as fine', () => {
    const s = domainStates(['food.ate_little', 'body.tired', 'body.feeling_well', 'sleep.slept_well', 'unknown.tag']);
    expect(s).toEqual({
      body: 'mixed',
      food: 'concern',
      sleep: 'good',
      mood: 'unmentioned',
      social: 'unmentioned',
      activity: 'unmentioned',
      practical: 'unmentioned',
      speech: 'unmentioned',
    });
    expect(Object.values(domainStates([]))).toEqual(WELLBEING_DOMAINS.map(() => 'unmentioned'));
  });

  it('is mixed with two concerns and one positive, concern with two concerns', () => {
    expect(domainStates(['food.ate_little', 'food.low_fluids']).food).toBe('concern');
    expect(domainStates(['food.ate_little', 'food.low_fluids', 'food.cooked']).food).toBe('mixed');
  });

  it('combines several calls on one day', () => {
    expect(combineStates([])).toBe('unmentioned');
    expect(combineStates(['unmentioned', 'unmentioned'])).toBe('unmentioned');
    expect(combineStates(['good', 'unmentioned'])).toBe('good');
    expect(combineStates(['concern', 'concern'])).toBe('concern');
    expect(combineStates(['good', 'concern'])).toBe('mixed');
    expect(combineStates(['mixed', 'unmentioned'])).toBe('mixed');
  });
});

describe('tag trends', () => {
  const calls = (n: number, ids: string[]) => Array.from({ length: n }, () => ids);

  it('counts each tag in the last 7 calls against the 7 before', () => {
    const recent = [...calls(4, ['food.ate_little', 'activity.stayed_in']), ...calls(3, ['activity.gardening'])];
    const before = [...calls(1, ['food.ate_little']), ...calls(5, ['activity.gardening']), ...calls(1, ['activity.gardening', 'activity.gardening'])];
    const t = tagTrends([...recent, ...before, ...calls(5, ['food.ate_little'])]);
    expect(t).toEqual([
      { id: 'food.ate_little', last: 4, previous: 1, lastCalls: 7, previousCalls: 7, direction: 'more' },
      { id: 'activity.stayed_in', last: 4, previous: 0, lastCalls: 7, previousCalls: 7, direction: 'more' },
      { id: 'activity.gardening', last: 3, previous: 6, lastCalls: 7, previousCalls: 7, direction: 'less' },
    ]);
  });

  it('puts concerns first at equal counts and reports no direction without an earlier window', () => {
    const t = tagTrends([['activity.walk', 'body.tired'], ['body.tired'], ['activity.walk']], 7);
    expect(t.map((x) => x.id)).toEqual(['body.tired', 'activity.walk']);
    expect(t[0]).toMatchObject({ last: 2, previous: 0, lastCalls: 3, previousCalls: 0, direction: null });
  });

  it('compares by share of calls when the earlier window is shorter', () => {
    const t = tagTrends([['sleep.slept_badly'], [], [], ['sleep.slept_badly']], 2);
    expect(t).toEqual([{ id: 'sleep.slept_badly', last: 1, previous: 1, lastCalls: 2, previousCalls: 2, direction: 'same' }]);
    const shorter = tagTrends([...calls(3, ['sleep.slept_badly']), [], ...calls(3, ['sleep.slept_badly'])], 4);
    expect(shorter[0]).toMatchObject({ last: 3, previous: 3, lastCalls: 4, previousCalls: 3, direction: 'less' });
  });

  it('reports no direction against only one or two earlier calls', () => {
    const t = tagTrends([...calls(5, ['food.ate_well']), [], [], ['food.ate_well']]);
    expect(t[0]).toMatchObject({ last: 5, previous: 1, lastCalls: 7, previousCalls: 1, direction: null });
    const two = tagTrends([...calls(7, ['body.tired']), [], []]);
    expect(two[0]).toMatchObject({ last: 7, previous: 0, previousCalls: 2, direction: null });
  });

  it('ignores unknown ids and handles no calls', () => {
    expect(tagTrends([])).toEqual([]);
    expect(tagTrends([['made.up']])).toEqual([]);
  });

  it('orders by the earlier count, then by the vocabulary, at equal recent counts', () => {
    const t = tagTrends([['sleep.slept_well', 'food.ate_well'], ['social.saw_friends'], ['social.saw_friends']], 1);
    expect(t.map((x) => x.id)).toEqual(['food.ate_well', 'sleep.slept_well', 'social.saw_friends']);
  });
});
