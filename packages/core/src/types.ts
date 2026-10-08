import type { NoResponseKind } from './r4.js';
import type { Urgency } from './urgency.js';

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4';
export type Locale = 'ja' | 'en';

export interface Evidence {
  callId: string;
  quote: string;
  /** Offset of the utterance within the call recording. */
  startMs?: number;
  endMs?: number;
}

export interface Detection {
  residentId: string;
  rule: RuleId;
  urgency: Urgency;
  /** 0..1 */
  confidence: number;
  summary: string;
  evidence: Evidence[];
  detectedAt: string;
  /** R2: number of days with poor food intake. */
  poorIntakeDays?: number;
  /** R3: composite change magnitude (adverse z-score). */
  changeMagnitude?: number;
  trend?: Trend;
  /** R4: which silence was heard, since the two mean different things. */
  noResponse?: NoResponseKind;
}

export type Trend = 'improving' | 'stable' | 'worsening';

export interface VulnerabilityProfile {
  livesAlone: boolean;
  hasCloseSupporter: boolean;
  needsCare: boolean;
  chronicConditions: string[];
}

export type CaseStatus = 'open' | 'in_progress' | 'closed';

/**
 * What the provider reported after accepting a text or call. "sent" only means it left Twilio;
 * "delivered" (SMS) and "answered" (voice) are the confirmations from the carrier or the phone.
 */
export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'ringing'
  | 'delivered'
  | 'answered'
  | 'undelivered'
  | 'failed'
  | 'no_answer'
  | 'busy'
  | 'canceled';

export interface DeliveryReport {
  status: DeliveryStatus;
  /** Provider error code, e.g. Twilio 30007 (filtered by the carrier). */
  errorCode?: string;
  at: string;
}

export interface NotificationRecord {
  recipient: 'staff' | 'family';
  channel: ContactChannel;
  address: string;
  sentAt: string;
  /** Absent for channels without delivery reports (email, push) and until the first report. */
  delivery?: DeliveryReport;
}

export interface Case {
  id: string;
  residentId: string;
  rule: RuleId;
  /** Latest urgency produced by detection. */
  autoUrgency: Urgency;
  /** Urgency set by staff (QUE-03); takes effect unless detection escalates above it. */
  staffUrgency?: Urgency;
  status: CaseStatus;
  detections: Detection[];
  firstDetectedAt: string;
  updatedAt: string;
  notifications: NotificationRecord[];
}

export type ContactChannel = 'sms' | 'email' | 'push' | 'voice';

export interface Contact {
  name: string;
  sms?: string;
  email?: string;
  /** FCM registration tokens. */
  pushTokens?: string[];
  /** Phone number for automated voice alerts. */
  voice?: string;
}
