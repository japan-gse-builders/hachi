import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ORG_UNAVAILABLE_EVENT, SESSION_REVOKED_EVENT, setActiveOrg } from './api';
import { useStaffSession } from './auth';
import { chooseOrg, orgStorageKey, usableMemberships, type Me, type MembershipSummary } from './orgs';

interface AccountState {
  me: Me | null;
  loading: boolean;
  error: string;
  /** The organization staff pages act for; null until the account belongs to one it can use. */
  current: MembershipSummary | null;
  /** Organizations the account can switch between. */
  usable: MembershipSummary[];
  switchOrg: (orgId: string) => void;
  /**
   * Reloads `/api/me`; resolves to it, or null when it could not be loaded. Stays on the
   * organization this tab is using unless `prefer` names another, e.g. one just joined.
   */
  refresh: (prefer?: string) => Promise<Me | null>;
}

const Ctx = createContext<AccountState | null>(null);

/**
 * Who the signed-in staff account is to Hachi: its organizations, the one it is acting for, and
 * the invitations waiting for it. Staff pages render only once this has loaded, so every request
 * they make already carries the organization.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, token, signOut } = useStaffSession();
  const uid = user?.uid ?? null;
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState<MembershipSummary | null>(null);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  // What this tab acts for. localStorage is shared with other tabs, which may have switched.
  const acting = useRef<string | null>(null);

  const refresh = useCallback(async (prefer?: string): Promise<Me | null> => {
    if (!uid) return null;
    try {
      const next = await api<Me>('/api/me', await token());
      const chosen = chooseOrg(next.memberships, prefer, acting.current, window.localStorage.getItem(orgStorageKey(uid)));
      if (prefer && chosen?.orgId === prefer) window.localStorage.setItem(orgStorageKey(uid), prefer);
      // Before the state change, so pages that mount on it already send the right header.
      setActiveOrg(chosen?.orgId ?? null);
      acting.current = chosen?.orgId ?? null;
      loaded.current = true;
      setMe(next);
      setCurrent(chosen);
      setError('');
      return next;
    } catch (err) {
      // A page already showing keeps showing; only a first load that fails has nothing else to show.
      if (!loaded.current) setError(err instanceof Error ? err.message : 'Could not load your account');
      return null;
    }
  }, [uid, token]);

  useEffect(() => {
    loaded.current = false;
    acting.current = null;
    setMe(null);
    setCurrent(null);
    setError('');
    setActiveOrg(null);
    if (uid) void refresh();
  }, [uid, refresh]);

  // Signed out everywhere from another device: this one follows as soon as the API refuses it.
  useEffect(() => {
    const onRevoked = () => void signOut();
    window.addEventListener(SESSION_REVOKED_EVENT, onRevoked);
    return () => window.removeEventListener(SESSION_REVOKED_EVENT, onRevoked);
  }, [signOut]);

  // Removed, turned off or suspended while working: reload, which moves on to another
  // organization or to the welcome page that explains what happened.
  useEffect(() => {
    const onUnavailable = () => void refresh();
    window.addEventListener(ORG_UNAVAILABLE_EVENT, onUnavailable);
    return () => window.removeEventListener(ORG_UNAVAILABLE_EVENT, onUnavailable);
  }, [refresh]);

  const switchOrg = useCallback(
    (orgId: string) => {
      const next = me ? usableMemberships(me.memberships).find((m) => m.orgId === orgId) : undefined;
      if (!next || !uid) return;
      window.localStorage.setItem(orgStorageKey(uid), orgId);
      setActiveOrg(orgId);
      acting.current = orgId;
      setCurrent(next);
    },
    [me, uid],
  );

  const value = useMemo<AccountState>(
    () => ({
      me,
      // Only the first load: refreshing afterwards must not unmount the page that asked for it.
      loading: Boolean(uid) && !me && !error,
      error,
      current,
      usable: me ? usableMemberships(me.memberships) : [],
      switchOrg,
      refresh,
    }),
    [me, uid, error, current, switchOrg, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountState {
  const value = useContext(Ctx);
  if (!value) throw new Error('AccountProvider is missing');
  return value;
}
