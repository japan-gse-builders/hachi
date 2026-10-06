import { describe, expect, it } from 'vitest';
import {
  ANSWER_WINDOW_DAYS,
  CYCLE_DAYS,
  currentAnswers,
  domainStatus,
  ITEMS_PER_CALL,
  itemsForCall,
  KIHON_DOMAIN_LABELS,
  overallStatus,
  SCREEN_ITEMS,
  screenItem,
  scoreInstrument,
  type ItemAnswer,
  type KihonDomain,
} from '../src/screening.js';

const START = '2026-01-01';

function answer(itemId: string, label: string, date = START): ItemAnswer {
  const item = screenItem(itemId);
  const option = item.options.findIndex((o) => o.label === label);
  if (option < 0) throw new Error(`${itemId} has no option ${label}`);
  return { date, itemId, option };
}

describe('screening item vocabulary', () => {
  it('has unique ids, spoken text and at least two labelled options', () => {
    expect(new Set(SCREEN_ITEMS.map((i) => i.id)).size).toBe(SCREEN_ITEMS.length);
    for (const item of SCREEN_ITEMS) {
      expect(item.id).toMatch(/^[a-z0-9]+\.[a-z_]+$/);
      expect(item.text.trim()).not.toBe('');
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      expect(item.options.some((o) => o.risk)).toBe(true);
      expect(item.options.some((o) => !o.risk)).toBe(true);
    }
  });

  it('cites each Kihon item only once, and only within items 1 to 25', () => {
    const cited = SCREEN_ITEMS.map((i) => i.kihonItem).filter((n): n is number => n !== undefined);
    expect(new Set(cited).size).toBe(cited.length);
    for (const n of cited) expect(n).toBeGreaterThanOrEqual(1);
    for (const n of cited) expect(n).toBeLessThanOrEqual(25);
  });

  it('labels every domain in English and Japanese', () => {
    for (const item of SCREEN_ITEMS) {
      expect(KIHON_DOMAIN_LABELS[item.domain].en).toBeTruthy();
      expect(KIHON_DOMAIN_LABELS[item.domain].ja).toBeTruthy();
    }
  });

  it('reproduces the published options of the instruments it names', () => {
    expect(screenItem('uls3.left_out').text).toBe('How often do you feel left out?');
    expect(screenItem('uls3.left_out').options.map((o) => o.label)).toEqual([
      'Hardly ever or never',
      'Some of the time',
      'Often',
    ]);
    expect(screenItem('phq2.down').recall).toBe('Over the last two weeks, how often have you been bothered by');
    expect(screenItem('phq2.down').options.map((o) => o.score)).toEqual([0, 1, 2, 3]);
  });

  it('throws on an unknown id rather than guessing', () => {
    expect(() => screenItem('uls3.nonsense')).toThrow('Unknown screening item');
  });
});

