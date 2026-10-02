import { describe, expect, it } from 'vitest';
import { applyDetections, effectiveUrgency } from '../src/cases.js';
import { caseOf, detection, idGen } from './fixtures.js';

describe('applyDetections', () => {
  it('creates a new case when none is open (PRI-01)', () => {
    const { cases, changes } = applyDetections([], [detection()], idGen());
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: 'new-1', rule: 'R2', autoUrgency: 'watch', status: 'open' });
    expect(changes).toEqual([expect.objectContaining({ type: 'created', caseId: 'new-1', from: null, to: 'watch' })]);
  });

  it('merges the same resident and rule into one open case', () => {
    const { cases, changes } = applyDetections(
      [caseOf()],
      [detection({ detectedAt: '2026-10-02T09:05:00.000Z', summary: 'Barely ate again' })],
      idGen(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]!.detections).toHaveLength(2);
    expect(cases[0]!.updatedAt).toBe('2026-10-02T09:05:00.000Z');
    expect(changes[0]).toMatchObject({ type: 'updated', from: 'watch', to: 'watch' });
  });

  it('keeps different rules and different residents in separate cases', () => {
    const { cases } = applyDetections(
      [caseOf()],
      [detection({ rule: 'R3', urgency: 'action' }), detection({ residentId: 'res-2' })],
      idGen(),
    );
    expect(cases.map((c) => `${c.residentId}/${c.rule}`)).toEqual(['res-1/R2', 'res-1/R3', 'res-2/R2']);
  });

  it('opens a new case when the previous one is closed', () => {
    const { cases, changes } = applyDetections([caseOf({ status: 'closed' })], [detection()], idGen());
    expect(cases).toHaveLength(2);
    expect(changes[0]!.type).toBe('created');
  });

  it('merges into in-progress cases too', () => {
    const { cases } = applyDetections([caseOf({ status: 'in_progress' })], [detection()], idGen());
    expect(cases).toHaveLength(1);
  });

  it('escalates watch to urgent when poor intake continues for 2 days (PRI-05)', () => {
    const { cases, changes } = applyDetections([caseOf()], [detection({ urgency: 'urgent', poorIntakeDays: 2 })], idGen());
    expect(cases[0]!.autoUrgency).toBe('urgent');
    expect(changes[0]).toMatchObject({ type: 'escalated', from: 'watch', to: 'urgent' });
  });

  it('never lowers urgency automatically (PRI-04)', () => {
    const { cases, changes } = applyDetections([caseOf({ autoUrgency: 'urgent' })], [detection({ urgency: 'watch' })], idGen());
    expect(cases[0]!.autoUrgency).toBe('urgent');
    expect(changes[0]).toMatchObject({ type: 'updated', from: 'urgent', to: 'urgent' });
  });

  it('keeps a staff override unless detection goes above it', () => {
    const lowered = caseOf({ autoUrgency: 'urgent', staffUrgency: 'watch' });
    const same = applyDetections([lowered], [detection({ urgency: 'watch' })], idGen());
    expect(effectiveUrgency(same.cases[0]!)).toBe('watch');

    const higher = applyDetections([lowered], [detection({ urgency: 'urgent' })], idGen());
    expect(higher.cases[0]!.staffUrgency).toBeUndefined();
    expect(effectiveUrgency(higher.cases[0]!)).toBe('urgent');
    expect(higher.changes[0]).toMatchObject({ type: 'escalated', from: 'watch', to: 'urgent' });
  });

  it('always treats R1 as emergency (DET-05) and clamps confidence', () => {
    const { cases } = applyDetections([], [detection({ rule: 'R1', urgency: 'watch', confidence: 1.7 })], idGen());
    expect(cases[0]!.autoUrgency).toBe('emergency');
    expect(cases[0]!.detections[0]!.confidence).toBe(1);
    const neg = applyDetections([], [detection({ confidence: -1 })], idGen());
    expect(neg.cases[0]!.detections[0]!.confidence).toBe(0);
  });

  it('does not mutate the input cases', () => {
    const original = caseOf();
    applyDetections([original], [detection({ urgency: 'urgent' })], idGen());
    expect(original.detections).toHaveLength(1);
    expect(original.autoUrgency).toBe('watch');
  });

  it('handles two detections for the same new case in one batch', () => {
    const { cases, changes } = applyDetections(
      [],
      [detection(), detection({ urgency: 'urgent', detectedAt: '2026-10-01T08:00:00.000Z' })],
      idGen(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]!.updatedAt).toBe('2026-10-01T09:05:00.000Z');
    expect(changes.map((c) => c.type)).toEqual(['created', 'escalated']);
  });
});
