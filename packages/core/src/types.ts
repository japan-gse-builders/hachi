import type { Urgency } from './urgency.js';

export type RuleId = 'R1' | 'R2' | 'R3';
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
}

export type Trend = 'improving' | 'stable' | 'worsening';

export interface VulnerabilityProfile {
  livesAlone: boolean;
  hasCloseSupporter: boolean;
  needsCare: boolean;
  chronicConditions: string[];
}

export type CaseStatus = 'open' | 'in_progress' | 'closed';

export interface NotificationRecord {
  recipient: 'staff' | 'family';
  channel: ContactChannel;
  address: string;
  sentAt: string;
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
