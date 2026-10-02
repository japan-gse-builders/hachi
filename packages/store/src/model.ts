import type { Case, CallSpeechSample, Contact, IntakeObservation, OutboxMessage, Turn, Urgency, VulnerabilityProfile } from '@hachi/core';

export type CallChannel = 'pstn' | 'whatsapp';

export interface StaffContact extends Contact {
  /** Phone number shown to family on the dashboard (FAM-04). */
  phone: string;
}

export interface FamilyContact extends Contact {
  relationship?: string;
}

export interface Resident {
  id: string;
  name: string;
  preferredName: string;
  phone: string;
  channel: CallChannel;
  /** Daily call time, HH:mm in `timeZone` (CNV-01). */
  callTime: string;
  timeZone: string;
  vulnerability: VulnerabilityProfile;
  householdNotes?: string;
  staff: StaffContact;
  family?: FamilyContact;
  /** Normalized family phone/email used to authorize dashboard access (FAM-01). */
  familyLookup: string[];
  serviceStartedAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CallStatus = 'scheduled' | 'in_progress' | 'completed' | 'no_answer' | 'failed';

export interface CallSummary {
  health: string;
  meals: string;
  topics: string[];
}

export interface CallRecord {
  id: string;
  residentId: string;
  source: 'live' | 'imported';
  status: CallStatus;
  channel: CallChannel;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  /** gs:// URI of the recording (CNV-06). */
  audioUri?: string;
  transcript?: Turn[];
  /** Staff-facing summary (QUE-02). */
  summary?: CallSummary;
  /** Plain-language summary for family (FAM-03). */
  familySummary?: CallSummary;
  speech?: CallSpeechSample;
  analysisPending: boolean;
  createdAt: string;
  /** 0 for the scheduled call; incremented for each retry after a technical failure. */
  attempt?: number;
  /** Twilio Call SID. */
  providerCallId?: string;
  /** Resident-local date the call belongs to (YYYY-MM-DD). */
  localDate?: string;
  failure?: { code?: string; message: string; retryable: boolean };
  /** Held while a worker is dialing, so a redelivered task does not dial the same call twice. */
  dialLease?: { token: string; at: string };
  /** Random per-call secret passed to the Voice Gateway through TwiML; authenticates the media stream. */
  streamToken?: string;
  /** Number of media streams opened for this call (a dropped stream is reconnected a limited number of times). */
  streams?: number;
  /** Set by the Voice Gateway when the conversation ends; tells Twilio what to do next. */
  conversation?: { endedBy: ConversationEnd; at: string };
  /** Recordings of additional media streams after a reconnect. */
  extraAudioUris?: string[];
  /** R1 raised during the call; the resident is bridged to family and staff. */
  emergency?: EmergencyState;
  /** Set by the analysis worker after the call. */
  analysis?: CallAnalysis;
  /** An analysis worker holds the call until this time. */
  analysisLease?: string;
}

/** CNV-07: what the resident talked about, used to open later calls (CNV-08). */
export interface CallMemory {
  topics: string[];
  plans: string[];
  likes: string[];
}

export interface CallAnalysis {
  at: string;
  /** Model that produced the summaries; absent when only the rule-based checks ran. */
  model?: string;
  /** Transcript turns covered; turns added later by a reconnected stream need another pass. */
  turns: number;
  intake: IntakeObservation;
  memory: CallMemory;
  /** Why the model could not be used, if it was not. */
  error?: string;
}

export type ConversationEnd = 'agent' | 'resident' | 'time_limit' | 'emergency' | 'gateway_error';

export interface EmergencyLeg {
  recipient: 'staff' | 'family';
  to: string;
  providerCallId?: string;
  error?: string;
}

export interface EmergencyState {
  at: string;
  caseId: string;
  quote: string;
  /** Outbound alert calls to family and staff who are offered to join the resident's call. */
  legs?: EmergencyLeg[];
}

/** `skipped`: the channel is not configured or the address is not allowed, so it was never sent. */
export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface DeliveryFailure {
  code?: string;
  message: string;
  retryable: boolean;
}

/** Notification delivered by the notification worker. */
export interface OutboxEntry extends OutboxMessage {
  /** SHA-256 of the idempotency key. */
  id: string;
  residentId: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt?: string;
  /** A worker is sending until this time; after it, another worker may take over. */
  leaseUntil?: string;
  sentAt?: string;
  providerId?: string;
  lastError?: DeliveryFailure;
}

export interface CaseOutcome {
  anomalyConfirmed: boolean;
  note?: string;
}

export interface StoredCase extends Case {
  /** QUE-03: staff adjustment added to the computed priority score. */
  staffScoreOffset?: number;
  outcome?: CaseOutcome;
  closedAt?: string;
}

export type CaseEventType = 'status_changed' | 'urgency_changed' | 'rank_changed' | 'closed';

/** PRI-06: every staff correction is kept with the automatic value at that time. */
export interface CaseEvent {
  id: string;
  caseId: string;
  at: string;
  actorUid: string;
  type: CaseEventType;
  from?: string | number | null;
  to?: string | number | null;
  autoUrgency: Urgency;
  reason?: string;
  outcome?: CaseOutcome;
}
