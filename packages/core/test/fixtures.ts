import type { Case, Detection, VulnerabilityProfile } from '../src/types.js';

export function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    residentId: 'res-1',
    rule: 'R2',
    urgency: 'watch',
    confidence: 0.8,
    summary: 'Barely ate yesterday',
    evidence: [{ callId: 'call-1', quote: 'I only had a biscuit', startMs: 1000, endMs: 2000 }],
    detectedAt: '2026-10-01T09:05:00.000Z',
    ...overrides,
  };
}

export function caseOf(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-1',
    residentId: 'res-1',
    rule: 'R2',
    autoUrgency: 'watch',
    status: 'open',
    detections: [detection()],
    firstDetectedAt: '2026-10-01T09:05:00.000Z',
    updatedAt: '2026-10-01T09:05:00.000Z',
    notifications: [],
    ...overrides,
  };
}

export const supported: VulnerabilityProfile = {
  livesAlone: false,
  hasCloseSupporter: true,
  needsCare: false,
  chronicConditions: [],
};

export const vulnerable: VulnerabilityProfile = {
  livesAlone: true,
  hasCloseSupporter: false,
  needsCare: true,
  chronicConditions: ['heart disease', 'diabetes'],
};

export function idGen(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
