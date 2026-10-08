import type { Case, CaseStatus, Detection } from './types.js';
import { compareUrgency, maxUrgency, type Urgency } from './urgency.js';

export const CASE_STATUSES = ['open', 'in_progress', 'closed'] as const satisfies readonly CaseStatus[];

/** How the three states are named to staff. Written as the work, not as the row in the database. */
export const CASE_STATUS_LABELS: Record<'ja' | 'en', Record<CaseStatus, string>> = {
  ja: { open: '未対応', in_progress: '対応中', closed: '完了' },
  en: { open: 'Not started', in_progress: 'In progress', closed: 'Done' },
};

export type CaseChangeType = 'created' | 'escalated' | 'updated';

export interface CaseChange {
  type: CaseChangeType;
  caseId: string;
  from: Urgency | null;
  to: Urgency;
  detection: Detection;
}

export function effectiveUrgency(c: Pick<Case, 'autoUrgency' | 'staffUrgency'>): Urgency {
  return c.staffUrgency ?? c.autoUrgency;
}

function normalizeDetection(d: Detection): Detection {
  // DET-05: a clear R1 claim is always an emergency regardless of other judgements.
  const confidence = Math.min(1, Math.max(0, d.confidence));
  return d.rule === 'R1' ? { ...d, urgency: 'emergency', confidence } : { ...d, confidence };
}

/**
 * PRI-01 / PRI-05: merges detections into open cases (one per resident and rule).
 * Detection only ever raises the urgency automatically (PRI-04); lowering is left to staff.
 * If detection raises the urgency above a staff override, the override is cleared.
 */
export function applyDetections(
  existing: Case[],
  detections: Detection[],
  newId: () => string,
): { cases: Case[]; changes: CaseChange[] } {
  const cases = existing.map((c) => ({ ...c, detections: [...c.detections], notifications: [...c.notifications] }));
  const changes: CaseChange[] = [];

  for (const raw of detections) {
    const d = normalizeDetection(raw);
    const open = cases.find((c) => c.residentId === d.residentId && c.rule === d.rule && c.status !== 'closed');
    if (!open) {
      const c: Case = {
        id: newId(),
        residentId: d.residentId,
        rule: d.rule,
        autoUrgency: d.urgency,
        status: 'open',
        detections: [d],
        firstDetectedAt: d.detectedAt,
        updatedAt: d.detectedAt,
        notifications: [],
      };
      cases.push(c);
      changes.push({ type: 'created', caseId: c.id, from: null, to: d.urgency, detection: d });
      continue;
    }
    const before = effectiveUrgency(open);
    open.detections.push(d);
    open.autoUrgency = maxUrgency(open.autoUrgency, d.urgency);
    if (open.staffUrgency && compareUrgency(d.urgency, open.staffUrgency) > 0) delete open.staffUrgency;
    if (d.detectedAt > open.updatedAt) open.updatedAt = d.detectedAt;
    const after = effectiveUrgency(open);
    changes.push({
      type: compareUrgency(after, before) > 0 ? 'escalated' : 'updated',
      caseId: open.id,
      from: before,
      to: after,
      detection: d,
    });
  }
  return { cases, changes };
}
