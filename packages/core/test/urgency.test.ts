import { describe, expect, it } from 'vitest';
import { CASE_STATUS_LABELS, CASE_STATUSES } from '../src/cases.js';
import { compareUrgency, isUrgency, maxUrgency, URGENCIES, URGENCY_ACTIONS, URGENCY_LABELS, URGENCY_MEANINGS, urgencyRank } from '../src/urgency.js';
import * as core from '../src/index.js';

describe('urgency', () => {
  it('orders emergency > urgent > action > watch', () => {
    expect(URGENCIES.map(urgencyRank)).toEqual([4, 3, 2, 1]);
    expect(compareUrgency('emergency', 'watch')).toBeGreaterThan(0);
    expect(compareUrgency('watch', 'action')).toBeLessThan(0);
    expect(compareUrgency('urgent', 'urgent')).toBe(0);
  });

  it('maxUrgency picks the more urgent', () => {
    expect(maxUrgency('watch', 'urgent')).toBe('urgent');
    expect(maxUrgency('emergency', 'action')).toBe('emergency');
    expect(maxUrgency('action', 'action')).toBe('action');
  });

  it('validates values', () => {
    expect(isUrgency('urgent')).toBe(true);
    expect(isUrgency('critical')).toBe(false);
    expect(isUrgency(3)).toBe(false);
  });

  it('has labels for every urgency in both locales', () => {
    expect(URGENCY_LABELS.ja.emergency).toBe('緊急');
    expect(URGENCY_LABELS.ja.watch).toBe('経過観察');
    expect(URGENCY_LABELS.en).toEqual({ emergency: 'Immediate action', urgent: 'Review today', action: 'Review soon', watch: 'Monitor' });
    for (const u of URGENCIES) expect(URGENCY_LABELS.en[u]).toMatch(/^[ -~]+$/);
  });

  it('says what every level asks for, long and short, in both locales', () => {
    for (const locale of ['ja', 'en'] as const)
      for (const u of URGENCIES) {
        expect(URGENCY_MEANINGS[locale][u].length).toBeGreaterThan(0);
        expect(URGENCY_ACTIONS[locale][u].length).toBeGreaterThan(0);
      }
    // A scale whose levels share wording does not tell staff which one they are looking at.
    expect(new Set(URGENCIES.map((u) => URGENCY_MEANINGS.en[u])).size).toBe(URGENCIES.length);
    expect(new Set(URGENCIES.map((u) => URGENCY_ACTIONS.en[u])).size).toBe(URGENCIES.length);
    expect(URGENCY_MEANINGS.en.emergency).toContain('now');
    for (const u of URGENCIES) expect(URGENCY_ACTIONS.en[u].length).toBeLessThanOrEqual(URGENCY_MEANINGS.en[u].length);
  });

  it('names the three case states as the work, not as the stored value', () => {
    expect(CASE_STATUSES).toEqual(['open', 'in_progress', 'closed']);
    for (const locale of ['ja', 'en'] as const) for (const s of CASE_STATUSES) expect(CASE_STATUS_LABELS[locale][s].length).toBeGreaterThan(0);
    expect(CASE_STATUS_LABELS.en.in_progress).toBe('In progress');
    for (const s of CASE_STATUSES) expect(CASE_STATUS_LABELS.en[s]).not.toContain('_');
  });

  it('exports the public API from the package entry', () => {
    expect(typeof core.detectR1).toBe('function');
    expect(typeof core.applyDetections).toBe('function');
    expect(typeof core.planNotifications).toBe('function');
  });
});
