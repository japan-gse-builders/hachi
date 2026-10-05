import {
  baselineFor,
  buildBaseline,
  effectiveUrgency,
  nextCallAt,
  prioritize,
  RULE_NAMES,
  sortQueue,
  SPEECH_FEATURES,
  URGENCY_LABELS,
  usualRange,
  type Locale,
  type MeasurementMethod,
  type PrioritizedCase,
  type SpeechFeature,
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

/** Calls listed on the case page; the speech baseline may come from older ones. */
export const CASE_CALLS = 60;

/** QUE-02. `calls` are newest first, up to HISTORY_CALLS so the baseline matches the analyzer's. */
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
  const shown = calls.slice(0, CASE_CALLS);
  const callById = new Map(shown.map((x) => [x.id, x]));
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
    calls: shown.map((x) => ({
      id: x.id,
      startedAt: x.startedAt,
      status: x.status,
      durationSec: x.durationSec ?? null,
      summary: x.summary ?? null,
      transcript: evidenceCallIds.has(x.id) ? (x.transcript ?? []) : undefined,
    })),
    // Unusable calls are kept, marked, so staff can see e.g. a cold rather than a gap.
    speechTrend: shown
      .filter((x) => x.speech)
      .map((x) => ({
        callId: x.id,
        at: x.startedAt,
        features: x.speech!.features,
        usable: x.speech!.usable,
        exclusionReasons: x.speech!.exclusionReasons,
        measuredFrom: x.speech!.measuredFrom ?? 'transcript',
      }))
      .reverse(),
    speechBaseline: speechBaselineView(calls, r.serviceStartedAt),
    events,
  };
}

/** Staff only: the resident's usual range per feature and measuring method, as the analyzer compares against. */
function speechBaselineView(calls: CallRecord[], serviceStartedAt: string) {
  const b = buildBaseline(calls.flatMap((x) => (x.speech ? [x.speech] : [])), serviceStartedAt);
  if (!b) return null;
  const ranges: Partial<Record<SpeechFeature, Partial<Record<MeasurementMethod, ReturnType<typeof usualRange>>>>> = {};
  for (const f of SPEECH_FEATURES) {
    for (const m of ['audio', 'transcript'] as const) {
      const st = baselineFor(b, f, m);
      if (st) ranges[f] = { ...ranges[f], [m]: usualRange(f, st) };
    }
  }
  return { from: b.from, to: b.to, callCount: b.callCount, ranges };
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
