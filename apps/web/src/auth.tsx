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
  type User,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
const auth = firebaseApp ? getAuth(firebaseApp) : null;

/** The email is kept on this device so the link can be completed without asking again. */
const LINK_EMAIL_KEY = 'hachi.signInEmail';

export type Role = 'staff' | 'family';

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

const Ctx = createContext<Session | null>(null);

function requireAuth() {
  if (!auth) throw new Error('Sign-in is not configured');
  return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(!auth);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      if (!next) {
        setUser(null);
        setRole(null);
        setReady(true);
        return;
      }
      void next
        .getIdTokenResult()
        .then((t) => setRole(t.claims.role === 'staff' ? 'staff' : 'family'))
        .catch(() => setRole('family'))
        .finally(() => {
          setUser(next);
          setReady(true);
        });
    });
  }, []);
  const value: Session = {
    user,
    role,
    ready,
    token: async () => {
      if (!user) throw new Error('Sign in first');
      return user.getIdToken();
    },
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(requireAuth(), email, password);
    },
    signInWithGoogle: async () => {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(requireAuth(), provider);
      } catch (err) {
        // An installed PWA and some in-app browsers block popups; the redirect lands back here.
        const code = (err as { code?: string }).code;
        if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') throw err;
        await signInWithRedirect(requireAuth(), provider);
      }
    },
    sendPasswordReset: async (email) => {
      await sendPasswordResetEmail(requireAuth(), email);
    },
    sendSignInLink: async (email) => {
      await sendSignInLinkToEmail(requireAuth(), email, { url: `${window.location.origin}/family/finish`, handleCodeInApp: true });
      window.localStorage.setItem(LINK_EMAIL_KEY, email);
    },
    // Firebase drops an account's password the moment a sign-in link is used, so confirming an
    // address has to go through verification instead of the link we already have to hand.
    confirmEmail: async () => {
      const current = requireAuth().currentUser;
      if (!current) throw new Error('Sign in first');
      await sendEmailVerification(current, { url: `${window.location.origin}/family` });
    },
    isSignInLink: (href) => Boolean(auth && isSignInWithEmailLink(auth, href)),
    storedLinkEmail: () => window.localStorage.getItem(LINK_EMAIL_KEY),
    finishSignInLink: async (email, href) => {
      await signInWithEmailLink(requireAuth(), email, href);
      window.localStorage.removeItem(LINK_EMAIL_KEY);
    },
    signOut: async () => {
      if (auth) await signOut(auth);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider is missing');
  return ctx;
}
