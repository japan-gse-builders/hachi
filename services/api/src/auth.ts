import type { Auth } from 'firebase-admin/auth';
import type { Organization, OrgRole } from '@hachi/store';

export interface VerifiedToken {
  uid: string;
  phoneNumber?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  /** When the person last signed in, in seconds; refreshing a token does not change it. */
  authTime?: number;
}

export interface TokenVerifier {
  /** Throws when the token is invalid or expired. */
  verify(idToken: string): Promise<VerifiedToken>;
}

/** Who Firebase says signed in. On its own it grants nothing: staff need a membership, family a verified contact. */
export interface Identity {
  uid: string;
  /** Normalized. */
  email?: string;
  emailVerified: boolean;
  /** Normalized. */
  phoneNumber?: string;
  name?: string;
  /** Milliseconds. */
  authTime?: number;
}

export interface StaffPrincipal {
  kind: 'staff';
  uid: string;
  /** Verified and normalized. */
  email: string;
  name?: string;
  orgId: string;
  role: OrgRole;
  org: Organization;
}

export interface FamilyPrincipal {
  kind: 'family';
  uid: string;
  contacts: string[];
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toIdentity(t: VerifiedToken): Identity {
  return {
    uid: t.uid,
    emailVerified: t.emailVerified === true,
    ...(t.email ? { email: normalizeEmail(t.email) } : {}),
    ...(t.phoneNumber ? { phoneNumber: normalizePhone(t.phoneNumber) } : {}),
    ...(t.name ? { name: t.name } : {}),
    ...(t.authTime !== undefined ? { authTime: t.authTime * 1000 } : {}),
  };
}

/**
 * The contacts Firebase has verified, which is all a family account is known by (FAM-01): which
 * residents it may see is decided per request by matching them against `familyLookup`.
 */
export function familyContacts(id: Identity): string[] {
  return [id.phoneNumber, id.emailVerified ? id.email : undefined].filter((c): c is string => Boolean(c));
}

/** The account management Firebase does for us. Optional so that tests and the local preview need no Firebase. */
export interface AuthAdmin {
  setDisplayName(uid: string, name: string): Promise<void>;
  /** Revokes refresh tokens, so no device can get a new ID token without signing in again. */
  revokeSessions(uid: string): Promise<void>;
  /** Epoch ms before which Firebase considers the account's sign-ins revoked (revocation, password change). */
  sessionsValidAfter(uid: string): Promise<number | undefined>;
}

export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: Auth) {}

  async verify(idToken: string): Promise<VerifiedToken> {
    const d = await this.auth.verifyIdToken(idToken);
    return {
      uid: d.uid,
      phoneNumber: d.phone_number,
      email: d.email,
      emailVerified: d.email_verified,
      name: typeof d.name === 'string' ? d.name : undefined,
      authTime: d.auth_time,
    };
  }
}

export class FirebaseAuthAdmin implements AuthAdmin {
  constructor(private readonly auth: Auth) {}

  async setDisplayName(uid: string, name: string): Promise<void> {
    await this.auth.updateUser(uid, { displayName: name });
  }

  async revokeSessions(uid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(uid);
  }

  async sessionsValidAfter(uid: string): Promise<number | undefined> {
    const after = (await this.auth.getUser(uid)).tokensValidAfterTime;
    return after ? Date.parse(after) : undefined;
  }
}
