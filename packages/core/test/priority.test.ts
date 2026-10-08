import { describe, expect, it } from 'vitest';
import { prioritize, sortQueue } from '../src/priority.js';
import { caseOf, detection, supported, vulnerable } from './fixtures.js';

const NOW = new Date('2026-10-01T10:00:00.000Z');

describe('prioritize (PRI-02, PRI-03)', () => {
  it('builds the reason from the example in PRI-03', () => {
    const r2 = caseOf({ autoUrgency: 'urgent', detections: [detection({ urgency: 'urgent', poorIntakeDays: 2 })] });
    const r3 = caseOf({ id: 'case-2', rule: 'R3', autoUrgency: 'action' });
    const p = prioritize(r2, [r2, r3], { ...supported, hasCloseSupporter: false }, NOW);
    expect(p.reason).toBe('2日続けてほとんど食べていない。話し方の変化の兆候も重なっている。身近な支援者なし');
    expect(p.urgency).toBe('urgent');
  });

  it('writes reasons in English', () => {
    const c = caseOf({ rule: 'R1', autoUrgency: 'emergency' });
    expect(prioritize(c, [c], vulnerable, NOW, 'en').reason).toBe(
      'Reported acute symptoms. No close supporter. Lives alone. Needs care. Chronic conditions (heart disease, diabetes)',
    );
  });

  it('writes R2, overlap, confidence and elapsed reasons in English', () => {
    const r2 = caseOf({
      firstDetectedAt: '2026-09-30T08:00:00.000Z',
      detections: [detection({ poorIntakeDays: 3, confidence: 0.4 })],
    });
    const r3 = caseOf({ id: 'case-2', rule: 'R3' });
    expect(prioritize(r2, [r2, r3], supported, NOW, 'en').reason).toBe(
      'Barely eating for 3 days in a row. Lower confidence. Also shows: Change in speech. 26h since detection',
    );
    expect(prioritize(caseOf(), [], supported, NOW, 'en').reason).toBe('Barely ate on one day');
  });

  it('describes R2 single days and R3 trends', () => {
    expect(prioritize(caseOf(), [], supported, NOW).reason).toBe('ほとんど食べられていない日がある');
    const r3 = caseOf({ rule: 'R3', detections: [detection({ rule: 'R3', changeMagnitude: 2.5, trend: 'worsening' })] });
    expect(prioritize(r3, [], supported, NOW).reason).toBe('話し方に平常時からの変化があり、悪化傾向');
    expect(prioritize(r3, [], supported, NOW, 'en').reason).toMatch(/getting worse/);
    const stable = caseOf({ rule: 'R3', detections: [detection({ rule: 'R3', trend: 'stable' })] });
    expect(prioritize(stable, [], supported, NOW, 'en').reason).toBe('Speech has changed from their usual pattern');
  });

  it('tells the two R4 silences apart in the one-glance reason', () => {
    const silent = caseOf({ rule: 'R4', detections: [detection({ rule: 'R4', noResponse: 'silent_after_greeting' })] });
    const stopped = caseOf({ rule: 'R4', detections: [detection({ rule: 'R4', noResponse: 'stopped_responding' })] });
    expect(prioritize(silent, [], supported, NOW).reason).toBe('電話には出たが、ひとことも話していない');
    expect(prioritize(stopped, [], supported, NOW).reason).toBe('通話の途中から応答がなくなった');
    expect(prioritize(stopped, [], supported, NOW, 'en').reason).toBe('Stopped responding partway through the call');
  });

  it('ranks higher with higher confidence', () => {
    const lo = prioritize(caseOf({ detections: [detection({ confidence: 0.3 })] }), [], supported, NOW);
    const hi = prioritize(caseOf({ detections: [detection({ confidence: 0.9 })] }), [], supported, NOW);
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(lo.reason).toContain('確からしさは低め');
  });

  it('ranks higher with overlapping signals, counting each other rule once', () => {
    const c = caseOf();
    const alone = prioritize(c, [c], supported, NOW);
    const r3a = caseOf({ id: 'x', rule: 'R3' });
    const r3b = caseOf({ id: 'y', rule: 'R3' });
    const other = caseOf({ id: 'z', residentId: 'res-2', rule: 'R1' });
    const closed = caseOf({ id: 'w', rule: 'R1', status: 'closed' });
    const overlap = prioritize(c, [c, r3a, r3b, other, closed], supported, NOW);
    expect(overlap.score - alone.score).toBeCloseTo(2, 5);
  });

  it('ranks higher with longer streaks and larger speech changes', () => {
    const d1 = prioritize(caseOf({ detections: [detection({ poorIntakeDays: 2 })] }), [], supported, NOW);
    const d4 = prioritize(caseOf({ detections: [detection({ poorIntakeDays: 4 })] }), [], supported, NOW);
    expect(d4.score).toBeGreaterThan(d1.score);
    const m1 = prioritize(caseOf({ rule: 'R3', detections: [detection({ changeMagnitude: 1 })] }), [], supported, NOW);
    const m3 = prioritize(caseOf({ rule: 'R3', detections: [detection({ changeMagnitude: 3, trend: 'worsening' })] }), [], supported, NOW);
    expect(m3.score).toBeGreaterThan(m1.score);
  });

  it('uses the latest detection that has the value', () => {
    const c = caseOf({ detections: [detection({ poorIntakeDays: 3 }), detection({ poorIntakeDays: undefined })] });
    expect(prioritize(c, [], supported, NOW).reason).toBe('3日続けてほとんど食べていない');
  });

  it('ranks vulnerable residents higher', () => {
    const c = caseOf();
    expect(prioritize(c, [], vulnerable, NOW).score).toBeGreaterThan(prioritize(c, [], supported, NOW).score);
  });

  it('ranks older detections higher and mentions long waits', () => {
    const fresh = prioritize(caseOf({ firstDetectedAt: '2026-10-01T09:30:00.000Z' }), [], supported, NOW);
    const old = prioritize(caseOf({ firstDetectedAt: '2026-09-30T08:00:00.000Z' }), [], supported, NOW);
    expect(old.score).toBeGreaterThan(fresh.score);
    expect(old.reason).toContain('検知から26時間経過');
    expect(fresh.reason).not.toContain('経過');
  });

  it('uses the staff override as the effective urgency', () => {
    expect(prioritize(caseOf({ autoUrgency: 'urgent', staffUrgency: 'action' }), [], supported, NOW).urgency).toBe('action');
  });
});

