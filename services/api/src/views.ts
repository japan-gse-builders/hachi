import {
  ANALYSIS_FAILURE_LABELS,
  baselineFor,
  buildBaseline,
  CASE_STATUS_LABELS,
  CASE_STATUSES,
  compareUrgency,
  spendStatus,
  STAFF_REQUEST_HOLD_MS,
  type SpendLedger,
  type SpendPolicy,
  combineStates,
  describeAnalysisGaps,
  domainStatus,
  effectiveUrgency,
  hasCallConsent,
  KIHON_DOMAIN_LABELS,
  LIFE_DOMAINS,
  localDate,
  isOurFault,
  MISSED_LABELS,
  MISSED_MEANINGS,
  missedCheckIn,
  missedReason,
  nextCallAt,
  overallStatus,
  prioritize,
  RULE_NAMES,
  scoreInstrument,
  sortQueue,
  SPEECH_FEATURES,
  tagTrends,
  URGENCIES,
  URGENCY_ACTIONS,
  URGENCY_LABELS,
  URGENCY_MEANINGS,
  usualRange,
  visibleToFamily,
  wellbeingTag,
  type AnalysisGap,
  type CheckInAttempt,
  type DomainState,
  type LifeDomain,
  type Locale,
  type MeasurementMethod,
  type PrioritizedCase,
  type SpeechFeature,
  type Turn,
  type WellbeingTagId,
} from '@hachi/core';
import { lonelinessFor, type CallRecord, type CallWellbeing, type CaseEvent, type Resident, type ResidentPortrait, type StoredCase } from '@hachi/store';

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
  residentPortrait: ResidentPortrait | null;
  rule: string;
  urgency: string;
  urgencyLabel: string;
  /** What this level asks of staff, so the scale is readable without the documentation. */
  urgencyMeaning: string;
  summary: string;
  reason: string;
  score: number;
  detectedAt: string;
  status: string;
  statusLabel: string;
  notifications: StoredCase['notifications'];
  residentFacts: string[];
  householdNotes: string | null;
  synthetic: boolean;
}

/** Recorded facts only; age is not currently collected by Hachi. */
export function residentFacts(r: Resident, locale: Locale): string[] {
  const v = r.vulnerability;
  return locale === 'ja'
    ? [v.livesAlone ? '一人暮らし' : '同居者あり', v.hasCloseSupporter ? '身近な支援者あり' : '身近な支援者なし', v.needsCare ? '介護が必要' : '介護の必要なしと記録']
    : [v.livesAlone ? 'Lives alone' : 'Lives with others', v.hasCloseSupporter ? 'Has a close supporter' : 'No close supporter', v.needsCare ? 'Needs care' : 'No care needs recorded'];
}

/** The whole scale, in order, for a legend above the queue: a card only ever shows its own level. */
export function urgencyLegend(locale: Locale) {
  return URGENCIES.map((u) => ({ urgency: u, label: URGENCY_LABELS[locale][u], action: URGENCY_ACTIONS[locale][u], meaning: URGENCY_MEANINGS[locale][u] }));
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
      residentPortrait: residents.get(c.residentId)!.portrait ?? null,
      residentFacts: residentFacts(residents.get(c.residentId)!, locale),
      householdNotes: residents.get(c.residentId)!.householdNotes ?? null,
      synthetic: residents.get(c.residentId)!.synthetic === true,
      rule: c.rule,
      urgency: p.urgency,
      urgencyLabel: URGENCY_LABELS[locale][p.urgency],
      urgencyMeaning: URGENCY_MEANINGS[locale][p.urgency],
      summary: c.detections.at(-1)?.summary ?? '',
      reason: p.reason,
      score: p.score,
      detectedAt: c.firstDetectedAt,
      status: c.status,
      statusLabel: CASE_STATUS_LABELS[locale][c.status],
      notifications: c.notifications,
    };
  });
}

/**
 * Days back a missed check-in stays on the queue. Two, not one: an outage in the evening would
 * otherwise roll off the screen before the morning on which anybody reads it.
 */
export const UNREACHED_DAYS = 2;
/** How far back "we last spoke to them on" is looked for. Beyond it the honest answer is nothing. */
export const UNREACHED_LOOKBACK_DAYS = 14;

