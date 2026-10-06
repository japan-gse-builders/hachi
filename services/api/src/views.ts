import {
  baselineFor,
  buildBaseline,
  combineStates,
  domainStatus,
  effectiveUrgency,
  KIHON_DOMAIN_LABELS,
  LIFE_DOMAINS,
  localDate,
  nextCallAt,
  overallStatus,
  prioritize,
  RULE_NAMES,
  scoreInstrument,
  sortQueue,
  SPEECH_FEATURES,
  tagTrends,
  URGENCY_LABELS,
  usualRange,
  visibleToFamily,
  wellbeingTag,
  type DomainState,
  type LifeDomain,
  type Locale,
  type MeasurementMethod,
  type PrioritizedCase,
  type SpeechFeature,
  type Turn,
  type WellbeingTagId,
} from '@hachi/core';
import { lonelinessFor, type CallRecord, type CallWellbeing, type CaseEvent, type Resident, type StoredCase } from '@hachi/store';

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
      wellbeing: x.wellbeing ? staffWellbeing(x.wellbeing, x.transcript ?? [], locale) : null,
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
    screening: screeningView(r, calls, now),
    events,
  };
}

/**
 * What the set questions add up to, for staff. Hachi does not administer the Kihon Checklist and
 * does not score it: residents here speak English and the instrument may not be reworded, so each
 * domain is reported with how many of its numbered items have an answer at all. `meets` is null
 * wherever the answers cannot settle it, and `missing` names items Hachi has no telephone question
 * for, such as item 12, which is a body-mass index.
 *
 * `instruments` is the same evidence in the other frame: what each published instrument makes of
 * its own items, on its own cutoff. Staff here work to the Kihon domains, but the resident speaks
 * English and may well have a doctor who does too, and to them a PHQ-2 or a STEADI result is the
 * readable one. Reporting only the mapping would throw that away.
 */
function screeningView(r: Resident, calls: CallRecord[], now: Date) {
  const asOf = localDate(now, r.timeZone);
  const answers = calls.flatMap((c) => c.analysis?.answers ?? []);
  return {
    asOf,
    domains: domainStatus(answers, asOf).map((d) => ({ ...d, label: KIHON_DOMAIN_LABELS[d.domain].en })),
    overall: overallStatus(answers, asOf),
    instruments: (['ULS-3', 'PHQ-2', 'FRAIL', 'STEADI'] as const).map((i) => scoreInstrument(i, answers, asOf)),
    loneliness: lonelinessFor(r, calls, asOf),
    /** Whether the resident agreed their family may be told how they are in themselves. */
    shareMood: Boolean(r.consent?.shareMood),
  };
}

const describeTag = (id: WellbeingTagId, locale: Locale) => {
  const t = wellbeingTag(id);
  return { id, label: t.label[locale], domain: t.domain, polarity: t.polarity };
};

