export interface QueueItem {
  caseId: string;
  residentId: string;
  residentName: string;
  residentPortrait?: Portrait | null;
  rule: string;
  urgency: string;
  urgencyLabel: string;
  urgencyMeaning: string;
  summary: string;
  reason: string;
  score: number;
  detectedAt: string;
  status: string;
  statusLabel: string;
  notifications: NotificationItem[];
  residentFacts?: string[];
  householdNotes?: string | null;
  synthetic?: boolean;
  /** The resident's nine-indicator inputs. Missing from servers older than the indicator bar. */
  signals?: ResidentSignals;
}

/**
 * R3's latest reading of how the resident speaks against their usual range: `slight_change` is its
 * `watch`, `clear_change` its `action`, `no_baseline` while the usual range is still being collected
 * and `insufficient_recent` when too few recent calls were usable to compare.
 */
export type SpeechStatus = 'usual' | 'slight_change' | 'clear_change' | 'no_baseline' | 'insufficient_recent';

/** Whether check-in calls are getting through, for the "Last reached" chip and the Calls indicator. */
export interface ReachSummary {
  /** The latest call that connected and in which the resident spoke; null when none in the lookback. */
  lastReachedAt: string | null;
  /** Consecutive resident-local days, back from today, whose check-in was due and did not connect. */
  missedDays: number;
  /** The most recent missed check-in failed on our side (`isOurFault`), so nothing is known about them. */
  ourFault: boolean;
}

/** Inputs for the nine indicators. Any missing field reads as "no data", never as good. */
export interface ResidentSignals {
  /** Start of the latest connected call `domains` comes from; null when no call connected in the lookback. */
  latestCallAt?: string | null;
  /** That call's six domains; null when it was analysed before tags existed. */
  domains?: DomainStates | null;
  speech?: SpeechStatus;
  reach?: ReachSummary;
  /** Calls in the incomplete-analyses window whose analysis did not finish, as `/api/incomplete-analyses` counts them. */
  unchecked?: number;
}

export interface UrgencyLegendItem {
  urgency: string;
  label: string;
  action: string;
  meaning?: string;
}

/** A resident nobody has spoken to. Wording is localized by the API, not here. */
export interface UnreachedResident {
  residentId: string;
  residentName: string;
  localDate: string;
  reason: string;
  reasonLabel: string;
  meaning: string;
  attempts: number;
  at: string;
  ourFault: boolean;
  lastReachedAt: string | null;
  tried: string;
  /** As `ReachSummary.missedDays`. Missing from servers older than the no-call ladder. */
  missedDays?: number;
}

/**
 * A call whose analysis did not finish (issue #11). Not a finding and not ranked: it says what has
 * not been checked, so it is never read as a call in which nothing was wrong. Localized by the API.
 */
export interface IncompleteAnalysis {
  residentId: string;
  residentName: string;
  callId: string;
  startedAt: string;
  localDate: string;
  parts: ('review' | 'voice')[];
  reasons: string[];
  notChecked: string;
  checked: string;
  reanalysisRequested: boolean;
}

export interface IncompleteAnalyses {
  items: IncompleteAnalysis[];
  note: string | null;
}

export interface Queue {
  items: QueueItem[];
  legend: UrgencyLegendItem[];
  summary?: { needsAttention: number; monitor: number; residents: number };
  /** Missing from servers older than the unreached list. */
  unreached?: { items: UnreachedResident[]; note: string | null };
  /** Missing from servers older than issue #11. */
  incomplete?: IncompleteAnalyses;
}

/** This month's AI spend. Null when the API was started without a budget configured. */
export interface Spend {
  month: string;
  paused: boolean;
  usedPercent: number;
  cap: string;
  committed: string;
  inFlight: string;
  remaining: string;
  note: string;
}

export interface NotificationItem {
  recipient: string;
  channel: string;
  sentAt: string;
  delivery?: { status: string; errorCode?: string; at: string };
}

export interface DomainStatus {
  domain: string;
  label: string;
  answered: number;
  of: number;
  flagged: number;
  /** Numbered Kihon items Hachi has no telephone question for, such as item 12 (a body-mass index). */
  missing: number[];
  /** Flagged items the domain's rule needs. Zero means the checklist gives it no rule of its own. */
  criterion?: number;
  /** Null when the answers cannot settle the domain's own criterion either way. */
  meets: boolean | null;
}