describe('itemsForCall', () => {
  it('hands out two items a call and gets through every item in one cycle', () => {
    const seen: string[] = [];
    for (let d = 0; d < CYCLE_DAYS; d += 1) {
      const date = new Date(Date.parse(`${START}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
      const items = itemsForCall(START, date);
      expect(items.length).toBeLessThanOrEqual(ITEMS_PER_CALL);
      seen.push(...items.map((i) => i.id));
    }
    expect(seen).toEqual(SCREEN_ITEMS.map((i) => i.id));
  });

  it('repeats the cycle so every item comes round again', () => {
    expect(itemsForCall(START, '2026-01-01').map((i) => i.id)).toEqual(
      itemsForCall(START, `2026-01-${String(1 + CYCLE_DAYS).padStart(2, '0')}`).map((i) => i.id),
    );
  });

  it('never asks two sensitive questions in the same call', () => {
    for (let d = 0; d < CYCLE_DAYS; d += 1) {
      const date = new Date(Date.parse(`${START}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
      expect(itemsForCall(START, date).filter((i) => i.sensitive).length).toBeLessThanOrEqual(1);
    }
  });

  it('follows the calendar, so a fortnight of missed calls does not repeat the same two items', () => {
    const before = itemsForCall(START, '2026-01-01').map((i) => i.id);
    const after = itemsForCall(START, '2026-01-08').map((i) => i.id);
    expect(after).not.toEqual(before);
  });

  it('drifts across the week rather than pinning an item to one weekday', () => {
    expect(CYCLE_DAYS % 7).not.toBe(0);
  });

  it('works before the service start date', () => {
    expect(itemsForCall(START, '2025-12-31').length).toBe(ITEMS_PER_CALL);
  });

  it('rejects a malformed date', () => {
    expect(() => itemsForCall(START, '1 Jan 2026')).toThrow('Invalid date');
  });
});

describe('currentAnswers', () => {
  it('keeps the newest answer to each item', () => {
    const answers = [answer('kcl.out_weekly', 'No', '2026-01-01'), answer('kcl.out_weekly', 'Yes', '2026-01-05')];
    const current = currentAnswers(answers, '2026-01-06');
    expect(current.get('kcl.out_weekly')!.date).toBe('2026-01-05');
  });

  it('forgets answers older than the window rather than presenting them as current', () => {
    const old = new Date(Date.parse(`${START}T00:00:00Z`) + ANSWER_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(currentAnswers([answer('kcl.out_weekly', 'No', START)], old).size).toBe(0);
  });

  it('ignores an item that is no longer in the vocabulary', () => {
    expect(currentAnswers([{ date: START, itemId: 'gone.away', option: 0 }], START).size).toBe(0);
  });
});

describe('scoreInstrument', () => {
  it('withholds a verdict until every item of the instrument is answered', () => {
    const partial = scoreInstrument('ULS-3', [answer('uls3.isolated', 'Often')], START);
    expect(partial).toMatchObject({ score: 3, answered: 1, of: 3, positive: null });
  });

  it('sums the published scores and applies the published cutoff', () => {
    const lonely = scoreInstrument(
      'ULS-3',
      [
        answer('uls3.companionship', 'Often'),
        answer('uls3.left_out', 'Some of the time'),
        answer('uls3.isolated', 'Some of the time'),
      ],
      START,
    );
    expect(lonely).toMatchObject({ score: 7, answered: 3, positive: true });

    const not = scoreInstrument(
      'ULS-3',
      [
        answer('uls3.companionship', 'Hardly ever or never'),
        answer('uls3.left_out', 'Hardly ever or never'),
        answer('uls3.isolated', 'Some of the time'),
      ],
      START,
    );
    expect(not).toMatchObject({ score: 4, positive: false });
  });

  it('screens positive on the PHQ-2 at three, the cutoff Kroenke validated', () => {
    const at = scoreInstrument(
      'PHQ-2',
      [answer('phq2.interest', 'Several days'), answer('phq2.down', 'More than half the days')],
      START,
    );
    expect(at).toMatchObject({ score: 3, positive: true });

    const below = scoreInstrument(
      'PHQ-2',
      [answer('phq2.interest', 'Several days'), answer('phq2.down', 'Several days')],
      START,
    );
    expect(below).toMatchObject({ score: 2, positive: false });
  });

  it('ignores an option index that is out of range', () => {
    const broken = scoreInstrument('PHQ-2', [{ date: START, itemId: 'phq2.down', option: 9 }], START);
    expect(broken).toMatchObject({ score: 0, answered: 0, positive: null });
  });
});

function status(answers: ItemAnswer[], domain: KihonDomain) {
  return domainStatus(answers, START).find((d) => d.domain === domain)!;
}

describe('domainStatus', () => {
  it('meets the mobility criterion at three of its five items, as the official rule has it', () => {
    const three = [
      answer('frail.resistance', 'Yes'),
      answer('frail.ambulation', 'Yes'),
      answer('kcl.fall_year', 'Yes'),
      answer('kcl.fall_fear', 'No'),
    ];
    expect(status(three, 'mobility')).toMatchObject({ flagged: 3, meets: true });
  });

  it('rules a domain out once too few items are left to reach its threshold', () => {
    const answers = [
      answer('frail.resistance', 'No'),
      answer('frail.ambulation', 'No'),
      answer('kcl.fall_year', 'No'),
      answer('kcl.fall_fear', 'No'),
    ];
    expect(status(answers, 'mobility')).toMatchObject({ flagged: 0, answered: 4, meets: false });
  });

  it('holds back a verdict while the answers could still go either way', () => {
    expect(status([answer('frail.resistance', 'Yes')], 'mobility')).toMatchObject({ flagged: 1, meets: null });
  });

  it('reports the items it cannot ask over the telephone instead of scoring without them', () => {
    const nutrition = status([answer('kcl.weight_loss', 'Yes')], 'nutrition');
    expect(nutrition).toMatchObject({ answered: 1, of: 2, flagged: 1, missing: [12], meets: null });
  });

  it('settles the housebound domain on its single item', () => {
    expect(status([answer('kcl.out_weekly', 'No')], 'housebound')).toMatchObject({ flagged: 1, meets: true });
    expect(status([answer('kcl.out_weekly', 'Yes')], 'housebound')).toMatchObject({ flagged: 0, meets: false });
  });

  it('meets the cognition criterion on a single flagged item', () => {
    expect(status([answer('kcl.date', 'Yes')], 'cognition')).toMatchObject({ flagged: 1, meets: true });
  });

  it('leaves the everyday activities domain unjudged, because the checklist gives it no rule of its own', () => {
    expect(status([answer('kcl.shopping', 'No')], 'iadl')).toMatchObject({ flagged: 1, meets: null });
  });

  it('covers every domain on every call', () => {
    expect(domainStatus([], START).map((d) => d.domain)).toEqual(
      Object.keys(KIHON_DOMAIN_LABELS) as KihonDomain[],
    );
  });
});

describe('overallStatus', () => {
  it('needs ten of the first twenty items before the overall criterion is met', () => {
    const flaggedTen: ItemAnswer[] = [
      answer('kcl.transport', 'No'),
      answer('kcl.shopping', 'No'),
      answer('kcl.banking', 'No'),
      answer('kcl.visit_friends', 'No'),
      answer('kcl.advise', 'No'),
      answer('frail.resistance', 'Yes'),
      answer('frail.ambulation', 'Yes'),
      answer('kcl.fall_year', 'Yes'),
      answer('kcl.fall_fear', 'Yes'),
      answer('kcl.weight_loss', 'Yes'),
    ];
    expect(overallStatus(flaggedTen, START)).toMatchObject({ flagged: 10, meets: true });
    expect(overallStatus(flaggedTen.slice(0, 9), START)).toMatchObject({ flagged: 9, meets: null });
  });

  it('rules the overall criterion out when nothing is flagged and the answers are in', () => {
    const clear = [
      answer('kcl.transport', 'Yes'),
      answer('kcl.shopping', 'Yes'),
      answer('kcl.banking', 'Yes'),
      answer('kcl.visit_friends', 'Yes'),
      answer('kcl.advise', 'Yes'),
      answer('frail.resistance', 'No'),
      answer('frail.ambulation', 'No'),
      answer('kcl.fall_year', 'No'),
      answer('kcl.fall_fear', 'No'),
      answer('kcl.weight_loss', 'No'),
      answer('kcl.chewing', 'No'),
    ];
    expect(overallStatus(clear, START)).toMatchObject({ flagged: 0, meets: false });
  });
});
