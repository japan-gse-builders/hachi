import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
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
  sendFamilyLink: (email: string) => Promise<void>;
  isFamilyLink: (href: string) => boolean;
  storedLinkEmail: () => string | null;
  finishFamilyLink: (email: string, href: string) => Promise<void>;
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
    sendFamilyLink: async (email) => {
      await sendSignInLinkToEmail(requireAuth(), email, { url: `${window.location.origin}/family/finish`, handleCodeInApp: true });
      window.localStorage.setItem(LINK_EMAIL_KEY, email);
    },
    isFamilyLink: (href) => Boolean(auth && isSignInWithEmailLink(auth, href)),
    storedLinkEmail: () => window.localStorage.getItem(LINK_EMAIL_KEY),
    finishFamilyLink: async (email, href) => {
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
