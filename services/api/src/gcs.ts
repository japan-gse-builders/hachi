import type { Storage } from 'firebase-admin/storage';
import type { MediaSigner } from './views.js';

/**
 * V4 signed URLs for recordings. On Cloud Run the service account needs
 * roles/iam.serviceAccountTokenCreator on itself to sign without a key file.
 */
export class GcsMediaSigner implements MediaSigner {
  constructor(
    private readonly storage: Storage,
    private readonly allowedBucket: string,
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}

  async sign(gsUri: string): Promise<string> {
    const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri);
    if (!m) throw new Error(`Not a gs:// URI: ${gsUri}`);
    if (m[1] !== this.allowedBucket) throw new Error(`Refusing to sign outside ${this.allowedBucket}: ${gsUri}`);
    const [url] = await this.storage
      .bucket(m[1]!)
      .file(m[2]!)
      .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + this.ttlMs });
    return url;
  }
}