describe('sortQueue (QUE-01)', () => {
  it('orders by urgency, then score, then oldest detection', () => {
    const mk = (id: string, autoUrgency: 'emergency' | 'urgent' | 'watch', first: string, v = supported) =>
      prioritize(caseOf({ id, autoUrgency, firstDetectedAt: first }), [], v, NOW);
    const items = [
      mk('watch', 'watch', '2026-10-01T09:00:00.000Z', vulnerable),
      mk('urgent-new', 'urgent', '2026-10-01T09:59:00.000Z'),
      mk('urgent-vuln', 'urgent', '2026-10-01T09:59:00.000Z', vulnerable),
      mk('emergency', 'emergency', '2026-10-01T09:59:00.000Z'),
    ];
    expect(sortQueue(items).map((i) => i.case.id)).toEqual(['emergency', 'urgent-vuln', 'urgent-new', 'watch']);
  });

  it('breaks exact ties by detection time', () => {
    const a = { ...prioritize(caseOf({ id: 'a', firstDetectedAt: '2026-10-01T09:00:00.000Z' }), [], supported, NOW), score: 1 };
    const b = { ...prioritize(caseOf({ id: 'b', firstDetectedAt: '2026-10-01T08:00:00.000Z' }), [], supported, NOW), score: 1 };
    expect(sortQueue([a, b]).map((i) => i.case.id)).toEqual(['b', 'a']);
  });
});
