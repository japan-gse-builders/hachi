import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { authReady, useAuth, type Role } from './auth';
import { Loading } from './components/States';
import { CasePage } from './pages/CasePage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage';
import { FamilyFinishPage } from './pages/FamilyFinishPage';
import { FamilyHomePage } from './pages/FamilyHomePage';
import { FamilyLoginPage } from './pages/FamilyLoginPage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { ResidentDetailPage } from './pages/ResidentDetailPage';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { PrivacyPage } from './pages/PrivacyPage';

/** A case belongs to the queue it was opened from, so the queue stays marked while one is open. */
function NavItem({ to, label, section }: { to: string; label: string; section: (path: string) => boolean }) {
  const { pathname } = useLocation();
  const current = pathname === to ? 'page' : section(pathname) ? 'true' : undefined;
  return <Link to={to} aria-current={current}>{label}</Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, role, signOut } = useAuth();
  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="top">
        <Link className="brand" to="/">
          <img src="/branding/hachi-logo.png" alt="Hachi" width={1991} height={790} />
        </Link>
        {user && role === 'staff' && (
          <nav className="nav" aria-label="Staff">
            <NavItem to="/staff" label="Queue" section={(p) => p.startsWith('/staff/cases/')} />
            <NavItem to="/staff/residents" label="Residents" section={(p) => p.startsWith('/staff/residents/')} />
          </nav>
        )}
        {user && <button className="ghost sign-out" type="button" onClick={() => void signOut()}>Sign out</button>}
      </header>
      <main id="main" className="app-main" tabIndex={-1}>{children}</main>
      <footer className="footer"><Link to="/privacy">Privacy and support</Link></footer>
    </div>
  );
}

const LOGIN: Record<Role, string> = { staff: '/staff/login', family: '/family/login' };

function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { user, role: current, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={LOGIN[role]} replace state={{ from: location.pathname }} />;
  if (current !== role) {
    return (
      <p className="card narrow centered">
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
  if (!ready) return <Loading />;
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
      <Route path="/staff/finish" element={<FamilyFinishPage />} />
      <Route path="/staff" element={<Guard role="staff"><QueuePage /></Guard>} />
      <Route path="/staff/cases/:id" element={<Guard role="staff"><CasePage /></Guard>} />
      <Route path="/staff/residents" element={<Guard role="staff"><ResidentsPage /></Guard>} />
      <Route path="/staff/residents/new" element={<Guard role="staff"><ResidentPage /></Guard>} />
      <Route path="/staff/residents/:id" element={<Guard role="staff"><ResidentDetailPage /></Guard>} />
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
