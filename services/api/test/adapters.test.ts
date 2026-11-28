import { Readable } from 'node:stream';
import type { Auth } from 'firebase-admin/auth';
import type { Storage } from 'firebase-admin/storage';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseAuthAdmin, FirebaseTokenVerifier } from '../src/auth.js';
import { GcsMediaReader } from '../src/gcs.js';

describe('FirebaseTokenVerifier', () => {
  it('maps decoded Firebase claims', async () => {
    const auth = {
      verifyIdToken: vi.fn(async () => ({
        uid: 'u1',
        role: 'staff',
        phone_number: '+819000000002',
        email: 'a@x.org',
        email_verified: true,
        name: 'Ann',
        auth_time: 1_790_000_000,
      })),
    } as unknown as Auth;
    // The legacy role claim is ignored: being staff is having a membership.
    await expect(new FirebaseTokenVerifier(auth).verify('tok')).resolves.toEqual({
      uid: 'u1',
      phoneNumber: '+819000000002',
      email: 'a@x.org',
      emailVerified: true,
      name: 'Ann',
      authTime: 1_790_000_000,
    });
  });

  it('updates display names and revokes sessions through Firebase Auth', async () => {
    const updateUser = vi.fn(async () => ({}));
    const revokeRefreshTokens = vi.fn(async () => undefined);
    const admin = new FirebaseAuthAdmin({ updateUser, revokeRefreshTokens } as unknown as Auth);
    await admin.setDisplayName('u1', 'Ann');
    await admin.revokeSessions('u1');
    expect(updateUser).toHaveBeenCalledWith('u1', { displayName: 'Ann' });
    expect(revokeRefreshTokens).toHaveBeenCalledWith('u1');
  });

  it('propagates verification failures', async () => {
    const auth = { verifyIdToken: vi.fn(async () => Promise.reject(new Error('expired'))) } as unknown as Auth;
    await expect(new FirebaseTokenVerifier(auth).verify('tok')).rejects.toThrow('expired');
  });
});

describe('GcsMediaReader', () => {
  it('streams the exact generation read from the configured bucket', async () => {
    const recording = Readable.from(['fictional audio']);
    const getMetadata = vi.fn(async () => [{ generation: '1234567890000001' }]);
    const createReadStream = vi.fn(() => recording);
    const file = vi.fn(() => ({ getMetadata, createReadStream }));
    const bucket = vi.fn(() => ({ file }));
    const reader = new GcsMediaReader({ bucket } as unknown as Storage, 'hachi-audio');
    await expect(reader.open('gs://hachi-audio/res-1/call-1.wav')).resolves.toBe(recording);
    expect(bucket).toHaveBeenCalledWith('hachi-audio');
    expect(file).toHaveBeenCalledWith('res-1/call-1.wav');
    expect(file).toHaveBeenCalledWith('res-1/call-1.wav', { generation: '1234567890000001' });
    expect(createReadStream).toHaveBeenCalledOnce();
  });

  it('rejects non-gs URIs', async () => {
    const reader = new GcsMediaReader({} as Storage, 'hachi-audio');
    await expect(reader.open('https://example.org/x.wav')).rejects.toThrow(/Invalid gs/);
  });

  it('refuses to read objects in other buckets', async () => {
    const bucket = vi.fn();
    const reader = new GcsMediaReader({ bucket } as unknown as Storage, 'hachi-audio');
    await expect(reader.open('gs://someone-else/secret.wav')).rejects.toThrow(/outside the configured/);
    expect(bucket).not.toHaveBeenCalled();
  });
});
