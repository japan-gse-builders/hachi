import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyDashboardView } from '../src/components/FamilyDashboardView';
import {
  cellState,
  dayLabel,
  dayOfMonth,
  familyDays,
  familyStatus,
  firstSentence,
  isOneOff,
  lastTalkedLevel,
  latestAreas,
  latestCallLabel,
  LEGEND,
  missedDays,
  nextCallLabel,
  staffTagLine,
  STATES,
  todayCallNote,
  trendChange,
  trendCount,
  trendTurn,
  type FamilyDay,
  type FamilyStatusInput,
} from '../src/glance';
import type { DomainStates, FamilyDashboard, FamilyGlance, TagTrend } from '../src/types';

const quiet: DomainStates = { body: 'unmentioned', food: 'unmentioned', sleep: 'unmentioned', mood: 'unmentioned', social: 'unmentioned', activity: 'unmentioned' };
const today: DomainStates = { ...quiet, body: 'mixed', food: 'concern', sleep: 'good' };
const trend = (o: Partial<TagTrend> = {}): TagTrend => ({
  id: 'food.ate_little',
  label: 'Ate little',
  domain: 'food',
  polarity: 'concern',
  last: 4,
  previous: 1,
  lastCalls: 7,
  previousCalls: 7,
  direction: 'more',
  ...o,
});
type Call = FamilyDashboard['calls'][number];
const call = (startedAt: string, connected: boolean, o: Partial<Call> = {}): Call => ({ startedAt, connected, durationSec: connected ? 240 : null, summary: null, ...o });
const day = (date: string, domains: DomainStates | null, tagged = domains !== null): FamilyGlance['days'][number] => ({ date, tagged, domains });
const kinds = (days: FamilyDay[]) => days.map((d) => d.kind);

describe('glance helpers', () => {
  it('gives every state a symbol and a word, and never shows silence or a gap as good', () => {
    for (const s of Object.values(STATES)) {
      expect(s.symbol).not.toBe('');
      expect(s.word).not.toBe('');
    }
    expect(new Set(LEGEND.map((s) => STATES[s].symbol)).size).toBe(LEGEND.length);
    expect(STATES.unmentioned.tone).not.toBe(STATES.good.tone);
    expect(STATES.nodata.tone).toBe('quiet');
    for (const s of ['unmentioned', 'nodata', 'missed', 'nocall', 'notyet', 'notshared'] as const) expect(STATES[s].sev).toBe('none');
    expect(STATES.notes.sev).toBe('system');
    expect(new Set(['missed', 'nocall', 'notyet'].map((s) => STATES[s as 'missed'].tone)).size).toBe(3);
  });

  it('labels days, the latest call and the next call in Japan time', () => {
    expect(dayLabel('2026-10-01')).toBe('Oct 1');
    expect(dayOfMonth('2026-09-07')).toBe('7');
    const now = new Date('2026-10-05T05:00:00.000Z');
    expect(latestCallLabel('2026-10-05T01:02:00.000Z', now)).toBe("Today's call, 10:02");
    expect(latestCallLabel('2026-10-04T01:02:00.000Z', now)).toBe("Yesterday's call, 10:02");
    expect(latestCallLabel('2026-10-01T01:02:00.000Z', now)).toBe('Latest call, Oct 1, 10:02');
    expect(nextCallLabel('2026-10-06T01:00:00.000Z', now)).toBe('Next call tomorrow, 10:00 (Japan time)');
    expect(nextCallLabel(null, now)).toBe('Daily calls are paused');
    expect(todayCallNote('2026-10-05T09:00:00.000Z', now)).toBe("Today's call is at 18:00.");
    expect(todayCallNote('2026-10-06T01:00:00.000Z', now)).toBe('');
    expect(todayCallNote(null, now)).toBe('');
  });

  it('keeps only the first sentence of a headline, past titles like Mrs.', () => {
    expect(firstSentence('Enjoyed hearing from her daughter; still has little appetite.')).toBe('Enjoyed hearing from her daughter; still has little appetite.');
    expect(firstSentence('Hachi let the care team know. Care team follow-up: Not started.')).toBe('Hachi let the care team know.');
    expect(firstSentence('Mrs. Ito visited. They had tea.')).toBe('Mrs. Ito visited.');
    expect(firstSentence('Ate 2.5 rice balls today')).toBe('Ate 2.5 rice balls today');
    expect(firstSentence(null)).toBe('');
  });

  it('describes tag trends in words, and which way they are going', () => {
    expect(trendCount(trend())).toBe('4 of last 7 calls');
    expect(trendCount(trend({ last: 1, lastCalls: 1 }))).toBe('1 of last 1 call');
    expect(trendChange(trend())).toBe('more often (was 1 of 7)');
    expect(trendChange(trend({ direction: 'less', previous: 5 }))).toBe('less often (was 5 of 7)');
    expect(trendChange(trend({ direction: 'same' }))).toBe('about the same as before');
    expect(trendChange(trend({ direction: null }))).toBe('');
    expect(isOneOff(trend({ last: 1 }))).toBe(true);
    expect(isOneOff(trend())).toBe(false);
    expect(trendTurn(trend())).toBe('worse');
    expect(trendTurn(trend({ direction: 'less' }))).toBe('better');
    expect(trendTurn(trend({ polarity: 'positive', direction: 'less' }))).toBe('worse');
    expect(trendTurn(trend({ polarity: 'positive', direction: 'more' }))).toBe('better');
    expect(trendTurn(trend({ direction: 'same' }))).toBeNull();
  });

  it('shows staff the basis, confidence, turn and who may see a tag', () => {
    const t = { id: 'mood.lonely', label: 'Lonely', domain: 'mood', polarity: 'concern' as const, turn: 7, basis: 'inferred' as const, confidence: 0.784, quote: 'x' };
    expect(staffTagLine({ ...t, audience: 'family_with_consent' })).toBe('Lonely · inferred 78% · turn 7 · family only with consent');
    expect(staffTagLine({ ...t, audience: 'staff' })).toContain('staff only');
    expect(staffTagLine({ ...t, audience: 'family' })).toBe('Lonely · inferred 78% · turn 7');
  });
});

