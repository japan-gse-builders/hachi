import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateCurrentUser,
  type Auth,
  type User,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { sectionOf } from './signin';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || undefined,
  appId: (env.VITE_FIREBASE_APP_ID as string | undefined) || undefined,
};

export const authReady = Boolean(config.apiKey && config.authDomain && config.projectId);
export const firebaseApp: FirebaseApp | null = authReady ? initializeApp(config) : null;

export type Role = 'staff' | 'family';
const ROLES: Role[] = ['staff', 'family'];

/**
 * Firebase keeps one signed-in user per app, so staff and family each get their own named app.
 * One browser can then hold a staff and a family session at once, and signing in on one side
 * never signs the other out. Staff pages use the staff session and family pages the family one.
 */
const auths: Record<Role, Auth> | null = authReady
  ? { staff: getAuth(initializeApp(config, 'staff')), family: getAuth(initializeApp(config, 'family')) }
  : null;

/** The email is kept on this device so the link can be completed without asking again. */
const LINK_EMAIL_KEY = 'hachi.signInEmail';

/** Sessions from before the split lived on the default app; move each to its role's side once. */
let migration: Promise<void> | undefined;
function migrateSharedSession(): Promise<void> {
  migration ??= (async () => {
    if (!firebaseApp || !auths) return;
    const shared = getAuth(firebaseApp);
    await shared.authStateReady();
    const user = shared.currentUser;
    if (!user) return;
    const claims = await user.getIdTokenResult().then((t) => t.claims).catch(() => null);
    const target = auths[claims?.role === 'staff' ? 'staff' : 'family'];
    await target.authStateReady();
    if (!target.currentUser) await updateCurrentUser(target, user);
    await signOut(shared);
  })().catch(() => undefined);
  return migration;
}

interface Session {
  user: User | null;
  role: Role | null;
  ready: boolean;
  token: () => Promise<string>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendSignInLink: (email: string) => Promise<void>;
  confirmEmail: () => Promise<void>;
  isSignInLink: (href: string) => boolean;
  storedLinkEmail: () => string | null;
  finishSignInLink: (email: string, href: string) => Promise<void>;
  signOut: () => Promise<void>;
}

interface SideState {
  user: User | null;
  role: Role | null;
  ready: boolean;
}

const Ctx = createContext<Record<Role, SideState> | null>(null);

function requireAuth(side: Role) {
  if (!auths) throw new Error('Sign-in is not configured');
  return auths[side];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial: SideState = { user: null, role: null, ready: !auths };
  const [sides, setSides] = useState<Record<Role, SideState>>({ staff: initial, family: initial });
  useEffect(() => {
    if (!auths) return;
    let stopped = false;
    let unsubscribe: (() => void)[] = [];
    void migrateSharedSession().then(() => {
      if (stopped) return;
      unsubscribe = ROLES.map((side) =>
        onAuthStateChanged(auths[side], (next) => {
          const settle = (role: Role | null) => setSides((prev) => ({ ...prev, [side]: { user: next, role, ready: true } }));
          if (!next) return settle(null);
          void next
            .getIdTokenResult()
            .then((t) => settle(t.claims.role === 'staff' ? 'staff' : 'family'))
            .catch(() => settle('family'));
        }),
      );
    });
    return () => {
      stopped = true;
      unsubscribe.forEach((stop) => stop());
    };
  }, []);
  return <Ctx.Provider value={sides}>{children}</Ctx.Provider>;
}

/** The session for the page being shown; pages outside both sections use whichever is signed in. */
export function useAuth(): Session {
  const sides = useContext(Ctx);
  const { pathname } = useLocation();
  if (!sides) throw new Error('AuthProvider is missing');
  const side = sectionOf(pathname) ?? (sides.staff.user ? 'staff' : 'family');
  const { user, role } = sides[side];
  return {
    user,
    role,
    ready: sides.staff.ready && sides.family.ready,
    token: async () => {
      if (!user) throw new Error('Sign in first');
      return user.getIdToken();
    },
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(requireAuth(side), email, password);
    },
    signInWithGoogle: async () => {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(requireAuth(side), provider);
      } catch (err) {
        // An installed PWA and some in-app browsers block popups; the redirect lands back here.
        const code = (err as { code?: string }).code;
        if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') throw err;
        await signInWithRedirect(requireAuth(side), provider);
      }
    },
    sendPasswordReset: async (email) => {
      await sendPasswordResetEmail(requireAuth(side), email);
    },
    sendSignInLink: async (email) => {
      // The link has to come back to the same side, or it would sign in on the other one.
      await sendSignInLinkToEmail(requireAuth(side), email, { url: `${window.location.origin}/${side}/finish`, handleCodeInApp: true });
      window.localStorage.setItem(LINK_EMAIL_KEY, email);
    },
    // Firebase drops an account's password the moment a sign-in link is used, so confirming an
    // address has to go through verification instead of the link we already have to hand.
    confirmEmail: async () => {
      const current = requireAuth(side).currentUser;
      if (!current) throw new Error('Sign in first');
      await sendEmailVerification(current, { url: `${window.location.origin}/family` });
    },
    isSignInLink: (href) => Boolean(auths && isSignInWithEmailLink(auths[side], href)),
    storedLinkEmail: () => window.localStorage.getItem(LINK_EMAIL_KEY),
    finishSignInLink: async (email, href) => {
      await signInWithEmailLink(requireAuth(side), email, href);
      window.localStorage.removeItem(LINK_EMAIL_KEY);
    },
    signOut: async () => {
      if (auths) await signOut(auths[side]);
    },
  };
}
