import { Link, useLocation } from 'react-router';
import { useAccount } from '../account';
import { atLeast } from '../orgs';
import '../styles/accounts.css';

/** The tabs of the team section: who works here, the organization itself, and what they did. */
export function TeamNav() {
  const { pathname } = useLocation();
  const { current } = useAccount();
  const tabs = [
    { to: '/staff/team', label: 'Team' },
    { to: '/staff/organization', label: 'Organization' },
    ...(atLeast(current?.role, 'admin') ? [{ to: '/staff/activity', label: 'Activity' }] : []),
  ];
  return (
    <nav className="subnav" aria-label="Team section">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} aria-current={pathname === t.to ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
