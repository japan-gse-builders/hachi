import {
  effectiveUrgency,
  nextCallAt,
  prioritize,
  RULE_NAMES,
  sortQueue,
  URGENCY_LABELS,
  type Locale,
  type PrioritizedCase,
} from '@hachi/core';
import type { CallRecord, CaseEvent, Resident, StoredCase } from '@hachi/store';

export interface MediaSigner {
  /** Returns a short-lived HTTPS URL for a gs:// recording. */
  sign(gsUri: string): Promise<string>;
}

function prioritizeStored(c: StoredCase, residentCases: StoredCase[], r: Resident, now: Date, locale: Locale): PrioritizedCase {
  const p = prioritize(c, residentCases, r.vulnerability, now, locale);
  return { ...p, score: p.score + (c.staffScoreOffset ?? 0) };
}

export interface QueueItem {
  caseId: string;
  residentId: string;
  residentName: string;
  rule: string;
  urgency: string;
  urgencyLabel: string;
  summary: string;
  reason: string;
  score: number;
  detectedAt: string;
  status: string;
  notifications: StoredCase['notifications'];
}

/** QUE-01 */
export function buildQueue(openCases: StoredCase[], residents: Map<string, Resident>, now: Date, locale: Locale): QueueItem[] {
  const byResident = new Map<string, StoredCase[]>();
  for (const c of openCases) byResident.set(c.residentId, [...(byResident.get(c.residentId) ?? []), c]);
  const prioritized: PrioritizedCase[] = [];
  for (const c of openCases) {
    const r = residents.get(c.residentId);
    if (!r) continue;
    prioritized.push(prioritizeStored(c, byResident.get(c.residentId)!, r, now, locale));
  }
  return sortQueue(prioritized).map((p) => {
    const c = p.case as StoredCase;
    return {
      caseId: c.id,
      residentId: c.residentId,
      residentName: residents.get(c.residentId)!.name,
      rule: c.rule,
      urgency: p.urgency,
      urgencyLabel: URGENCY_LABELS[locale][p.urgency],
      summary: c.detections.at(-1)?.summary ?? '',
      reason: p.reason,
      score: p.score,
      detectedAt: c.firstDetectedAt,
      status: c.status,
      notifications: c.notifications,
    };
  });
}

/** QUE-02 */
export async function buildCaseDetail(
  c: StoredCase,
  r: Resident,
  residentCases: StoredCase[],
  calls: CallRecord[],
  events: CaseEvent[],
  signer: MediaSigner,
  now: Date,
  locale: Locale,
) {
  const open = residentCases.filter((x) => x.status !== 'closed');
  const p = prioritizeStored(c, open.some((x) => x.id === c.id) ? open : [...open, c], r, now, locale);
  const callById = new Map(calls.map((x) => [x.id, x]));
  const evidenceCallIds = new Set(c.detections.flatMap((d) => d.evidence.map((e) => e.callId)));
  const audioUrls = new Map<string, string>();
  await Promise.all(
    [...evidenceCallIds].map(async (id) => {
      const uri = callById.get(id)?.audioUri;
      if (uri) audioUrls.set(id, await signer.sign(uri));
    }),
  );
  return {
    case: {
      id: c.id,
      rule: c.rule,
      ruleName: RULE_NAMES[locale][c.rule],
      urgency: effectiveUrgency(c),
      urgencyLabel: URGENCY_LABELS[locale][effectiveUrgency(c)],
      autoUrgency: c.autoUrgency,
      staffUrgency: c.staffUrgency ?? null,
      staffScoreOffset: c.staffScoreOffset ?? 0,
      status: c.status,
      reason: p.reason,
      score: p.score,
      firstDetectedAt: c.firstDetectedAt,
      updatedAt: c.updatedAt,
      notifications: c.notifications,
      outcome: c.outcome ?? null,
    },
    resident: {
      id: r.id,
      name: r.name,
      preferredName: r.preferredName,
      phone: r.phone,
      vulnerability: r.vulnerability,
      householdNotes: r.householdNotes ?? null,
    },
    detections: c.detections.map((d) => ({
      ...d,
      evidence: d.evidence.map((e) => ({ ...e, audioUrl: audioUrls.get(e.callId) ?? null })),
    })),
    calls: calls.map((x) => ({
      id: x.id,
      startedAt: x.startedAt,
      status: x.status,
      durationSec: x.durationSec ?? null,
      summary: x.summary ?? null,
      transcript: evidenceCallIds.has(x.id) ? (x.transcript ?? []) : undefined,
    })),
    speechTrend: calls
      .filter((x) => x.speech?.usable)
      .map((x) => ({ callId: x.id, at: x.startedAt, features: x.speech!.features }))
      .reverse(),
    events,
  };
}

export const FAMILY_WINDOW_DAYS = 14;

const STATUS_LABELS: Record<Locale, Record<StoredCase['status'], string>> = {
  ja: { open: '未対応', in_progress: '対応中', closed: '完了' },
  en: { open: 'Not started', in_progress: 'In progress', closed: 'Done' },
};

/**
 * FAM-02, FAM-03, FAM-04. Deliberately excludes recordings, transcripts and speech analysis
 * so residents can talk freely.
 */
export function buildFamilyDashboard(r: Resident, calls: CallRecord[], cases: StoredCase[], now: Date, locale: Locale) {
  const since = now.getTime() - FAMILY_WINDOW_DAYS * 86_400_000;
  return {
    resident: { id: r.id, name: r.name },
    nextCallAt: r.active ? nextCallAt(r.callTime, r.timeZone, now).toISOString() : null,
    calls: calls
      .filter((c) => Date.parse(c.startedAt) >= since && c.status !== 'scheduled' && c.status !== 'in_progress')
      .map((c) => ({
        startedAt: c.startedAt,
        connected: c.status === 'completed',
        durationSec: c.status === 'completed' ? (c.durationSec ?? null) : null,
        summary: c.status === 'completed' ? (c.familySummary ?? null) : null,
      })),
    alerts: cases
      .map((c) => ({ c, sent: c.notifications.filter((n) => n.recipient === 'family') }))
      .filter(({ sent }) => sent.length > 0)
      .map(({ c, sent }) => ({
        sentAt: sent.map((n) => n.sentAt).sort()[0]!,
        channels: [...new Set(sent.map((n) => n.channel))],
        // Per message, without addresses; null until the provider reports (and always for email and push).
        deliveries: sent.map((n) => ({ channel: n.channel, status: n.delivery?.status ?? null, errorCode: n.delivery?.errorCode ?? null })),
        caseStatus: c.status,
        caseStatusLabel: STATUS_LABELS[locale][c.status],
      }))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    staff: { name: r.staff.name, phone: r.staff.phone, email: r.staff.email ?? null },
  };
}