export interface InstrumentScore {
  instrument: string;
  score: number;
  answered: number;
  of: number;
  /** How many of the instrument's items can be asked by telephone. Fewer than `of` keeps it unread. */
  askable?: number;
  /** The instrument's published threshold. */
  cutoff?: number;
  positive: boolean | null;
}

/** What the set questions add up to. Missing from servers older than the screening questions. */
export interface Screening {
  asOf: string;
  domains: DomainStatus[];
  overall: { answered: number; of: number; flagged: number; meets: boolean | null };
  instruments: InstrumentScore[];
  loneliness: { status: string; summary: string };
  shareMood: boolean;
}

/** A text the resident asked for by phone, held until staff or their family agree to it. */
export interface ContactRequest {
  id: string;
  residentId: string;
  residentName: string;
  requestedFor: string;
  number: string;
  body: string;
  requestedAt: string;
}

export interface Evidence {
  callId: string;
  quote: string;
  startMs?: number;
  endMs?: number;
  audioUrl: string | null;
}

export interface CaseDetail {
  case: {
    id: string;
    rule: string;
    ruleName: string;
    urgency: string;
    urgencyLabel: string;
    urgencyMeaning: string;
    autoUrgency: string;
    staffUrgency: string | null;
    staffScoreOffset: number;
    status: string;
    statusLabel: string;
    reason: string;
    score: number;
    firstDetectedAt: string;
    updatedAt: string;
    notifications: (NotificationItem & { address: string })[];
    outcome: { anomalyConfirmed: boolean; note?: string } | null;
  };
  resident: {
    id: string;
    name: string;
    preferredName: string;
    portrait?: Portrait | null;
    phone: string;
    vulnerability: { livesAlone: boolean; hasCloseSupporter: boolean; needsCare: boolean; chronicConditions: string[] };
    householdNotes: string | null;
    facts?: string[];
    staff?: { name: string; phone: string; email: string | null };
    synthetic: boolean;
    /** Active, agreed to calls and not synthetic, so "Call now" can work (issue #13). Missing from older servers. */
    callable?: boolean;
    /** Missing from servers older than the indicator bar; `caseSignals` fills what it can from this page. */
    signals?: ResidentSignals;
  };
  detections: { summary: string; detectedAt: string; evidence: Evidence[]; noResponse?: 'silent_after_greeting' | 'stopped_responding' }[];
  calls: {
    id: string;
    startedAt: string;
    status: string;
    /** 'staff' when a member of staff asked Hachi to call (issue #13). Missing from older servers. */
    trigger?: 'staff' | null;
    requestedBy?: string | null;
    durationSec: number | null;
    summary: { health: string; meals: string; topics: string[] } | null;
    /** Missing from older servers; null for calls analysed before tags existed. */
    wellbeing?: StaffWellbeing | null;
    transcript?: { speaker: 'resident' | 'agent'; text: string; startMs: number; endMs: number }[];
  }[];
  speechTrend: SpeechPoint[];
  /** Missing from servers older than the speech chart; null until the resident has a baseline. */
  speechBaseline?: SpeechBaseline | null;
  screening?: Screening;
  events: { at: string; actorUid: string; type: string; reason?: string; from?: string | number | null; to?: string | number | null }[];
  statusOptions: { value: string; label: string }[];
  urgencyOptions: { value: string; label: string; meaning: string }[];
}

export interface StaffTag extends TagLabel {
  audience: 'family' | 'family_with_consent' | 'staff';
  turn: number;
  basis: 'said' | 'inferred';
  confidence: number;
  /** The resident's words in the cited turn. */
  quote: string | null;
}

export interface StaffWellbeing {
  headline: string | null;
  domains: Record<string, DomainState>;
  tags: StaffTag[];
}

export interface SpeechPoint {
  callId: string;
  at: string;
  features: Record<string, number | null>;
  /** Missing from older servers, which only sent usable calls. */
  usable?: boolean;
  exclusionReasons?: string[];
  measuredFrom?: 'audio' | 'transcript' | 'text_only';
}

