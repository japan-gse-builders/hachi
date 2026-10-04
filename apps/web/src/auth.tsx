import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
};

export const authReady = Boolean(config.apiKey && config.authDomain && config.projectId);
const auth = authReady ? getAuth(initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId })) : null;

interface Session {
  user: User | null;
  ready: boolean;
  token: () => Promise<string>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setReady(true);
    });
  }, []);
  const value: Session = {
    user,
    ready,
    token: async () => {
      if (!user) throw new Error('Sign in first');
      return user.getIdToken();
    },
    signIn: async (email, password) => {
      if (!auth) throw new Error('Sign-in is not configured');
      await signInWithEmailAndPassword(auth, email, password);
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