export interface UnreachedResident {
  residentId: string;
  residentName: string;
  /** The resident's own date, so an evening in Tokyo is not filed as the previous day. */
  localDate: string;
  reason: string;
  reasonLabel: string;
  /** What the missing call asks of staff. */
  meaning: string;
  attempts: number;
  at: string;
  /** True for the three faults that are ours; false only when the resident did not pick up. */
  ourFault: boolean;
  /** Null when no call has connected within the lookback, which is worse news than a date. */
  lastReachedAt: string | null;
  /**
   * How many times we tried and when they were last heard from, as a sentence. Built here rather
   * than in the app because it is a statement about a resident, and those are the strings that go
   * untranslated and then drift when they live in the client.
   */
  tried: string;
}

export interface UnreachedView {
  items: UnreachedResident[];
  /** One sentence for the top of the queue; null when everybody has been reached. */
  note: string | null;
}

const attemptOf = (c: CallRecord): CheckInAttempt => ({
  status: c.status,
  ...(c.conversation ? { endedBy: c.conversation.endedBy } : {}),
  ...(c.failure?.code ? { failureCode: c.failure.code } : {}),
});

function triedSentence(attempts: number, lastReached: string | null, locale: Locale): string {
  if (locale === 'ja') {
    const n = `${attempts} 回かけました。`;
    return lastReached ? `${n}最後に話せたのは ${lastReached}。` : `${n}この ${UNREACHED_LOOKBACK_DAYS} 日間、通話がつながっていません。`;
  }
  const n = attempts === 1 ? 'Rang once.' : `Rang ${attempts} times.`;
  return lastReached ? `${n} Last talked on ${lastReached}.` : `${n} No call has connected in ${UNREACHED_LOOKBACK_DAYS} days.`;
}

function unreachedNote(items: readonly UnreachedResident[], locale: Locale): string | null {
  if (!items.length) return null;
  const ours = items.filter((i) => i.ourFault).length;
  if (locale === 'ja') {
    const head = `${items.length} 人の見守り通話ができていません。`;
    return ours ? `${head}うち ${ours} 人は Hachi 側の問題で、本人の状態は分かっていません。` : head;
  }
  const head = `No check-in call has happened for ${items.length} ${items.length === 1 ? 'resident' : 'residents'}.`;
  return ours ? `${head} For ${ours} of them the fault is ours, so nobody has heard from them at all.` : head;
}

/**
 * Residents nobody has spoken to. Built from the calls that are missing rather than the ones that
 * happened, which is why it cannot come from the detection rules: a resident whose call never
 * connected produces no detections, so produces no case, so disappears from the queue entirely.
 * That is the failure mode a check-in service is supposed to be incapable of.
 *
 * Only the most recent unreached day is reported per resident. Two rows for the same person say
 * nothing the one row does not, and the action — ring them — does not become more urgent for being
 * listed twice.
 *
 * `entries` is one store read per active resident. Acceptable at this service's size and not at
 * every size; the alternative is an index of calls by date across residents, which is worth having
 * before this list is long enough to need paging.
 */
export function buildUnreached(
  entries: readonly { resident: Resident; calls: readonly CallRecord[] }[],
  now: Date,
  locale: Locale,
): UnreachedView {
  const items: UnreachedResident[] = [];
  for (const { resident: r, calls: all } of entries) {
    if (!r.active || !hasCallConsent(r.callConsent)) continue;
    // A call staff asked for counts when somebody talked to the resident; one that did not connect is
    // not a missed check-in, because the check-in is the daily call and it has its own attempts.
    const calls = all.filter((c) => c.trigger !== 'staff' || (c.status === 'completed' && missedReason(attemptOf(c)) === null));
    const dateOf = (c: CallRecord) => c.localDate ?? localDate(new Date(c.startedAt), r.timeZone);
    const today = localDate(now, r.timeZone);
    const reached = calls.filter((c) => missedReason(attemptOf(c)) === null && c.status === 'completed');
    const lastReachedAt = reached.map((c) => c.startedAt).sort().at(-1) ?? null;
    for (let back = 0; back < UNREACHED_DAYS; back++) {
      const date = shiftDate(today, -back);
      const onDay = calls.filter((c) => dateOf(c) === date).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const missed = missedCheckIn(onDay.map((c) => ({ ...attemptOf(c), at: c.startedAt })));
      if (!missed) continue;
      items.push({
        residentId: r.id,
        residentName: r.name,
        localDate: date,
        reason: missed.reason,
        reasonLabel: MISSED_LABELS[locale][missed.reason],
        meaning: MISSED_MEANINGS[locale][missed.reason],
        attempts: missed.attempts,
        at: missed.at,
        ourFault: isOurFault(missed.reason),
        lastReachedAt,
        tried: triedSentence(missed.attempts, lastReachedAt && localDate(new Date(lastReachedAt), r.timeZone), locale),
      });
      break;
    }
  }
  // Our own faults first: they are the ones where nothing at all is known about the resident.
  items.sort((a, b) => Number(b.ourFault) - Number(a.ourFault) || b.at.localeCompare(a.at));
  return { items, note: unreachedNote(items, locale) };
}

