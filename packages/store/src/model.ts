import type {
  AnalysisGap,
  Case,
  CallConsent,
  CallSlot,
  CallSpeechSample,
  CallTag,
  Contact,
  ContactRequest,
  DeliveryReport,
  DomainState,
  IntakeObservation,
  ItemAnswer,
  OutboxMessage,
  Turn,
  Urgency,
  VulnerabilityProfile,
  WellbeingDomain,
} from '@hachi/core';

export type CallChannel = 'pstn' | 'whatsapp';

export interface StaffContact extends Contact {
  /** Phone number shown to family on the dashboard (FAM-04). */
  phone: string;
}

export interface FamilyContact extends Contact {
  relationship?: string;
}

/**
 * What the resident has agreed may be shared with their family. Recorded by staff from what the
 * resident said, because the resident is the one whose life it is: how they are in themselves is
 * not the family's to be told by default, however well meant.
 */
export interface ResidentConsent {
  /** Their mood and how alone they feel may be shared with the family contact. */
  shareMood: boolean;
  recordedAt: string;
  /** The staff member who heard the resident say it. */
  recordedBy: string;
}

/** The staff account responsible for a resident: the only one who may change their record. */
export interface ResidentOwner {
  uid: string;
  /** Copied from the account when it took the resident on, so others can see who to ask. */
  email?: string;
  name?: string;
  since: string;
}

/**
 * A family account allowed to open the resident's dashboard, by the email it signs in with.
 * Viewing only: alerts still go to `family`, the one contact the resident named for them.
 */
export interface FamilyAccess {
  email: string;
  addedAt: string;
  addedBy: string;
}

export interface Resident {
  id: string;
  /** The organization whose staff look after this resident. Fixed at registration. */
  orgId: string;
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
  /** Absent means nothing has been agreed, which is treated as "no". */
  consent?: ResidentConsent;
  /** Initial approval for AI calls, including family mood/loneliness updates for new approvals. */
  callConsent?: CallConsent;
  /** Absent until a staff account takes the resident on. */
  owner?: ResidentOwner;
  familyAccess?: FamilyAccess[];
  /**
   * Normalized family phone/email used to authorize dashboard access (FAM-01): the `family`
   * contact plus every `familyAccess` email. Derived, never written on its own.
   */
  familyLookup: string[];
  serviceStartedAt: string;
  /** New enrollment saved before approval; anchor its baseline/rotation when approval arrives. */
  serviceStartPending?: boolean;
  active: boolean;
  /** Generated demo/evaluation data, not a real person (USR-04). */
  synthetic?: boolean;
  /** The call that holds this resident's line right now, if any (see `CallSlot`). */
  callSlot?: CallSlot;
  /** The latest call staff asked Hachi to make; numbers the day's series and spaces requests out. */
  lastStaffCall?: { callId: string; at: string; requestedBy: string };
  createdAt: string;
  updatedAt: string;
}

export type CallStatus = 'scheduled' | 'in_progress' | 'completed' | 'no_answer' | 'failed';

export interface CallSummary {
  health: string;
  meals: string;
  topics: string[];
}

/** Why Hachi rang. Absent on the daily check-in and on calls made before staff could ask. */
export type CallTrigger = 'staff';

export interface CallRecord {
  id: string;
  residentId: string;
  source: 'live' | 'imported';
  /** 'staff': a member of staff asked Hachi to call now, outside the daily schedule. */
  trigger?: CallTrigger;
  /** uid of the staff member who asked, for `trigger: 'staff'`. */
  requestedBy?: string;
  /** Generated demo/evaluation data, not a real call (USR-04). */
  synthetic?: boolean;
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
  /** Wellbeing tags from the model review; absent on calls analysed before tags existed or without the model. */
  wellbeing?: CallWellbeing;
  speech?: CallSpeechSample;
  analysisPending: boolean;
  createdAt: string;
  /**
   * 0 for the scheduled call; incremented for each retry after a technical failure. Absent on
   * staff-requested calls, which are never retried: staff can ask again.
   */
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
  conversation?: {
    endedBy: ConversationEnd;
    at: string;
    /** The configured no-response prompts were exhausted: flag R1, rather than legacy R4. */
    noResponseEscalated?: boolean;
    /** Immediate R1 flag succeeded; post-call analysis must not create the same flag again. */
    noResponseCaseId?: string;
  };
  /** Recordings of additional media streams after a reconnect. */
  extraAudioUris?: string[];
  /** R1 raised during the call; the resident is bridged to family and staff. */
  emergency?: EmergencyState;
  /** Set by the analysis worker after the call. */
  analysis?: CallAnalysis;
  /** An analysis worker holds the call until this time. */
  analysisLease?: string;
  /** The last time staff asked for this call to be analysed again, and who asked. */
  reanalysis?: { requestedAt: string; requestedBy: string };
}

export interface CallWellbeing {
  /** Checked against the transcript: known ids, resident turns, enough confidence. */
  tags: CallTag[];
  domains: Record<WellbeingDomain, DomainState>;
  /** One plain sentence for family; absent when the model's sentence did not pass the checks. */
  headline?: string;
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
  /** The call's set screening questions that the resident actually answered. */
  answers?: ItemAnswer[];
  /** The resident asked for someone to ring them (kept whether or not a message could be sent). */
  contactRequest?: ContactRequest;
  /**
   * The parts that could not be done, and why, as categories. Present means the call was NOT fully
   * checked: staff must see it as such, never as a call in which nothing was found.
   */
  incomplete?: AnalysisGap[];
  /** Why the model could not be used, if it was not. Raw provider text: logs and this record only. */
  error?: string;
  /** Why speech could not be measured from the recording, if it was not. Same as `error`. */
  voiceError?: string;
}

/**
 * Why the conversation stopped. Silence has two names because they mean different things: someone
 * who answers and never speaks at all may be unable to, while someone who answers, talks and then
 * goes quiet has most likely just walked away. Collapsing both into "the call completed" would lose
 * the first one, which is the more serious of the two.
 */
export type ConversationEnd =
  | 'agent'
  | 'resident'
  | 'time_limit'
  | 'emergency'
  | 'gateway_error'
  | 'silent_after_greeting'
  | 'stopped_responding';

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

/**
 * `skipped`: the channel is not configured or the address is not allowed, so it was never sent.
 * `awaiting_approval`: waiting for a person to agree to it; the delivery worker only ever claims
 * `pending`, so an entry in this state cannot leave by accident.
 * `rejected`: a person read it and said no.
 */
export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'awaiting_approval' | 'rejected';

/** Who released a held message, kept so the decision has a name against it. */
export interface OutboxApproval {
  by: 'staff' | 'family';
  uid: string;
  at: string;
  decision: 'approved' | 'rejected';
}

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
  /** Copied from the resident, so one organization's held messages can be listed on their own. */
  orgId: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt?: string;
  /** A worker is sending until this time; after it, another worker may take over. */
  leaseUntil?: string;
  sentAt?: string;
  providerId?: string;
  lastError?: DeliveryFailure;
  /** Twilio's status callback after `sent`; only set for SMS and voice alerts. */
  delivery?: DeliveryReport;
  /** The decision that released or stopped a held message. */
  approval?: OutboxApproval;
  /** Shown to whoever approves it: the person the resident named, in their own words. */
  requestedFor?: string;
}

export interface CaseOutcome {
  anomalyConfirmed: boolean;
  note?: string;
}

export interface StoredCase extends Case {
  /** Copied from the resident, so one organization's queue can be listed on its own. */
  orgId: string;
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