describe('family days', () => {
  // 14:00 on Oct 13 in Japan.
  const now = new Date('2026-10-13T05:00:00.000Z');
  const window = [day('2026-10-10', quiet), day('2026-10-11', null), day('2026-10-12', null), day('2026-10-13', null)];

  it('marks the last day today only while it is still today in Japan', () => {
    expect(familyDays(window, [], now, true).map((d) => d.isToday)).toEqual([false, false, false, true]);
    // 00:30 on Oct 14 in Japan, though still Oct 13 in UTC: the window has gone stale.
    expect(familyDays(window, [], new Date('2026-10-13T15:30:00.000Z'), true).some((d) => d.isToday)).toBe(false);
  });

  it('puts attempts on the Japan-time day, not the UTC one', () => {
    // 01:00 on Oct 12 in Japan is still Oct 11 in UTC.
    const days = familyDays(window, [call('2026-10-11T16:00:00.000Z', false)], now, true);
    expect(kinds(days)).toEqual(['reached', 'nocall', 'missed', 'notyet']);
  });

  it('tells reached, missed, not yet called and no call apart', () => {
    const calls = [call('2026-10-12T01:00:00.000Z', false), call('2026-10-13T01:00:00.000Z', false)];
    expect(kinds(familyDays(window, calls, now, true))).toEqual(['reached', 'nocall', 'missed', 'missed']);
    expect(kinds(familyDays(window, [], now, true)).at(-1)).toBe('notyet');
    expect(kinds(familyDays(window, [], now, false)).at(-1)).toBe('nocall');
    const reachedAfterRetry = [day('2026-10-13', today)];
    expect(kinds(familyDays(reachedAfterRetry, [call('2026-10-13T01:00:00.000Z', false), call('2026-10-13T02:00:00.000Z', true)], now, true))).toEqual(['reached']);
  });

  it('says notes are not ready, rather than no details, while Hachi is still writing them', () => {
    const days = familyDays([day('2026-10-13', quiet, false)], [call('2026-10-13T01:00:00.000Z', true, { notesPending: true })], now, true);
    expect(cellState(days[0]!, 'food')).toBe('notes');
    const older = familyDays([day('2026-10-13', quiet, false)], [call('2026-10-13T01:00:00.000Z', true)], now, true);
    expect(cellState(older[0]!, 'food')).toBe('nodata');
    const tagged = familyDays([day('2026-10-13', today)], [], now, true);
    expect(cellState(tagged[0]!, 'food')).toBe('concern');
    expect(cellState(tagged[0]!, 'mood')).toBe('unmentioned');
    expect(cellState(familyDays([day('2026-10-13', null)], [], now, true)[0]!, 'food')).toBe('notyet');
  });

  it('counts missed days back from today, waiting for today and stopping at a day nothing was tried', () => {
    const d = (...k: FamilyDay['kind'][]) => k.map((kind, i) => ({ date: `2026-10-0${i + 1}`, tagged: false, domains: null, kind, isToday: i === k.length - 1, notesPending: false }));
    expect(missedDays(d('reached', 'missed', 'missed', 'notyet'))).toBe(2);
    expect(missedDays(d('reached', 'missed'))).toBe(1);
    expect(missedDays(d('missed', 'nocall', 'missed', 'missed', 'missed'))).toBe(3);
    expect(missedDays(d('missed', 'reached', 'notyet'))).toBe(0);
    expect(missedDays(d('missed', 'nocall'))).toBe(0);
    expect(missedDays([])).toBe(0);
  });

  it('shows when she was last talked to, getting more urgent but never red', () => {
    expect(lastTalkedLevel('2026-10-13T01:02:00.000Z', 0, now)).toEqual({ severity: 'good', word: 'Talked today, 10:02', detail: '' });
    expect(lastTalkedLevel('2026-10-12T01:02:00.000Z', 0, now).severity).toBe('good');
    expect(lastTalkedLevel('2026-10-12T01:02:00.000Z', 1, now)).toMatchObject({ severity: 'soon', word: 'Last talked yesterday, 10:02' });
    expect(lastTalkedLevel('2026-10-10T01:02:00.000Z', 2, now)).toMatchObject({ severity: 'today', word: 'Last talked Oct 10, 10:02', detail: 'No call has got through for 2 days.' });
    expect(lastTalkedLevel('2026-10-01T01:02:00.000Z', 9, now).severity).toBe('today');
    expect(lastTalkedLevel('2026-10-08T01:02:00.000Z', 0, now).severity).toBe('none');
    expect(lastTalkedLevel(null, 3, now)).toMatchObject({ severity: 'today', word: 'No call in two weeks' });
  });

  it('reads Mood without agreement as not shared, and a call without notes as not ready', () => {
    const latest = { startedAt: '2026-10-13T01:02:00.000Z', headline: null, domains: { ...today, mood: 'concern' as const } };
    const areas = latestAreas(latest, false, false);
    expect(areas.map((a) => a.label)).toEqual(['Body', 'Food', 'Sleep', 'Mood', 'Social', 'Activity']);
    expect(areas.find((a) => a.key === 'mood')!.state).toBe('notshared');
    expect(latestAreas(latest, true, false).find((a) => a.key === 'mood')!.state).toBe('concern');
    expect(latestAreas({ ...latest, domains: null }, true, true).every((a) => a.state === 'notes')).toBe(true);
  });
});

