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
    transcript?: { speaker: 'resident' | 'agent'; text: string; startMs: number; endMs: number }[];
  }[];
  speechTrend: SpeechPoint[];
  /** Missing from servers older than the speech chart; null until the resident has a baseline. */
  speechBaseline?: SpeechBaseline | null;
  events: { at: string; actorUid: string; type: string; reason?: string; from?: string | number | null; to?: string | number | null }[];
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

export interface FamilyDashboard {
  resident: { id: string; name: string };
  nextCallAt: string | null;
  calls: {
    startedAt: string;
    connected: boolean;
    durationSec: number | null;
    summary: { health: string; meals: string; topics: string[] } | null;
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
