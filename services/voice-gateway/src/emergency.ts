import { requestDelivery, type TaskQueue } from '@hachi/cloud';
import type { Detection, R1Category } from '@hachi/core';
import { recordDetections, type Resident, type Store } from '@hachi/store';

export const EMERGENCY_TRANSFER_PATH = '/tasks/emergency-transfer';

export interface EmergencyInput {
  resident: Resident;
  callId: string;
  quote: string;
  /** From the in-call R1 monitor, or `reported_by_agent` when Gemini called report_emergency. */
  category: R1Category | 'reported_by_agent';
  confidence: number;
  startMs?: number;
  endMs?: number;
  /** Gemini's description when it reported the emergency. */
  symptom?: string;
}

export interface EmergencyRaiser {
  raise(input: EmergencyInput): Promise<void>;
}

const SUMMARY: Record<R1Category, string> = {
  chest_pain: 'Reported chest pain or pressure during the call',
  breathing: 'Reported trouble breathing during the call',
  unable_to_move: 'Reported being unable to move or get up during the call',
  stroke_signs: 'Described possible stroke signs during the call',
  loss_of_consciousness: 'Reported fainting or nearly losing consciousness during the call',
  severe_bleeding: 'Reported heavy bleeding during the call',
  fear_of_dying: 'Said they feel they might be dying during the call',
  calling_for_help: 'Asked for help during the call',
  sudden_headache: 'Described a sudden or worst-ever headache during the call',
  vision_loss: 'Reported losing their sight or seeing double during the call',
  balance_loss: 'Reported suddenly losing their balance during the call',
};

export function emergencySummary(input: Pick<EmergencyInput, 'category' | 'symptom'>): string {
  if (input.category !== 'reported_by_agent') return SUMMARY[input.category];
  const symptom = input.symptom?.trim().slice(0, 80);
  return symptom ? `Reported a possible emergency during the call (${symptom})` : 'Reported a possible emergency during the call';
}

/**
 * DET-01 / NTF-01: records the R1 emergency case, queues SMS/email/push to staff and family, and
 * asks the telephony service to phone them and bridge the call. Every step is idempotent.
 */
export class EmergencyService implements EmergencyRaiser {
  constructor(
    private readonly deps: {
      store: Store;
      queue: TaskQueue;
      /** Notification worker queue; without it the worker's sweep sends within about two minutes. */
      notifications?: TaskQueue;
      appBaseUrl: string;
      now: () => Date;
      newId: () => string;
    },
  ) {}

  async raise(i: EmergencyInput): Promise<void> {
    const { store, queue, now, newId, appBaseUrl } = this.deps;
    const at = now().toISOString();
    const detection: Detection = {
      residentId: i.resident.id,
      rule: 'R1',
      urgency: 'emergency',
      confidence: i.confidence,
      summary: emergencySummary(i),
      evidence: [{ callId: i.callId, quote: i.quote, ...(i.startMs !== undefined ? { startMs: i.startMs } : {}), ...(i.endMs !== undefined ? { endMs: i.endMs } : {}) }],
      detectedAt: at,
    };
    const { changes, outbox } = await recordDetections(store, i.resident, [detection], {
      now: now(),
      newId,
      appBaseUrl,
      locale: 'en',
      // The bridge itself phones family and staff.
      skipChannels: ['voice'],
    });
    const caseId = changes[0]!.caseId;
    await store.updateCall(i.resident.id, i.callId, (c) => (c.emergency ? null : { ...c, emergency: { at, caseId, quote: i.quote } }));
    await queue.enqueue({
      name: `emergency-${i.resident.id}-${i.callId}`,
      path: EMERGENCY_TRANSFER_PATH,
      body: { residentId: i.resident.id, callId: i.callId },
    });
    if (this.deps.notifications) {
      // A retried raise creates no new entries, so queue whatever is still pending for the case.
      const pending = outbox.length ? outbox : (await store.listOutboxByCase(caseId)).filter((e) => e.status === 'pending');
      await requestDelivery(this.deps.notifications, pending.map((e) => e.id));
    }
  }
}
