import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { authReady, useAuth } from './auth';
import { CasePage } from './pages/CasePage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';

function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  return (
    <div className="app">
      <header className="top">
        <Link className="brand" to="/">Hachi</Link>
        {user && (
          <nav className="nav">
            <Link to="/">Queue</Link>
            <Link to="/residents">Residents</Link>
            <button className="ghost" type="button" onClick={() => void signOut()}>Sign out</button>
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  if (!authReady) {
    return (
      <div className="app">
        <p className="error">Sign-in is not configured. Set the VITE_FIREBASE_* values and restart.</p>
      </div>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Guard><QueuePage /></Guard>} />
        <Route path="/cases/:id" element={<Guard><CasePage /></Guard>} />
        <Route path="/residents" element={<Guard><ResidentsPage /></Guard>} />
        <Route path="/residents/new" element={<Guard><ResidentPage /></Guard>} />
      </Routes>
    </Shell>
  );
}
