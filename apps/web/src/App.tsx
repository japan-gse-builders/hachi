import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { authReady, useAuth, type Role } from './auth';
import { CasePage } from './pages/CasePage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage';
import { FamilyFinishPage } from './pages/FamilyFinishPage';
import { FamilyHomePage } from './pages/FamilyHomePage';
import { FamilyLoginPage } from './pages/FamilyLoginPage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { PrivacyPage } from './pages/PrivacyPage';

function Shell({ children }: { children: ReactNode }) {
  const { user, role, signOut } = useAuth();
  return (
    <div className="app">
      <header className="top">
        <Link className="brand" to="/">
          <img src="/branding/hachi-logo.png" alt="Hachi" width={1991} height={790} />
        </Link>
        {user && (
          <nav className="nav">
            {role === 'staff' && (
              <>
                <Link to="/staff">Queue</Link>
                <Link to="/staff/residents">Residents</Link>
              </>
            )}
            <button className="ghost" type="button" onClick={() => void signOut()}>Sign out</button>
          </nav>
        )}
      </header>
      {children}
      <footer className="footer"><Link to="/privacy">Privacy and support</Link></footer>
    </div>
  );
}

const LOGIN: Record<Role, string> = { staff: '/staff/login', family: '/family/login' };

function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { user, role: current, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <p>Loading…</p>;
  if (!user) return <Navigate to={LOGIN[role]} replace state={{ from: location.pathname }} />;
  if (current !== role) {
    return (
      <p className="card">
        {role === 'staff'
          ? 'This page is for the care team. Sign out and sign in with a staff account.'
          : 'You are signed in as care staff. Family pages are for family contacts.'}
      </p>
    );
  }
  return <>{children}</>;
}

function Home() {
  const { user, role, ready } = useAuth();
  if (!ready) return <p>Loading…</p>;
  if (!user) return <Navigate to="/family/login" replace />;
  return <Navigate to={role === 'staff' ? '/staff' : '/family'} replace />;
}

function OldCaseLink() {
  const { id = '' } = useParams();
  return <Navigate to={`/staff/cases/${id}`} replace />;
}

function AppRoutes() {
  if (!authReady) {
    return (
      <p className="error">Sign-in is not configured. Set the VITE_FIREBASE_* values and restart.</p>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/staff/login" element={<LoginPage />} />
      <Route path="/staff" element={<Guard role="staff"><QueuePage /></Guard>} />
      <Route path="/staff/cases/:id" element={<Guard role="staff"><CasePage /></Guard>} />
      <Route path="/staff/residents" element={<Guard role="staff"><ResidentsPage /></Guard>} />
      <Route path="/staff/residents/new" element={<Guard role="staff"><ResidentPage /></Guard>} />
      <Route path="/family/login" element={<FamilyLoginPage />} />
      <Route path="/family/finish" element={<FamilyFinishPage />} />
      <Route path="/family" element={<Guard role="family"><FamilyHomePage /></Guard>} />
      <Route path="/family/residents/:id" element={<Guard role="family"><FamilyDashboardPage /></Guard>} />
      <Route path="/login" element={<Navigate to="/staff/login" replace />} />
      <Route path="/cases/:id" element={<OldCaseLink />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<AppRoutes />} />
      </Routes>
    </Shell>
  );
}