/**
 * Days back a call whose analysis is incomplete stays on the queue. The same seven days R2 counts
 * meals over: an unchecked call older than that no longer changes what the rule can see.
 */
export const INCOMPLETE_DAYS = 7;

/**
 * What a call's analysis could not do. Calls analysed before the categories existed carry only the
 * raw messages, and still count: they are the calls this list was made to stop hiding.
 */
export function analysisGaps(c: CallRecord): AnalysisGap[] {
  const a = c.analysis;
  if (!a) return [];
  if (a.incomplete?.length) return a.incomplete;
  return [
    ...(a.error ? [{ part: 'review' as const, failure: 'unknown' as const }] : []),
    ...(a.voiceError ? [{ part: 'voice' as const, failure: 'unknown' as const }] : []),
  ];
}

/** True while a pass staff asked for is waiting to run. */
export function reanalysisRequested(c: CallRecord): boolean {
  const asked = c.reanalysis?.requestedAt;
  return c.analysisPending && !!asked && (!c.analysis || asked > c.analysis.at);
}

export interface IncompleteAnalysis {
  residentId: string;
  residentName: string;
  callId: string;
  startedAt: string;
  localDate: string;
  /** Which halves failed; categories only, never the provider's message. */
  parts: AnalysisGap['part'][];
  reasons: string[];
  notChecked: string;
  checked: string;
  reanalysisRequested: boolean;
}

export interface IncompleteView {
  items: IncompleteAnalysis[];
  /** One sentence for the top of the list; null when every call was fully checked. */
  note: string | null;
}

function incompleteNote(items: readonly IncompleteAnalysis[], locale: Locale): string | null {
  if (!items.length) return null;
  if (locale === 'ja') return `この ${INCOMPLETE_DAYS} 日間で ${items.length} 件の通話が最後まで解析できていません。「懸念なし」ではなく「未確認」です。`;
  const calls = items.length === 1 ? '1 call' : `${items.length} calls`;
  return `${calls} from the last ${INCOMPLETE_DAYS} days could not be fully checked. Treat them as unchecked, not as fine.`;
}

/**
 * Calls whose analysis did not finish, so staff can tell them apart from calls in which nothing was
 * found. Kept off the case list on purpose: a failed analysis is not a finding about the resident
 * and must not be ranked with one or given an urgency.
 */
export function buildIncompleteAnalyses(
  entries: readonly { resident: Resident; calls: readonly CallRecord[] }[],
  now: Date,
  locale: Locale,
): IncompleteView {
  const since = now.getTime() - INCOMPLETE_DAYS * 86_400_000;
  const items: IncompleteAnalysis[] = [];
  for (const { resident: r, calls } of entries) {
    for (const c of calls) {
      if (c.source === 'imported' || Date.parse(c.startedAt) < since) continue;
      const gaps = analysisGaps(c);
      const text = describeAnalysisGaps(gaps, locale);
      if (!text) continue;
      items.push({
        residentId: r.id,
        residentName: r.name,
        callId: c.id,
        startedAt: c.startedAt,
        localDate: c.localDate ?? localDate(new Date(c.startedAt), r.timeZone),
        parts: [...new Set(gaps.map((g) => g.part))],
        reasons: [...new Set(gaps.map((g) => ANALYSIS_FAILURE_LABELS[locale][g.failure]))],
        ...text,
        reanalysisRequested: reanalysisRequested(c),
      });
    }
  }
  items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { items, note: incompleteNote(items, locale) };
}

/**
 * One call's progress, for the "Call now" button to follow (issue #13). Before the telephony
 * service has created the call there is nothing stored yet, so it reads as `requested`, but only
 * for as long as the request holds the line: a task that never reached the telephony service would
 * otherwise read as "about to ring" for ever.
 */