describe('family status', () => {
  const now = new Date('2026-10-13T05:00:00.000Z');
  const latest = { startedAt: '2026-10-13T01:02:00.000Z', headline: 'Enjoyed a chat. Little appetite.', domains: today };
  const reachedToday = familyDays([day('2026-10-12', quiet), day('2026-10-13', today)], [], now, true);
  const input = (o: Partial<FamilyStatusInput> = {}): FamilyStatusInput => ({
    name: 'Margaret Smith', latest, days: reachedToday, shareMood: true, callsActive: true, anyCalls: true, latestNotesPending: false, now, ...o,
  });

  it('leads with the latest call, in one short sentence', () => {
    expect(familyStatus(input())).toEqual({ severity: 'today', title: 'Worth a call', body: 'Enjoyed a chat.', askCareTeam: true });
    expect(familyStatus(input({ latest: { ...latest, headline: null } })).body).toBe('Food may be worth asking about.');
    const mixed = familyStatus(input({ latest: { ...latest, headline: null, domains: { ...quiet, sleep: 'mixed', body: 'mixed' } } }));
    expect(mixed).toMatchObject({ severity: 'soon', title: 'Mostly well', body: 'A little concern about body and sleep.', askCareTeam: false });
    expect(familyStatus(input({ latest: { ...latest, domains: { ...quiet, social: 'good' } } }))).toMatchObject({ severity: 'good', title: 'All seemed well' });
    expect(familyStatus(input({ latest: { ...latest, headline: null, domains: quiet } }))).toMatchObject({ severity: 'none', title: 'Nothing much came up' });
    expect(familyStatus(input({ latest: { ...latest, domains: null }, latestNotesPending: true }))).toMatchObject({ severity: 'system', title: 'Notes on the latest call are not ready yet' });
  });

  it('ignores mood the resident has not agreed to share', () => {
    const moodOnly = { ...latest, headline: null, domains: { ...quiet, mood: 'concern' as const } };
    expect(familyStatus(input({ latest: moodOnly, shareMood: false })).severity).toBe('none');
    expect(familyStatus(input({ latest: moodOnly, shareMood: true })).severity).toBe('today');
  });

  it('says gently when calls have stopped getting through', () => {
    const calm = { ...latest, domains: { ...quiet, social: 'good' as const } };
    const missedToday = familyDays([day('2026-10-12', quiet), day('2026-10-13', null)], [call('2026-10-13T01:00:00.000Z', false)], now, true);
    expect(familyStatus(input({ latest: { ...calm, startedAt: '2026-10-12T01:02:00.000Z' }, days: missedToday }))).toEqual({
      severity: 'soon',
      title: 'No call has got through to Margaret Smith today',
      body: 'Last talked yesterday: all seemed well. Hachi will keep trying, and the care team can see this too.',
      askCareTeam: false,
    });
    const missedYesterday = familyDays([day('2026-10-11', quiet), day('2026-10-12', null), day('2026-10-13', null)], [call('2026-10-12T01:00:00.000Z', false)], now, true);
    expect(familyStatus(input({ latest: calm, days: missedYesterday })).title).toBe('No call reached Margaret Smith yesterday');
    const twoDays = familyDays([day('2026-10-11', quiet), day('2026-10-12', null), day('2026-10-13', null)], [call('2026-10-12T01:00:00.000Z', false), call('2026-10-13T01:00:00.000Z', false)], now, true);
    expect(familyStatus(input({ latest: calm, days: twoDays }))).toMatchObject({ severity: 'today', title: 'No call has reached Margaret Smith for 2 days', askCareTeam: true });
    expect(familyStatus(input({ latest: { ...latest, startedAt: '2026-10-11T01:02:00.000Z' }, days: twoDays })).body).toMatch(/^Last talked Oct 11: something came up worth asking about\./);
  });

  it('covers no calls at all, paused calls and two weeks without getting through', () => {
    expect(familyStatus(input({ latest: null, anyCalls: false }))).toMatchObject({ severity: 'none', title: 'No calls yet' });
    expect(familyStatus(input({ latest: null, anyCalls: false, callsActive: false })).title).toBe('Daily calls are paused');
    expect(familyStatus(input({ latest: null }))).toMatchObject({ severity: 'today', title: 'No call has reached Margaret Smith in the last two weeks', askCareTeam: true });
    expect(familyStatus(input({ latest: null, callsActive: false })).severity).toBe('none');
  });
});