/** Staff see every tag with the resident's words it came from, so they can check it. */
function staffWellbeing(w: CallWellbeing, transcript: Turn[], locale: Locale) {
  return {
    headline: w.headline ?? null,
    domains: w.domains,
    tags: w.tags.map((t) => ({
      ...describeTag(t.id, locale),
      audience: wellbeingTag(t.id).audience,
      turn: t.turn,
      basis: t.basis,
      confidence: t.confidence,
      quote: transcript[t.turn]?.text.slice(0, 300) ?? null,
    })),
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
/** Tag trends compare the latest calls with the same number of calls before them. */
export const FAMILY_TREND_CALLS = 7;
const FAMILY_TRENDS_SHOWN = 8;

const STATUS_LABELS: Record<Locale, Record<StoredCase['status'], string>> = {
  ja: { open: '未対応', in_progress: '対応中', closed: '完了' },
  en: { open: 'Not started', in_progress: 'In progress', closed: 'Done' },
};

/** The model's sentence can read like an ongoing emergency long after staff have dealt with it. */
const EMERGENCY_HEADLINE: Record<Locale, (name: string, status: string) => string> = {
  ja: (name, status) => `${name}さんが通話中に話したことについて、Hachi がケアチームに連絡しました。ケアチームの対応：${status}。`,
  en: (name, status) => `Hachi let the care team know about something ${name} said in this call. Care team follow-up: ${status}.`,
};

function familyHeadline(r: Resident, c: CallRecord, cases: StoredCase[], locale: Locale): string | null {
  const emergency = cases.find((x) => x.rule === 'R1' && x.detections.some((d) => d.evidence.some((e) => e.callId === c.id)));
  if (emergency) return EMERGENCY_HEADLINE[locale](r.name, STATUS_LABELS[locale][emergency.status]);
  return c.wellbeing?.headline ?? null;
}

type LifeStates = Record<LifeDomain, DomainState>;

const perLifeDomain = (state: (d: LifeDomain) => DomainState) => Object.fromEntries(LIFE_DOMAINS.map((d) => [d, state(d)])) as LifeStates;
const familyTagIds = (w: CallWellbeing) => w.tags.map((t) => t.id).filter(visibleToFamily);
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The latest call's domains, one column per resident-local day (null: no call that connected)
 * and how often each family-visible tag came up. Calls analysed before tags existed count as
 * "not talked about", never as fine.
 */
function familyGlance(r: Resident, calls: CallRecord[], cases: StoredCase[], now: Date, locale: Locale) {
  const connected = [...calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const dateOf = (c: CallRecord) => c.localDate ?? localDate(new Date(c.startedAt), r.timeZone);
  const today = localDate(now, r.timeZone);
  const days = Array.from({ length: FAMILY_WINDOW_DAYS }, (_, i) => shiftDate(today, i + 1 - FAMILY_WINDOW_DAYS)).map((date) => {
    const onDay = connected.filter((c) => dateOf(c) === date);
    const tagged = onDay.flatMap((c) => (c.wellbeing ? [c.wellbeing] : []));
    return {
      date,
      tagged: tagged.length > 0,
      domains: onDay.length ? perLifeDomain((d) => combineStates(tagged.map((w) => w.domains[d] ?? 'unmentioned'))) : null,
    };
  });
  const tagged = connected.flatMap((c) => (c.wellbeing ? [c.wellbeing] : []));
  const trends = tagTrends(tagged.map(familyTagIds), FAMILY_TREND_CALLS)
    .slice(0, FAMILY_TRENDS_SHOWN)
    .map(({ id, ...counts }) => ({ ...describeTag(id, locale), ...counts }));
  const latest = connected[0];
  return {
    latest: latest
      ? {
          startedAt: latest.startedAt,
          headline: familyHeadline(r, latest, cases, locale),
          domains: latest.wellbeing ? perLifeDomain((d) => latest.wellbeing!.domains[d] ?? 'unmentioned') : null,
        }
      : null,
    days,
    trends,
  };
}

/**
 * FAM-02, FAM-03, FAM-04. Deliberately excludes recordings, transcripts, speech analysis and the
 * turns, basis and confidence behind tags, so residents can talk freely. Only `family` tags are
 * listed; mood is shown as a domain state only.
 */
export function buildFamilyDashboard(r: Resident, calls: CallRecord[], cases: StoredCase[], now: Date, locale: Locale) {
  const since = now.getTime() - FAMILY_WINDOW_DAYS * 86_400_000;
  const finished = calls.filter((c) => Date.parse(c.startedAt) >= since && c.status !== 'scheduled' && c.status !== 'in_progress');
  return {
    resident: { id: r.id, name: r.name },
    nextCallAt: r.active ? nextCallAt(r.callTime, r.timeZone, now).toISOString() : null,
    glance: familyGlance(r, finished.filter((c) => c.status === 'completed'), cases, now, locale),
    calls: finished.map((c) => {
      const w = c.status === 'completed' ? c.wellbeing : undefined;
      return {
        startedAt: c.startedAt,
        connected: c.status === 'completed',
        durationSec: c.status === 'completed' ? (c.durationSec ?? null) : null,
        summary: c.status === 'completed' ? (c.familySummary ?? null) : null,
        headline: c.status === 'completed' ? familyHeadline(r, c, cases, locale) : null,
        domains: w ? perLifeDomain((d) => w.domains[d] ?? 'unmentioned') : null,
        tags: w ? familyTagIds(w).map((id) => describeTag(id, locale)) : [],
      };
    }),
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
