import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { QueueLanes } from '../src/components/QueueLanes';
import { QueueUnreached } from '../src/components/QueueNotices';
import { queueLanes } from '../src/queue';
import type { Queue, QueueItem, ResidentSignals, UnreachedResident } from '../src/types';

/** States the preview fixtures never produce: indicator inputs, days without a call, unchecked calls. */
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

const signals: ResidentSignals = {
  latestCallAt: '2026-10-13T01:00:00.000Z',
  domains: { body: 'unmentioned', food: 'concern', sleep: 'good', mood: 'good', social: 'good', activity: 'unmentioned' },
  speech: 'clear_change',
  reach: { lastReachedAt: '2026-10-13T01:00:00.000Z', missedDays: 0, ourFault: false },
  unchecked: 1,
};

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

describe('queue cards with indicators', () => {
  const queue = { items: [], legend: [], unreached: { items: [miss('r1', 2)], note: null } } as unknown as Queue;

  it('draw a compact and a full bar, and fill Calls from the unreached list when signals leave it out', () => {
    const { reach: _, ...noReach } = signals;
    const lanes = queueLanes([item({ signals: noReach }), item({ caseId: 'c2', residentId: 'r2', signals: undefined })]);
    const html = render(QueueLanes, { lanes, queue, now, linkState: null });
    expect(html.match(/class="card queue-case[^"]*has-signals/g)).toHaveLength(1);
    expect(html.match(/<ul class="sev-bar"/g)).toHaveLength(2);
    expect(html).toContain('<span class="sr-only">Calls: No call for 2 days</span>');
    expect(html).toContain('<span class="sr-only">Speech: Clear change</span>');
    expect(html).not.toContain('<span class="sr-only">Review today: </span>');
  });
});
