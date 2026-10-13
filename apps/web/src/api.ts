const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** The header that tells the API which organization a staff request acts for. */
export const ORG_HEADER = 'x-hachi-org';

/** Fired when the API says this device was signed out everywhere, so the app can sign out too. */
export const SESSION_REVOKED_EVENT = 'hachi:session-revoked';

/** Fired when the active organization can no longer be used: removed, access off, or suspended. */
export const ORG_UNAVAILABLE_EVENT = 'hachi:org-unavailable';
const UNAVAILABLE = new Set(['not_a_member', 'membership_disabled', 'organization_suspended']);

let activeOrg: string | null = null;

/** Set by the account provider; every staff request then acts for this organization. */
export function setActiveOrg(orgId: string | null): void {
  activeOrg = orgId;
}

export function getActiveOrg(): string | null {
  return activeOrg;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The parsed error body, for callers that act on more than the message. */
    readonly body: unknown = null,
  ) {
    super(message);
  }

  /** The API's stable code for what went wrong, when it gave one. */
  get reason(): string | undefined {
    return (this.body as { reason?: string } | null)?.reason;
  }
}

export async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  // Family pages act for nobody's organization; a caller may name one explicitly (leaving another).
  const acting = Boolean(activeOrg) && !path.startsWith('/api/family') && !headers.has(ORG_HEADER);
  if (acting) headers.set(ORG_HEADER, activeOrg!);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; reason?: string; issues?: { message: string }[] } | null;
    if (res.status === 401 && body?.reason === 'session_revoked') window.dispatchEvent(new Event(SESSION_REVOKED_EVENT));
    if (acting && res.status === 403 && body?.reason && UNAVAILABLE.has(body.reason)) window.dispatchEvent(new Event(ORG_UNAVAILABLE_EVENT));
    const detail = body?.issues?.map((i) => i.message).join(' ') || body?.error;
    throw new ApiError(detail || `Request failed (${res.status})`, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
