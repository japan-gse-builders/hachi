import { analysisTask, requestDelivery, type TaskQueue } from '@hachi/cloud';
import {
  analysisMicros,
  charge,
  HISTORY_CALLS,
  itemsForCall,
  localDate,
  spendMonth,
  type Detection,
  type Locale,
  type RuleId,
  type SpendSettings,
  type TimingSource,
} from '@hachi/core';
import { NotFoundError, recordContactRequest, recordDetections, recordLonelinessNotice, type CallRecord, type Store } from '@hachi/store';
import { analyse } from './analysis.js';
import { ReviewError, type CallReviewer, type ModelReview } from './model.js';
import { measureRecording, type RecordingSource, type SpeechListener } from './voice.js';

export interface WorkerDeps {
  store: Store;
  reviewer: CallReviewer;
  /** Both are needed to measure speech from the recording; without them R3 uses text features only. */
  recordings?: RecordingSource;
  listener?: SpeechListener;
  /** This service's own queue, used by the sweep. */
  queue: TaskQueue;
  /** Notification worker queue; without it the notifier's sweep picks the entries up. */
  notifications?: TaskQueue;
  now: () => Date;
  newId: () => string;
  config: { leaseSec: number; settleSec: number; modelAttempts: number; staffLocale: Locale; appBaseUrl: string; spend: SpendSettings };
}

export interface CallRef {
  residentId: string;
  callId: string;
}

/** Records what one Gemini request cost. Failing to record it must not fail the analysis. */
async function chargeTokens(deps: WorkerDeps, tokens: { in: number; out: number }): Promise<void> {
  const now = deps.now();
  const micros = analysisMicros(tokens.in, tokens.out, deps.config.spend.prices);
  try {
    await deps.store.mutateSpendLedger(spendMonth(now), (l) => charge(l, micros, now));
  } catch {
    // The month's total will be short by one request; the call itself is more important.
  }
}

