import { Fragment, startTransition, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { AccountProvider, useAccount } from './account';
import { authReady, useAuth, type Role } from './auth';
import { LoadError, Loading } from './components/States';
import { AccountPage } from './pages/AccountPage';
import { ActivityPage } from './pages/ActivityPage';
import { CasePage } from './pages/CasePage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage';
import { FamilyFinishPage } from './pages/FamilyFinishPage';
import { FamilyHomePage } from './pages/FamilyHomePage';
import { FamilyLoginPage } from './pages/FamilyLoginPage';
import { LoginPage } from './pages/LoginPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { QueuePage } from './pages/QueuePage';
import { ResidentDetailPage } from './pages/ResidentDetailPage';
import { ResidentEditPage } from './pages/ResidentEditPage';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TeamPage } from './pages/TeamPage';
import { WelcomePage } from './pages/WelcomePage';
import './styles/accounts.css';

/** A case belongs to the queue it was opened from, so the queue stays marked while one is open. */
function NavItem({ to, label, section }: { to: string; label: string; section: (path: string) => boolean }) {
  const { pathname } = useLocation();
  const current = pathname === to ? 'page' : section(pathname) ? 'true' : undefined;
  return <Link to={to} aria-current={current}>{label}</Link>;
}

/** Which organization staff pages act for: a choice only when there is one to make. */
function OrgSwitch() {
  const { current, usable, switchOrg } = useAccount();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!current) return null;
  if (usable.length < 2) return <span className="org-name">{current.orgName}</span>;
  const change = (orgId: string) => {
    // A case or resident belongs to the organization being left, so go back to its list. Router
    // navigations are transitions, so the switch joins the same one: otherwise the page remounts
    // under the new organization first and asks for a record it cannot see.
    startTransition(() => {
      if (/^\/staff\/residents\/(?!new$)[^/]+/.test(pathname)) void navigate('/staff/residents');
      else if (/^\/staff\/cases\//.test(pathname)) void navigate('/staff');
      switchOrg(orgId);
    });
  };
  return (
    <label className="org-switch">
      <span className="sr-only">Organization</span>
      <select value={current.orgId} onChange={(e) => change(e.target.value)}>
        {usable.map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName}</option>)}
      </select>
    </label>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, role, signOut } = useAuth();
  const { current } = useAccount();
  const { pathname } = useLocation();
  const staff = Boolean(user) && role === 'staff';
  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="top">
        <Link className="brand" to="/">
          <img src="/branding/hachi-logo.png" alt="Hachi" width={1991} height={790} />
        </Link>
        {staff && current && (
          <nav className="nav" aria-label="Staff">
            <NavItem to="/staff" label="Queue" section={(p) => p.startsWith('/staff/cases/')} />
            <NavItem to="/staff/residents" label="Residents" section={(p) => p.startsWith('/staff/residents/')} />
            <NavItem to="/staff/team" label="Team" section={(p) => p === '/staff/organization' || p === '/staff/activity'} />
          </nav>
        )}
        {user && (
          <div className="account-bar">
            {staff && <OrgSwitch />}
            {staff && <Link to="/staff/account" aria-current={pathname === '/staff/account' ? 'page' : undefined}>Account</Link>}
            <button className="ghost sign-out" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
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

/**
 * A new organization can be set up in full straight away, but nothing it enters reaches anyone
 * until Hachi has checked who runs it: otherwise anyone could have strangers rung or messaged.
 */
function UnverifiedNotice({ orgName }: { orgName: string }) {
  return (
    <div className="notice unverified-notice" role="status">
      <p>
        <strong>Hachi has not verified {orgName} yet.</strong> You can set up your team and residents now. Hachi will not ring residents,
        send alerts or show residents to their family until it has.
      </p>
      <p>
        To get verified, contact Hachi support (<Link to="/privacy">Privacy and support</Link>).
      </p>
    </div>
  );
}

/**
 * Staff pages act for an organization. Until the account belongs to one it can use, everything
 * but the welcome and account pages sends it to welcome. Pages remount when the organization
 * changes, so nothing from the previous one stays on screen.
 */
function StaffGuard({ children, needsOrg = true }: { children: ReactNode; needsOrg?: boolean }) {
  const { current, loading, error, refresh } = useAccount();
  return (
    <Guard role="staff">
      {error ? (
        <LoadError message={error} onRetry={() => void refresh()} />
      ) : loading ? (
        <Loading />
      ) : needsOrg && !current ? (
        <Navigate to="/staff/welcome" replace />
      ) : (
        <Fragment key={current?.orgId ?? 'none'}>
          {needsOrg && current && !current.verified && <UnverifiedNotice orgName={current.orgName} />}
          {children}
        </Fragment>
      )}
    </Guard>
  );
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
      <Route path="/staff/welcome" element={<StaffGuard needsOrg={false}><WelcomePage /></StaffGuard>} />
      <Route path="/staff/account" element={<StaffGuard needsOrg={false}><AccountPage /></StaffGuard>} />
      <Route path="/staff" element={<StaffGuard><QueuePage /></StaffGuard>} />
      <Route path="/staff/cases/:id" element={<StaffGuard><CasePage /></StaffGuard>} />
      <Route path="/staff/residents" element={<StaffGuard><ResidentsPage /></StaffGuard>} />
      <Route path="/staff/residents/new" element={<StaffGuard><ResidentPage /></StaffGuard>} />
      <Route path="/staff/residents/:id" element={<StaffGuard><ResidentDetailPage /></StaffGuard>} />
      <Route path="/staff/residents/:id/edit" element={<StaffGuard><ResidentEditPage /></StaffGuard>} />
      <Route path="/staff/team" element={<StaffGuard><TeamPage /></StaffGuard>} />
      <Route path="/staff/organization" element={<StaffGuard><OrganizationPage /></StaffGuard>} />
      <Route path="/staff/activity" element={<StaffGuard><ActivityPage /></StaffGuard>} />
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
    <AccountProvider>
      <Shell>
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </Shell>
    </AccountProvider>
  );
}
