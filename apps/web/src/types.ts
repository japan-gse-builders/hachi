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
  notifications: NotificationItem[];
}

export interface NotificationItem {
  recipient: string;
  channel: string;
  sentAt: string;
  delivery?: { status: string; errorCode?: string; at: string };
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
    autoUrgency: string;
    staffUrgency: string | null;
    staffScoreOffset: number;
    status: string;
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
  events: { at: string; actorUid: string; type: string; reason?: string; from?: string | number | null; to?: string | number | null }[];
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
}