export function callProgressView(callId: string, c: CallRecord | null, r: Resident, now: Date) {
  if (!c) {
    const asked = r.lastStaffCall?.callId === callId ? r.lastStaffCall : undefined;
    if (!asked) return null;
    const lapsed = now.getTime() - Date.parse(asked.at) > STAFF_REQUEST_HOLD_MS;
    return {
      id: callId,
      status: lapsed ? ('failed' as const) : ('requested' as const),
      trigger: 'staff' as const,
      requestedBy: asked.requestedBy,
      startedAt: asked.at,
      endedAt: null,
      durationSec: null,
      endedBy: null,
      failureCode: lapsed ? 'not_placed' : null,
    };
  }
  return {
    id: c.id,
    status: c.status,
    trigger: c.trigger ?? null,
    requestedBy: c.requestedBy ?? null,
    startedAt: c.startedAt,
    endedAt: c.endedAt ?? null,
    durationSec: c.durationSec ?? null,
    endedBy: c.conversation?.endedBy ?? null,
    failureCode: c.failure?.code ?? null,
  };
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
      ruleName: c.rule === 'R1' && c.detections.at(-1)?.noResponse
        ? (locale === 'ja' ? '繰り返し確認しても応答がない' : 'No response after repeated checks')
        : RULE_NAMES[locale][c.rule],
      urgency: effectiveUrgency(c),
      urgencyLabel: URGENCY_LABELS[locale][effectiveUrgency(c)],
      urgencyMeaning: URGENCY_MEANINGS[locale][effectiveUrgency(c)],
      autoUrgency: c.autoUrgency,
      staffUrgency: c.staffUrgency ?? null,
      staffScoreOffset: c.staffScoreOffset ?? 0,
      status: c.status,
      statusLabel: CASE_STATUS_LABELS[locale][c.status],
      reason: p.reason,
      score: p.score,
      firstDetectedAt: c.firstDetectedAt,
      updatedAt: c.updatedAt,
      notifications: c.notifications,
      outcome: c.outcome ?? null,
    },
    // Staff ring the person, not the rule: whoever handles this case should see what else is open for them.
    otherOpenCases: open
      .filter((x) => x.id !== c.id)
      .sort((a, b) => compareUrgency(effectiveUrgency(b), effectiveUrgency(a)) || a.firstDetectedAt.localeCompare(b.firstDetectedAt))
      .map((x) => ({
        id: x.id,
        ruleName: RULE_NAMES[locale][x.rule],
        urgency: effectiveUrgency(x),
        urgencyLabel: URGENCY_LABELS[locale][effectiveUrgency(x)],
        urgencyMeaning: URGENCY_MEANINGS[locale][effectiveUrgency(x)],
        summary: x.detections.at(-1)?.summary ?? '',
        statusLabel: CASE_STATUS_LABELS[locale][x.status],
        firstDetectedAt: x.firstDetectedAt,
      })),
    resident: {
      id: r.id,
      name: r.name,
      preferredName: r.preferredName,
      portrait: r.portrait ?? null,
      phone: r.phone,
      vulnerability: r.vulnerability,
      householdNotes: r.householdNotes ?? null,
      facts: residentFacts(r, locale),
      staff: { name: r.staff.name, phone: r.staff.phone, email: r.staff.email ?? null },
      // USR-04: the evidence carries this too, so a demo quote is never read as a real one.
      synthetic: r.synthetic === true,
      // Whether "Call now" can work at all (issue #13): the same conditions the daily call has.
      callable: r.active && !r.synthetic && hasCallConsent(r.callConsent),
    },
    detections: c.detections.map((d) => ({
      ...d,
      evidence: d.evidence.map((e) => ({ ...e, audioUrl: audioUrls.get(e.callId) ?? null })),
    })),
    calls: shown.map((x) => ({
      id: x.id,
      startedAt: x.startedAt,
      status: x.status,
      // Staff asked for this call (issue #13); null for the daily check-in.
      trigger: x.trigger ?? null,
      requestedBy: x.requestedBy ?? null,
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
    // The update form offers every state and level, so their names come from here too rather than
    // being written a second time in the app, where they would drift and stay English.
    statusOptions: CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[locale][s] })),
    urgencyOptions: URGENCIES.map((u) => ({ value: u, label: URGENCY_LABELS[locale][u], meaning: URGENCY_MEANINGS[locale][u] })),
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
    /** Whether family mood/loneliness updates are approved. */
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

/** The model's sentence can read like an ongoing emergency long after staff have dealt with it. */
const EMERGENCY_HEADLINE: Record<Locale, (name: string, status: string) => string> = {
  ja: (name, status) => `${name}さんが通話中に話したことについて、Hachi がケアチームに連絡しました。ケアチームの対応：${status}。`,
  en: (name, status) => `Hachi let the care team know about something ${name} said in this call. Care team follow-up: ${status}.`,
};

