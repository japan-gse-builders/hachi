import type { CallRecord } from '@hachi/store';
import type { Storage } from 'firebase-admin/storage';
import type { RecordingDeletion } from './retention.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Catches unlinked uploads as well as referenced recordings and reconnect segments. */
export class GcsRecordingDeletion implements RecordingDeletion {
  constructor(private readonly storage: Pick<Storage, 'bucket'>, private readonly bucketName: string) {}

  async deleteCallRecordings(call: CallRecord): Promise<void> {
    const bucket = this.storage.bucket(this.bucketName);
    const streamPrefix = call.source === 'live' && ID.test(call.residentId) && ID.test(call.id)
      ? `recordings/${call.residentId}/${call.id}-s` : null;
    const isStream = (name: string) => !!streamPrefix && name.startsWith(streamPrefix) && /^\d+\.wav$/.test(name.slice(streamPrefix.length));
    const paths = new Set<string>();
    for (const uri of [call.audioUri, ...(call.extraAudioUris ?? [])]) {
      if (!uri) continue;
      const prefix = `gs://${this.bucketName}/`;
      if (!uri.startsWith(prefix) || uri.length === prefix.length) throw new Error('Recording is outside the configured recordings bucket');
      const name = uri.slice(prefix.length);
      if (!isStream(name)) paths.add(name);
    }
    if (streamPrefix) {
      const [versions] = await bucket.getFiles({ prefix: streamPrefix, versions: true });
      for (const file of versions) {
        if (isStream(file.name)) await file.delete({ ignoreNotFound: true });
      }
    }
    for (const path of paths) {
      const [versions] = await bucket.getFiles({ prefix: path, versions: true });
      for (const file of versions) {
        if (file.name === path) await file.delete({ ignoreNotFound: true });
      }
    }
  }
}
