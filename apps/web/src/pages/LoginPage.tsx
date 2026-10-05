import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { SignInCard } from '../components/SignInCard';

export function LoginPage() {
  const { user } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (user) return <Navigate to={from?.startsWith('/staff') ? from : '/'} replace />;

  return (
    <SignInCard
      title="Staff sign in"
      intro="Use the staff email for this care team."
      footer={<p className="meta">Family member? <Link to="/family/login">Sign in here</Link>.</p>}
    />
  );
}
