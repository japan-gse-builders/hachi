import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth';
import { SignInCard } from '../components/SignInCard';

export function FamilyLoginPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;

  return (
    <SignInCard
      title="Family sign in"
      intro="Use the email address the care team has for you."
      footer={<p className="meta">Care staff? <Link to="/staff/login">Sign in here</Link>.</p>}
    />
  );
}
