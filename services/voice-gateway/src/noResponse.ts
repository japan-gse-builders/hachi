import { requestDelivery, type TaskQueue } from '@hachi/cloud';
import { exhaustedPromptDetection, type NoResponseKind } from '@hachi/core';
import { recordDetections, type Resident, type Store } from '@hachi/store';

export interface NoResponseInput { resident: Resident; kind: NoResponseKind; at: string }
export interface NoResponseReporter { flag(input: NoResponseInput): Promise<string> }

/** Flag the unanswered checks immediately. Regular R1 notifications apply; no emergency bridge
 * or symptom quote is invented. The call's recording and recorded ending explain the observation. */
export class NoResponseService implements NoResponseReporter {
  constructor(private readonly deps: { store: Store; appBaseUrl: string; newId: () => string; notifications?: TaskQueue }) {}

  async flag(input: NoResponseInput): Promise<string> {
    const { store, appBaseUrl, newId, notifications } = this.deps;
    const { changes, outbox } = await recordDetections(store, input.resident,
      [exhaustedPromptDetection(input.resident.id, input.kind, input.at)],
      { now: new Date(input.at), appBaseUrl, newId, locale: 'en' });
    const caseId = changes[0]!.caseId;
    if (notifications) {
      const pending = outbox.length ? outbox : (await store.listOutboxByCase(caseId)).filter((e) => e.status === 'pending');
      await requestDelivery(notifications, pending.map((e) => e.id));
    }
    return caseId;
  }
}
