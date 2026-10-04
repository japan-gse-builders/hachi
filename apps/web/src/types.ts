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
  notifications: { recipient: string; channel: string; sentAt: string }[];
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
    notifications: { recipient: string; channel: string; address: string; sentAt: string }[];
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
  speechTrend: { callId: string; at: string; features: Record<string, number | null> }[];
  events: { at: string; actorUid: string; type: string; reason?: string; from?: string | number | null; to?: string | number | null }[];
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
