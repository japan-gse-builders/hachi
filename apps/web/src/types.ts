export interface QueueItem {
  caseId: string;
  residentId: string;
  residentName: string;
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
}

export interface UrgencyLegendItem {
  urgency: string;
  label: string;
  action: string;
}

export interface Queue {
  items: QueueItem[];
  legend: UrgencyLegendItem[];
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
    phone: string;
    vulnerability: { livesAlone: boolean; hasCloseSupporter: boolean; needsCare: boolean; chronicConditions: string[] };
    householdNotes: string | null;
    synthetic: boolean;
  };
  detections: { summary: string; detectedAt: string; evidence: Evidence[] }[];
  calls: {
    id: string;
    startedAt: string;
    status: string;
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
}

export interface Resident {
  id: string;
  name: string;
  preferredName: string;
  phone: string;
  callTime: string;
  timeZone: string;
  active: boolean;
  /** Absent until a staff member has recorded what the resident agreed to, which counts as "no". */
  consent?: { shareMood?: boolean; recordedAt?: string; recordedBy?: string };
}
