import type { Readable } from 'node:stream';
import type { Storage } from 'firebase-admin/storage';

export interface MediaReader {
  /** Opens a recording from private storage. No storage URL is returned to the browser. */
  open(gsUri: string): Promise<Readable>;
}

export class GcsMediaReader implements MediaReader {
  constructor(private readonly storage: Pick<Storage, 'bucket'>, private readonly allowedBucket: string) {}

  async open(gsUri: string): Promise<Readable> {
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri);
    if (!match) throw new Error('Invalid gs:// recording reference');
    if (match[1] !== this.allowedBucket) throw new Error('Recording is outside the configured recordings bucket');
    const bucket = this.storage.bucket(this.allowedBucket);
    const name = match[2]!;
    const [metadata] = await bucket.file(name).getMetadata();
    return bucket.file(name, { generation: metadata.generation }).createReadStream();
  }
}
