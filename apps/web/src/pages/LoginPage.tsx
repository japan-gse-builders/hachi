import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { SignInCard } from '../components/SignInCard';
import { Loading } from '../components/States';
import { signInRedirect } from '../signin';
import { useDocumentTitle } from '../title';

export function LoginPage() {
  useDocumentTitle('Staff sign in');
  const { user, role, ready } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (!ready) return <Loading />;
  const onward = signInRedirect('staff', role, from);
  if (user && onward) return <Navigate to={onward} replace />;

  return (
    <SignInCard
      title="Staff sign in"
      intro="Use the staff email for this care team."
      notice={user ? 'You are signed in as a family contact. Signing in here replaces that session.' : undefined}
      footer={<p className="meta">Family member? <Link to="/family/login">Sign in here</Link>.</p>}
    />
  );
}
