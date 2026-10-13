import type { Auth } from 'firebase-admin/auth';

export interface VerifiedToken {
  uid: string;
  role?: unknown;
  phoneNumber?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export interface TokenVerifier {
  /** Throws when the token is invalid or expired. */
  verify(idToken: string): Promise<VerifiedToken>;
}

export type Principal =
  | { kind: 'staff'; uid: string; email?: string; name?: string }
  | { kind: 'family'; uid: string; contacts: string[] };

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Staff are identified by the `role: "staff"` custom claim (set by an admin script).
 * Anyone else may act as family, but only through contacts Firebase has verified (FAM-01);
 * which residents they can see is decided per request by matching those contacts.
 */
export function toPrincipal(t: VerifiedToken): Principal | null {
  if (t.role === 'staff') {
    return { kind: 'staff', uid: t.uid, ...(t.email ? { email: normalizeEmail(t.email) } : {}), ...(t.name ? { name: t.name } : {}) };
  }
  const contacts: string[] = [];
  if (t.phoneNumber) contacts.push(normalizePhone(t.phoneNumber));
  if (t.email && t.emailVerified) contacts.push(normalizeEmail(t.email));
  return contacts.length ? { kind: 'family', uid: t.uid, contacts } : null;
}

export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: Auth) {}

  async verify(idToken: string): Promise<VerifiedToken> {
    const d = await this.auth.verifyIdToken(idToken);
    return {
      uid: d.uid,
      role: d.role,
      phoneNumber: d.phone_number,
      email: d.email,
      emailVerified: d.email_verified,
      name: typeof d.name === 'string' ? d.name : undefined,
    };
  }
}