function familyHeadline(r: Resident, c: CallRecord, cases: StoredCase[], locale: Locale): string | null {
  const emergency = cases.find((x) => x.rule === 'R1' && x.detections.some((d) => d.evidence.some((e) => e.callId === c.id)));
  if (emergency) return EMERGENCY_HEADLINE[locale](r.name, CASE_STATUS_LABELS[locale][emergency.status]);
  // Generated free text can mention mood even when no mood tag was extracted.
  return r.consent?.shareMood ? (c.wellbeing?.headline ?? null) : null;
}

type LifeStates = Record<LifeDomain, DomainState>;

const perLifeDomain = (state: (d: LifeDomain) => DomainState) => Object.fromEntries(LIFE_DOMAINS.map((d) => [d, state(d)])) as LifeStates;
const familyDomains = (r: Resident, state: (d: LifeDomain) => DomainState) =>
  perLifeDomain((d) => d === 'mood' && !r.consent?.shareMood ? 'unmentioned' : state(d));
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
      domains: onDay.length ? familyDomains(r, (d) => combineStates(tagged.map((w) => w.domains[d] ?? 'unmentioned'))) : null,
    };
  });
  const tagged = connected.flatMap((c) => (c.wellbeing ? [c.wellbeing] : []));
  const trends = tagTrends(tagged.map(familyTagIds), FAMILY_TREND_CALLS)
    .slice(0, FAMILY_TRENDS_SHOWN)
    .map(({ id, ...counts }) => ({ ...describeTag(id, locale), ...counts }));
  const latest = connected[0];
  return {
    shareMood: Boolean(r.consent?.shareMood),
    latest: latest
      ? {
          startedAt: latest.startedAt,
          headline: familyHeadline(r, latest, cases, locale),
          domains: latest.wellbeing ? familyDomains(r, (d) => latest.wellbeing!.domains[d] ?? 'unmentioned') : null,
        }
      : null,
    days,
    trends,
  };
}

/**
 * FAM-02, FAM-03, FAM-04. Deliberately excludes recordings, transcripts, speech analysis and the
 * turns, basis and confidence behind tags, so residents can talk freely. Only `family` tags are
 * listed; mood is shown as a domain state only with approval. Without it, free-text summaries
 * and headlines are withheld too, since those can contain emotional information.
 */
export function buildFamilyDashboard(r: Resident, calls: CallRecord[], cases: StoredCase[], now: Date, locale: Locale) {
  const since = now.getTime() - FAMILY_WINDOW_DAYS * 86_400_000;
  const finished = calls.filter((c) => Date.parse(c.startedAt) >= since && c.status !== 'scheduled' && c.status !== 'in_progress');
  return {
    resident: { id: r.id, name: r.name },
    nextCallAt: r.active && hasCallConsent(r.callConsent) ? nextCallAt(r.callTime, r.timeZone, now).toISOString() : null,
    glance: familyGlance(r, finished.filter((c) => c.status === 'completed'), cases, now, locale),
    calls: finished.map((c) => {
      const w = c.status === 'completed' ? c.wellbeing : undefined;
      return {
        startedAt: c.startedAt,
        connected: c.status === 'completed',
        // Whether notes are still to come, and nothing about why: a missing note must not read as
        // a quiet day, and the reason is a matter for staff (FAM-03).
        notesPending: c.status === 'completed' && (c.analysisPending || analysisGaps(c).some((g) => g.part === 'review')),
        durationSec: c.status === 'completed' ? (c.durationSec ?? null) : null,
        summary: c.status === 'completed' && r.consent?.shareMood ? (c.familySummary ?? null) : null,
        headline: c.status === 'completed' ? familyHeadline(r, c, cases, locale) : null,
        domains: w ? familyDomains(r, (d) => w.domains[d] ?? 'unmentioned') : null,
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
        caseStatusLabel: CASE_STATUS_LABELS[locale][c.status],
      }))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    staff: { name: r.staff.name, phone: r.staff.phone, email: r.staff.email ?? null },
  };
}

/**
 * What staff need to know about the AI budget: nothing, until it stops their calls. The figures are
 * the operator's (Firestore `spend/{month}`, Cloud Billing); staff can do nothing with them, and the
 * budget is the whole deployment's, so no organization sees another's spending in it.
 */
export function buildSpendNotice(ledger: SpendLedger, policy: SpendPolicy, locale: Locale) {
  const s = spendStatus(ledger, policy);
  if (!s.paused) return null;
  return {
    month: s.month,
    paused: true as const,
    // It has to say that an emergency still gets through, or staff will assume it does not.
    note: locale === 'ja'
      ? '今月は新しい見守り通話を止めています。緊急時の連絡は止まりません。'
      : 'New check-in calls have stopped for this month. Emergency contact is unaffected.',
  };
}
