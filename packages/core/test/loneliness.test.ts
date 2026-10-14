import { describe, expect, it } from 'vitest';
import { assessLoneliness, isNewsForFamily, lonelinessNotice, planLonelinessNotice, type CallSignal } from '../src/loneliness.js';
import { CYCLE_DAYS, type ItemAnswer } from '../src/screening.js';

const ASOF = '2026-10-20';

/** The three UCLA items, answered on `date`. Options are "hardly ever" (1), "some of the time" (2), "often" (3). */
const uls3 = (date: string, options: [number, number, number]): ItemAnswer[] => [
  { date, itemId: 'uls3.companionship', option: options[0] },
  { date, itemId: 'uls3.left_out', option: options[1] },
  { date, itemId: 'uls3.isolated', option: options[2] },
];

const back = (days: number) => new Date(Date.parse(`${ASOF}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const signal = (date: string, over: Partial<CallSignal> = {}): CallSignal => ({ date, tagIds: [], ...over });

describe('assessLoneliness: the scale', () => {
  it('says nothing at all until every item has been answered', () => {
    const partial = uls3(back(1), [2, 2, 2]).slice(0, 2);
    const a = assessLoneliness(partial, [], ASOF);
    expect(a.status).toBe('incomplete');
    expect(a.current).toMatchObject({ answered: 2, of: 3, positive: null });
    expect(a.summary).toContain('answered 2 of 3');
  });

  it('is settled below the published cutoff', () => {
    const a = assessLoneliness(uls3(back(1), [0, 0, 1]), [], ASOF);
    expect(a.current.score).toBe(4);
    expect(a.status).toBe('settled');
  });

  it('is lonely at the cutoff, not only above it', () => {
    const a = assessLoneliness(uls3(back(1), [1, 1, 1]), [], ASOF);
    expect(a.current.score).toBe(6);
    expect(a.status).toBe('lonely');
  });

  it('calls it worsening when it was below the cutoff a rotation ago', () => {
    const answers = [...uls3(back(CYCLE_DAYS + 1), [0, 0, 1]), ...uls3(back(1), [2, 2, 2])];
    const a = assessLoneliness(answers, [], ASOF);
    expect(a.previous).toMatchObject({ score: 4, positive: false });
    expect(a.status).toBe('worsening');
    expect(a.summary).toMatch(/crossed its cutoff/);
  });

  it('calls it worsening when it was already above and has climbed two points', () => {
    const answers = [...uls3(back(CYCLE_DAYS + 1), [1, 1, 1]), ...uls3(back(1), [2, 2, 2])];
    expect(assessLoneliness(answers, [], ASOF)).toMatchObject({ previous: { score: 6 }, current: { score: 9 }, status: 'worsening' });
  });

  it('does not call a one-point wobble on a three-point scale a change', () => {
    const answers = [...uls3(back(CYCLE_DAYS + 1), [1, 2, 2]), ...uls3(back(1), [2, 2, 2])];
    expect(assessLoneliness(answers, [], ASOF).status).toBe('lonely');
  });

  it('has nothing to compare with the first time the scale can be read', () => {
    const a = assessLoneliness(uls3(back(1), [2, 2, 2]), [], ASOF);
    expect(a.previous.positive).toBeNull();
    expect(a.status).toBe('lonely');
  });

  it('ignores answers too old to be current', () => {
    expect(assessLoneliness(uls3(back(CYCLE_DAYS * 2 + 1), [2, 2, 2]), [], ASOF).status).toBe('incomplete');
  });

  it('does not let today\u2019s answers into the picture from a rotation ago', () => {
    const only = assessLoneliness(uls3(back(1), [2, 2, 2]), [], ASOF);
    expect(only.previous).toMatchObject({ answered: 0, positive: null });
  });
});

describe('assessLoneliness: what the calls themselves say', () => {
  const lonelyCall = (date: string) => signal(date, { tagIds: ['mood.lonely'] });

  it('counts calls in the rotation where the resident said they were on their own', () => {
    const a = assessLoneliness([], [lonelyCall(back(1)), lonelyCall(back(3)), signal(back(5), { tagIds: ['mood.cheerful'] })], ASOF);
    expect(a).toMatchObject({ calls: 3, callsWithSignal: 2, heardInCalls: true });
    expect(a.summary).toContain('on their own in 2 of the last 3 calls');
  });

  it('does not treat one mention as a pattern', () => {
    expect(assessLoneliness([], [lonelyCall(back(1))], ASOF).heardInCalls).toBe(false);
  });

  it('treats asking for someone to ring them as a sign on its own', () => {
    const a = assessLoneliness([], [signal(back(1), { askedForContact: true })], ASOF);
    expect(a).toMatchObject({ contactRequests: 1, heardInCalls: true });
    expect(a.summary).toContain('Asked for someone to call them once');
  });

  it('counts missed groups and days without contact, not low mood on its own', () => {
    const social = [signal(back(1), { tagIds: ['social.no_contact'] }), signal(back(2), { tagIds: ['social.missed_group'] })];
    expect(assessLoneliness([], social, ASOF).heardInCalls).toBe(true);
    const low = [signal(back(1), { tagIds: ['mood.low'] }), signal(back(2), { tagIds: ['mood.low'] })];
    expect(assessLoneliness([], low, ASOF).callsWithSignal).toBe(0);
  });

  it('looks no further back than one rotation', () => {
    expect(assessLoneliness([], [lonelyCall(back(CYCLE_DAYS + 1)), lonelyCall(back(CYCLE_DAYS + 2))], ASOF)).toMatchObject({
      calls: 0,
      heardInCalls: false,
    });
  });

  it('never lets the conversation overrule the scale', () => {
    const settled = assessLoneliness(uls3(back(1), [0, 0, 1]), [lonelyCall(back(1)), lonelyCall(back(2))], ASOF);
    expect(settled.status).toBe('settled');
    expect(settled.heardInCalls).toBe(true);
  });
});

describe('isNewsForFamily', () => {
  const assess = (answers: ItemAnswer[]) => assessLoneliness(answers, [], ASOF);

  it('tells them the first time the scale can be read and it is above the cutoff', () => {
    expect(isNewsForFamily(assess(uls3(back(1), [2, 2, 2])))).toBe(true);
  });

  it('tells them when it crosses the cutoff', () => {
    expect(isNewsForFamily(assess([...uls3(back(CYCLE_DAYS + 1), [0, 0, 1]), ...uls3(back(1), [2, 2, 2])]))).toBe(true);
  });

  it('does not tell them the same thing again a rotation later', () => {
    const stillLonely = assess([...uls3(back(CYCLE_DAYS + 1), [2, 2, 2]), ...uls3(back(1), [2, 2, 2])]);
    expect(stillLonely.status).toBe('lonely');
    expect(isNewsForFamily(stillLonely)).toBe(false);
  });

  it('tells them nothing while the scale is incomplete or settled', () => {
    expect(isNewsForFamily(assess([]))).toBe(false);
    expect(isNewsForFamily(assess(uls3(back(1), [0, 0, 1])))).toBe(false);
  });
});

describe('what family is told', () => {
  it('fits one plain SMS with no link and no number', () => {
    const { body } = lonelinessNotice('Edith', 'https://app.example/family', 'sms');
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toMatch(/^[ -~]+$/);
    expect(body).not.toMatch(/https?:|\d{5,}/);
    expect(body).toContain('Edith would welcome more company');
  });

  it('names no instrument, gives no score and makes no medical claim', () => {
    for (const channel of ['sms', 'email'] as const) {
      const { subject, body } = lonelinessNotice('Edith', 'https://app.example/family', channel);
      expect(`${subject} ${body}`).not.toMatch(/UCLA|ULS|score|cutoff|screen|depress|diagnos|lonelin/i);
    }
  });

  it('says plainly in the email that it is not an alert, and links to the dashboard', () => {
    const { body } = lonelinessNotice('Edith', 'https://app.example/family', 'email');
    expect(body).toContain('not a medical alert');
    expect(body).toContain('https://app.example/family');
  });

  it('writes one message per channel we hold, keyed to the rotation', () => {
    const ctx = { residentId: 'res-1', preferredName: 'Edith', cycleStart: '2026-10-09', dashboardUrl: 'https://app.example/family' };
    const messages = planLonelinessNotice(ctx, { sms: '+819000000002', email: 'mary@example.org' });
    expect(messages.map((m) => m.channel)).toEqual(['sms', 'email']);
    expect(messages.every((m) => m.kind === 'loneliness' && m.recipient === 'family' && m.urgency === 'watch')).toBe(true);
    expect(new Set(messages.map((m) => m.idempotencyKey)).size).toBe(2);
    expect(messages[0]!.caseId).toBe('lonely:res-1:2026-10-09');
  });

  it('writes nothing when there is no way to reach the family', () => {
    const ctx = { residentId: 'res-1', preferredName: 'Edith', cycleStart: '2026-10-09', dashboardUrl: 'https://app.example/family' };
    expect(planLonelinessNotice(ctx, {})).toEqual([]);
  });
});
