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
      intro="Use the email your organization invited, or the one you set it up with."
      notice="New to Hachi? Continue with Google, or email yourself a sign-in link, to create an account. You can then set up your organization or join one you were invited to."
      footer={<p className="meta">Family member? <Link to="/family/login">Sign in here</Link>.</p>}
    />
  );
}