export interface UsualRange {
  mean: number;
  low: number;
  high: number;
  n: number;
}

export interface SpeechBaseline {
  from: string;
  to: string;
  callCount: number;
  ranges: Record<string, { audio?: UsualRange; transcript?: UsualRange } | undefined>;
}

export type DomainState = 'good' | 'mixed' | 'concern' | 'unmentioned';
export type LifeDomain = 'body' | 'food' | 'sleep' | 'mood' | 'social' | 'activity';
export type DomainStates = Record<LifeDomain, DomainState>;

export interface TagLabel {
  id: string;
  label: string;
  domain: string;
  polarity: 'positive' | 'concern';
}

export interface TagTrend extends TagLabel {
  last: number;
  previous: number;
  lastCalls: number;
  previousCalls: number;
  direction: 'more' | 'less' | 'same' | null;
}

export interface FamilyGlance {
  /** Missing on older servers; do not display mood without explicit approval. */
  shareMood?: boolean;
  latest: { startedAt: string; headline: string | null; domains: DomainStates | null } | null;
  /** Oldest first, one per resident-local day; `domains` is null when no call connected that day. */
  days: { date: string; tagged: boolean; domains: DomainStates | null }[];
  trends: TagTrend[];
}

export interface FamilyDashboard {
  resident: { id: string; name: string };
  nextCallAt: string | null;
  /** Missing from servers older than wellbeing tags. */
  glance?: FamilyGlance;
  calls: {
    startedAt: string;
    connected: boolean;
    /** True while Hachi's notes on a connected call are not ready; never says why. Missing on older servers. */
    notesPending?: boolean;
    durationSec: number | null;
    summary: { health: string; meals: string; topics: string[] } | null;
    headline?: string | null;
    domains?: DomainStates | null;
    tags?: TagLabel[];
  }[];
  alerts: {
    sentAt: string;
    channels: string[];
    /** Missing from servers older than delivery tracking. */
    deliveries?: { channel: string; status: string | null; errorCode: string | null }[];
    caseStatus: string;
    caseStatusLabel: string;
  }[];
  staff: { name: string; phone: string; email: string | null };
  /** False for a relative who may view but is not the family contact. Missing on older servers. */
  receivesAlerts?: boolean;
}

/** The illustration beside a resident's name (`PORTRAITS`); without one their initials are shown. */
export type Portrait =
  | 'grandmother-1' | 'grandmother-2' | 'grandmother-3' | 'grandmother-4' | 'grandmother-5'
  | 'grandfather-1' | 'grandfather-2' | 'grandfather-3' | 'grandfather-4' | 'grandfather-5';

export interface Resident {
  id: string;
  name: string;
  preferredName: string;
  phone: string;
  callTime: string;
  timeZone: string;
  active: boolean;
  portrait?: Portrait;
  vulnerability?: { livesAlone: boolean; hasCloseSupporter: boolean; needsCare: boolean; chronicConditions: string[] };
  householdNotes?: string;
  /** The care team's contact for this resident, who gets the alerts. */
  staff?: { name: string; phone: string; sms?: string; email?: string };
  /** Absent until a staff member has recorded what the resident agreed to, which counts as "no". */
  consent?: { shareMood?: boolean; recordedAt?: string; recordedBy?: string };
  callConsent?: import('./privacy').CallConsent;
  /** The call holding this resident's line, if any; stale once `until` has passed (issue #13). */
  callSlot?: { callId: string; at: string; until: string };
  /** The family contact, who gets the alerts. */
  family?: { name: string; relationship?: string; sms?: string; email?: string };
  /** The staff member who may change this resident and their family access. Missing means nobody yet. */
  owner?: ResidentOwner;
  /** Family accounts, besides the contact, that can open the family dashboard. Missing on older servers. */
  familyAccess?: FamilyAccess[];
  /** Missing from servers older than the indicator bar, and from write responses. */
  signals?: ResidentSignals;
}

export interface ResidentOwner {
  uid: string;
  email?: string;
  name?: string;
  since: string;
}

export interface FamilyAccess {
  email: string;
  addedAt: string;
  addedBy: string;
}