describe('family dashboard view', () => {
  const now = new Date('2026-10-05T05:00:00.000Z');
  const data: FamilyDashboard = {
    resident: { id: 'res-1', name: 'Margaret Smith', portrait: 'grandmother-2' },
    nextCallAt: '2026-10-06T01:00:00.000Z',
    glance: {
      shareMood: true,
      latest: { startedAt: '2026-10-05T01:02:00.000Z', headline: 'Margaret ate little today but enjoyed a chat. She mentioned her grandson.', domains: today },
      days: [day('2026-10-03', null), day('2026-10-04', quiet, false), day('2026-10-05', today)],
      trends: [trend(), trend({ id: 'activity.gardening', label: 'Gardening', domain: 'activity', polarity: 'positive', last: 1, previous: 5, direction: 'less' })],
    },
    calls: [
      {
        startedAt: '2026-10-05T01:02:00.000Z',
        connected: true,
        durationSec: 360,
        summary: { health: 'A little tired', meals: 'Ate very little', topics: ['grandson'] },
        headline: 'Margaret ate little today but enjoyed a chat.',
        domains: today,
        tags: [{ id: 'food.ate_little', label: 'Ate little', domain: 'food', polarity: 'concern' }],
      },
      { startedAt: '2026-10-04T01:00:00.000Z', connected: true, durationSec: 200, summary: null },
      { startedAt: '2026-10-03T01:00:00.000Z', connected: false, durationSec: null, summary: null },
    ],
    alerts: [{ sentAt: '2026-10-05T01:10:00.000Z', channels: ['email'], caseStatus: 'open', caseStatusLabel: 'Not started' }],
    staff: { name: 'Tanaka', phone: '+81300000000', email: null },
  };
  const render = (d: FamilyDashboard) => renderToStaticMarkup(createElement(FamilyDashboardView, { data: d, now }));
  const html = render(data);

  it('leads with one state for how she is, the last time she was reached and the next call', () => {
    expect(html).toContain('<span class="family-name-lead">Daily calls with</span> <span class="family-name-who">Margaret Smith</span>');
    expect(html.indexOf('family-name-who')).toBeLessThan(html.indexOf('Worth a call'));
    expect(html.indexOf('src="/avatars/grandmother-2.png"')).toBeLessThan(html.indexOf('family-name-who'));
    expect(html.indexOf('class="family-state-title">Worth a call<')).toBeLessThan(html.indexOf("Today&#x27;s call, 10:02"));
    expect(html).toContain('class="card family-status sev-today"');
    expect(html).toContain('<p class="family-state-body">Margaret ate little today but enjoyed a chat.</p>');
    expect(html).not.toContain('She mentioned her grandson');
    expect(html).toContain('Talked today, 10:02');
    expect(html).toContain('Next call tomorrow, 10:00 (Japan time)');
    expect(html).toContain('href="tel:+81300000000">Call the care team</a>');
  });

  it('shows the six areas as tiles, each with a colour, a symbol and a word', () => {
    for (const label of ['Body', 'Food', 'Sleep', 'Mood', 'Social', 'Activity']) expect(html).toContain(`<span class="family-area-name">${label}</span>`);
    expect(html).toContain('<li class="family-area sev-today tone-concern">');
    expect(html).toContain('<span class="family-area-word">Worth a call</span>');
    expect(html).toContain('<span class="family-area-word">Some concern</span>');
    expect(html).toContain('<li class="family-area sev-none tone-quiet">');
  });

  it('outlines today in the two-week grid and gives a day without a call one cell', () => {
    expect(html).toContain('<th scope="col" class="is-today"><span class="family-today-tab">Today</span><span aria-hidden="true">5</span><span class="sr-only">, Oct 5</span></th>');
    expect(html).toContain('title="Food, Today, Oct 5: Worth a call"');
    expect(html).toContain('title="Food, Oct 4: No details"');
    expect(html).toContain('title="Oct 3: Didn&#x27;t get through."');
    expect(html).toContain('<td rowSpan="6" class="family-gap">');
    expect(html).not.toContain('title="Food, Oct 3');
    expect(html).toContain('class="is-today is-end"');
    expect(html).toContain('does not mean all is well');
  });

  it('draws the key once, after the grid', () => {
    expect(html.match(/class="family-legend"/g)).toHaveLength(1);
    expect(html.indexOf('class="family-legend"')).toBeGreaterThan(html.indexOf('class="family-grid-split"'));
  });

  it('marks today as not yet called, with the time, before the call', () => {
    const before = render({
      ...data,
      nextCallAt: '2026-10-05T09:00:00.000Z',
      glance: { ...data.glance!, latest: { ...data.glance!.latest!, startedAt: '2026-10-04T01:02:00.000Z' }, days: [day('2026-10-03', null), day('2026-10-04', today), day('2026-10-05', null)] },
    });
    expect(before).toContain('title="Today, Oct 5: Not called yet. Today&#x27;s call is at 18:00."');
    expect(before).toContain('<p class="family-today-note">Today&#x27;s call is at 18:00.</p>');
    expect(before).toContain('Talked yesterday, 10:02');
  });

  it('turns the header to calls not getting through, in plain words', () => {
    const missed = render({
      ...data,
      glance: { ...data.glance!, latest: { ...data.glance!.latest!, startedAt: '2026-10-03T01:02:00.000Z', domains: { ...quiet, social: 'good' } }, days: [day('2026-10-03', quiet), day('2026-10-04', null), day('2026-10-05', null)] },
      calls: [call('2026-10-05T01:00:00.000Z', false), call('2026-10-04T01:00:00.000Z', false), call('2026-10-03T01:00:00.000Z', true)],
    });
    expect(missed).toContain('No call has reached Margaret Smith for 2 days');
    expect(missed).toContain('Last talked Oct 3, 10:02');
    expect(missed).toContain('Call the care team');
    expect(missed).not.toContain('sev-emergency');
  });

  it('lists alerts with what the care team is doing, and trends with which way they go', () => {
    expect(html).toContain('Care team: Not started');
    expect(html).toContain('4 of last 7 calls · more often (was 1 of 7)');
    expect(html).toContain('<span class="sr-only">Worse: </span>');
    expect(html).toContain('<li class="is-muted">');
  });

  it('keeps the per-call notes collapsed and never shows recordings or transcripts', () => {
    expect(html).toContain('<details><summary>Show the last two weeks (3 calls)</summary>');
    expect(html).toContain('<strong>Meals.</strong> Ate very little');
    expect(html).toContain('class="tag concern"');
    expect(html).toContain('Didn&#x27;t get through');
    expect(html).not.toMatch(/<audio|transcript|speech/i);
  });

  it('works with servers older than tags', () => {
    const { glance: _g, ...old } = data;
    const plain = render({ ...old, resident: { id: 'res-1', name: 'Margaret Smith' }, calls: [{ ...data.calls[2]! }] });
    expect(plain).toContain('<span class="family-name-who">Margaret Smith</span>');
    expect(plain).toContain('<span class="resident-avatar avatar-0" aria-hidden="true">MS</span>');
    expect(plain).not.toContain('glance');
    expect(plain).not.toContain('tag-list');
  });

  it.each([false, undefined])('shows Mood as not shared without agreement: %j', (shareMood) => {
    const privateView = render({ ...data, glance: { ...data.glance!, shareMood } });
    expect(html).toContain('<th scope="row">Mood</th>');
    expect(privateView).not.toContain('<th scope="row">Mood</th>');
    expect(privateView).toMatch(/<span class="family-area-name">Mood<\/span><span class="family-area-word">Not shared<\/span>/);
    expect(privateView).toContain('Mood is shared only if Margaret Smith agrees');
    expect(privateView).toContain('<th scope="row">Food</th>');
    expect(privateView).toContain('Care team');
  });
});