export type AnalyzeOutcome =
  | { outcome: 'analyzed'; rules: RuleId[]; model: boolean }
  /** Nothing to do (already analysed, or the resident no longer exists). */
  | { outcome: 'done' }
  | { outcome: 'not_found' }
  /** Another worker holds the call. */
  | { outcome: 'busy' }
  /** The stream may still reconnect, or the model failed in a retryable way; Cloud Tasks retries. */
  | { outcome: 'retry'; reason: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseAnalyzeInput(body: unknown): CallRef | null {
  const b = body as { residentId?: unknown; callId?: unknown } | null;
  if (typeof b?.residentId !== 'string' || typeof b.callId !== 'string') return null;
  return ID.test(b.residentId) && ID.test(b.callId) ? { residentId: b.residentId, callId: b.callId } : null;
}

const leaseActive = (c: CallRecord, nowIso: string) => !!c.analysisLease && c.analysisLease > nowIso;

/** A redelivered task, or a second pass after a reconnect, must not add the same evidence twice. */
async function withoutRepeats(store: Store, call: CallRecord, detections: Detection[]): Promise<Detection[]> {
  if (!detections.length) return detections;
  const cases = await store.listCasesByResident(call.residentId);
  return detections.filter(
    (d) => !cases.some((c) => c.rule === d.rule && c.status !== 'closed' && c.detections.some((x) => x.evidence.some((e) => e.callId === call.id))),
  );
}

/**
 * QUE-02, FAM-03, DET-01..04, SPK-01..04, CNV-07: analyses one finished call. `attempt` is the
 * Cloud Tasks retry count; after `modelAttempts` the rule-based checks run without the model so
 * an outage never blocks R1/R2 detection.
 */
export async function analyzeCall(deps: WorkerDeps, ref: CallRef, attempt = 0): Promise<AnalyzeOutcome> {
  const { store, config } = deps;
  const now = deps.now();
  const nowIso = now.toISOString();

  const found = await store.getCall(ref.residentId, ref.callId);
  if (!found) return { outcome: 'not_found' };
  if (!found.analysisPending) return { outcome: 'done' };
  if (found.conversation && now.getTime() - Date.parse(found.conversation.at) < config.settleSec * 1000) {
    return { outcome: 'retry', reason: 'settling' };
  }

  let claimed = false;
  const call = await store.updateCall(ref.residentId, ref.callId, (c) => {
    if (!c.analysisPending || leaseActive(c, nowIso)) return null;
    claimed = true;
    return { ...c, analysisLease: new Date(now.getTime() + config.leaseSec * 1000).toISOString() };
  });
  if (!claimed) return call.analysisPending ? { outcome: 'busy' } : { outcome: 'done' };

  const release = (patch: Partial<CallRecord>, analysedTurns?: number) =>
    store.updateCall(ref.residentId, ref.callId, (c) => {
      const { analysisLease: _lease, ...rest } = c;
      const pending = analysedTurns === undefined ? c.analysisPending : (c.transcript?.length ?? 0) > analysedTurns;
      return { ...rest, ...patch, analysisPending: pending };
    });

  try {
    const resident = await store.getResident(ref.residentId);
    if (!resident) {
      await release({}, Number.MAX_SAFE_INTEGER);
      return { outcome: 'done' };
    }
    const transcript = call.transcript ?? [];

    const spoke = transcript.some((t) => t.speaker === 'resident');
    const { recordings, listener } = deps;
    const audioUri = call.source !== 'imported' && spoke && recordings && listener ? call.audioUri : undefined;
    let stored = false;
    const [reviewed, measured] = await Promise.allSettled([
      spoke
        ? deps.reviewer.review({
            preferredName: resident.preferredName,
            transcript,
            staffLocale: config.staffLocale,
            // A call staff asked for does not ask the set questions (issue #13), so there are no
            // answers in it to look for, and none the model should think it found.
            items:
              call.trigger === 'staff'
                ? []
                : itemsForCall(resident.serviceStartedAt.slice(0, 10), call.localDate ?? localDate(new Date(call.startedAt), resident.timeZone)),
            // Charged, not reserved. The call has already happened; reviewing it is not something
            // the budget is allowed to refuse, only something it has to know about.
            onUsage: (t) => void chargeTokens(deps, t),
          })
        : Promise.resolve(null),
      audioUri
        ? recordings!.read(audioUri).then((wav) => {
            stored = true;
            // Listening is a second Gemini request, with a minute of audio as its prompt. Left
            // uncharged it was the largest thing the ledger could not see in normal operation.
            return measureRecording(wav, transcript, listener!, (t) => void chargeTokens(deps, t));
          })
        : Promise.resolve(null),
    ]);
    const message = (err: unknown) => (err as Error)?.message ?? String(err);
    const modelError = reviewed.status === 'rejected' ? message(reviewed.reason) : undefined;
    const voiceError = measured.status === 'rejected' ? message(measured.reason) : undefined;
    const retryReview = reviewed.status === 'rejected' && (reviewed.reason instanceof ReviewError ? reviewed.reason.retryable : true);
    // Storage hiccups and model outages are worth retrying; an unreadable file is not.
    const retryVoice = measured.status === 'rejected' && (!stored || (measured.reason instanceof ReviewError && measured.reason.retryable));
    if ((retryReview || retryVoice) && attempt + 1 < config.modelAttempts) {
      await release({});
      return { outcome: 'retry', reason: (retryReview ? modelError : voiceError)! };
    }
    const review: ModelReview | null = reviewed.status === 'fulfilled' ? reviewed.value : null;
    const voice = measured.status === 'fulfilled' ? measured.value : null;
    const timing: TimingSource = call.source === 'imported' ? 'transcript' : (voice ?? 'unavailable');
    const audioQuality = voice?.audioQuality ?? undefined;

    const history = (await store.listCalls(ref.residentId, { limit: HISTORY_CALLS })).filter((c) => c.id !== call.id);
    const result = analyse({
      resident,
      call,
      transcript,
      history,
      review,
      timing,
      ...(audioQuality !== undefined ? { audioQuality } : {}),
      model: deps.reviewer.model,
      ...(modelError ? { modelError } : {}),
      ...(voiceError ? { voiceError } : {}),
      now,
    });

    const detections = await withoutRepeats(store, call, result.detections);
    if (detections.length) {
      const { outbox } = await recordDetections(store, resident, detections, {
        now,
        newId: deps.newId,
        appBaseUrl: config.appBaseUrl,
        locale: 'en',
      });
      if (deps.notifications && outbox.length) {
        await requestDelivery(
          deps.notifications,
          outbox.map((e) => e.id),
        );
      }
    }

    // Imported history is a record of calls that already happened; nobody is waiting on it.
    if (call.source !== 'imported') {
      const queued: string[] = [];
      const request = result.update.analysis.contactRequest;
      if (request) {
        const entry = await recordContactRequest(store, resident, call.id, request, now);
        if (entry?.status === 'pending') queued.push(entry.id);
      }
      const notices = await recordLonelinessNotice(store, resident, [{ ...call, ...result.update }, ...history], {
        asOf: result.update.analysis.intake.date,
        now,
        appBaseUrl: config.appBaseUrl,
      });
      queued.push(...notices.map((e) => e.id));
      if (deps.notifications && queued.length) await requestDelivery(deps.notifications, queued);
    }

    await release(result.update, transcript.length);
    return { outcome: 'analyzed', rules: detections.map((d) => d.rule), model: review !== null };
  } catch (err) {
    // Hand the call back so the retried task can claim it straight away.
    await release({}).catch(() => undefined);
    if (err instanceof NotFoundError) return { outcome: 'not_found' };
    throw err;
  }
}

export interface SweepResult {
  queued: number;
  errors: string[];
}

/** Safety net (Cloud Scheduler): queues finished calls whose analysis task was lost. */
export async function sweep(deps: WorkerDeps, opts: { minAgeSec?: number; limit?: number } = {}): Promise<SweepResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const cutoff = now.getTime() - (opts.minAgeSec ?? deps.config.settleSec + 300) * 1000;
  const limit = opts.limit ?? 100;
  const key = `sweep-${nowIso.slice(0, 13).replace(/\D/g, '')}`;

  const due: CallRecord[] = [];
  for (const r of await deps.store.listActiveResidents()) {
    if (due.length >= limit) break;
    for (const c of await deps.store.listCalls(r.id, { limit: 50 })) {
      const endedAt = c.conversation?.at ?? c.endedAt ?? c.createdAt;
      if (c.analysisPending && !leaseActive(c, nowIso) && Date.parse(endedAt) <= cutoff) due.push(c);
    }
  }
  const batch = due.slice(0, limit);
  const results = await Promise.allSettled(batch.map((c) => deps.queue.enqueue(analysisTask(c.residentId, c.id, key))));
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [`${batch[i]!.id}: ${(r.reason as Error)?.message ?? r.reason}`] : []));
  return { queued: batch.length - errors.length, errors };
}
