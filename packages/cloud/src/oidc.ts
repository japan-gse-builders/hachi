import type { OAuth2Client } from 'google-auth-library';

export interface TaskCallerVerifier {
  /** Throws unless the bearer token is a Google-signed OIDC token from an allowed service account. */
  verify(authorization: string | undefined): Promise<void>;
}

export class GoogleOidcVerifier implements TaskCallerVerifier {
  private readonly allowed: Set<string>;

  constructor(
    private readonly client: Pick<OAuth2Client, 'verifyIdToken'>,
    private readonly audience: string,
    allowedEmails: string[],
  ) {
    this.allowed = new Set(allowedEmails.map((e) => e.toLowerCase()));
  }

  async verify(authorization: string | undefined): Promise<void> {
    if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');
    const ticket = await this.client.verifyIdToken({ idToken: authorization.slice(7), audience: this.audience });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified || !this.allowed.has(p.email.toLowerCase())) {
      throw new Error('Caller is not allowed');
    }
  }
}
