import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QueueLanes } from '../src/components/QueueLanes';
import { QueueUnreached } from '../src/components/QueueNotices';
import { queueLanes } from '../src/queue';
import type { QueueItem, UnreachedResident } from '../src/types';

const now = new Date('2026-10-13T05:00:00.000Z');
const render = (el: Parameters<typeof createElement>[0], props: object) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(el as never, props as never)));

const miss = (residentId: string, missedDays: number, ourFault = false): UnreachedResident => ({
  residentId,
  residentName: `Resident ${residentId}`,
  localDate: '2026-10-13',
  reason: ourFault ? 'failed' : 'no_answer',
  reasonLabel: ourFault ? 'Our call failed' : 'No answer',
  meaning: '',
  attempts: 3,
  at: now.toISOString(),
  ourFault,
  lastReachedAt: new Date(now.getTime() - missedDays * 86_400_000).toISOString(),
  tried: 'Called 3 times',
  missedDays,
});

const item = (o: Partial<QueueItem>): QueueItem => ({
  caseId: 'c1',
  residentId: 'r1',
  residentName: 'Margaret Ellis',
  rule: 'R2',
  urgency: 'urgent',
  urgencyLabel: 'Review today',
  urgencyMeaning: 'Needs checking today.',
  summary: 'Very little to eat for two days.',
  reason: '',
  score: 1,
  detectedAt: now.toISOString(),
  status: 'open',
  statusLabel: 'Not started',
  notifications: [],
  ...o,
});

describe('queue notices', () => {
  it('put the longest without a call first, as a ladder, with our own failure after it', () => {
    const html = render(QueueUnreached, { unreached: { items: [miss('one', 1), miss('fault', 1, true), miss('four', 4), miss('two', 2)], note: null }, now });
    const order = ['four', 'two', 'one', 'fault'].map((id) => html.indexOf(`/staff/residents/${id}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('class="card queue-notice queue-stripe sev-emergency"');
    expect(html.match(/class="is-escalated"/g)).toHaveLength(1);
    for (const [severity, word] of [['emergency', 'No call for 4 days'], ['today', 'No call for 2 days'], ['soon', 'No call for 1 day'], ['system', 'Call failed (our side)']]) {
      expect(html).toContain(`sev-chip sev-${severity}`);
      expect(html).toContain(`<span>${word}</span>`);
    }
  });
});

describe('queue cards', () => {
  it('shows urgent cases first, with a reason and review link, and folds monitoring cases', () => {
    const lanes = queueLanes([
      item({ caseId: 'w', urgency: 'watch', urgencyLabel: 'Monitor', summary: 'Not eating enough' }),
      item({ caseId: 'e', urgency: 'emergency', urgencyLabel: 'Act now', summary: 'Trouble breathing' }),
      item({ caseId: 'u', urgency: 'urgent' }),
    ]);
    const html = render(QueueLanes, { lanes, linkState: null });
    expect(html.indexOf('Trouble breathing')).toBeLessThan(html.indexOf('Very little to eat'));
    expect(html.indexOf('Very little to eat')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('<details class="card disclosure queue-fold"><summary>');
    expect(html).toContain('Review case for Margaret Ellis, Act now');
    expect(html).toContain('href="/staff/cases/w"');
    expect(render(QueueLanes, { lanes, linkState: null, revealFolded: true })).toMatch(/<details[^>]* open=""/);
  });

  it('shows the case assignee and claim time when work is in progress', () => {
    const claimedAt = now.toISOString();
    const lanes = queueLanes([item({ status: 'in_progress', statusLabel: 'In progress', assignment: { uid: 's1', name: 'Aiko Tanaka', claimedAt } })]);
    const html = render(QueueLanes, { lanes, linkState: null });
    expect(html).toContain('<strong>In progress</strong> · Aiko Tanaka · ');
    expect(html).toContain(`dateTime="${claimedAt}"`);
  });
});
