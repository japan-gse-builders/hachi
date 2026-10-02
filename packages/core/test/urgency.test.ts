import { describe, expect, it } from 'vitest';
import { compareUrgency, isUrgency, maxUrgency, URGENCIES, URGENCY_LABELS, urgencyRank } from '../src/urgency.js';
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
    for (const u of URGENCIES) expect(URGENCY_LABELS.en[u]).toBeTruthy();
  });

  it('exports the public API from the package entry', () => {
    expect(typeof core.detectR1).toBe('function');
    expect(typeof core.applyDetections).toBe('function');
    expect(typeof core.planNotifications).toBe('function');
  });
});
