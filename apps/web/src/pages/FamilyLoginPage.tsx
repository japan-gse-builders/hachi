import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth';
import { SignInCard } from '../components/SignInCard';
import { Loading } from '../components/States';
import { signInRedirect } from '../signin';
import { useDocumentTitle } from '../title';

export function FamilyLoginPage() {
  useDocumentTitle('Family sign in');
  const { user, role, ready } = useAuth();
  if (!ready) return <Loading />;
  const onward = signInRedirect('family', role);
  if (user && onward) return <Navigate to={onward} replace />;

  return (
    <SignInCard
      title="Family sign in"
      intro="Use the email address the care team has for you."
      notice={user ? 'You are signed in as care staff. Signing in here replaces that session.' : undefined}
      footer={<p className="meta">Care staff? <Link to="/staff/login">Sign in here</Link>.</p>}
    />
  );
}
