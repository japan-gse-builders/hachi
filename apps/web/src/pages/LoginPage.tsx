import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';

/** The code matters here: a locked-out account and a wrong password need different actions. */
function signInError(code: string | undefined): string {
  if (code === 'auth/too-many-requests') return 'Too many attempts from this device. Wait a few minutes, or reset your password below.';
  if (code === 'auth/network-request-failed') return 'Could not reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/user-disabled') return 'This account is disabled. Ask an administrator to enable it.';
  if (code === 'auth/operation-not-allowed') return 'Email and password sign-in is not turned on for this project.';
  if (code === undefined) return 'Sign-in failed.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    return 'That email or password was not accepted.';
  }
  return `Sign-in failed (${code}).`;
}

function resetError(code: string | undefined): string {
  if (code === 'auth/too-many-requests') return 'Too many reset emails were requested. Please try again later.';
  if (code === 'auth/invalid-email') return 'That email address does not look right.';
  return 'We could not send the reset email. Check the address and try again.';
}

export function LoginPage() {
  const { user, signIn, sendStaffPasswordReset } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;
  if (user) return <Navigate to={from?.startsWith('/staff') ? from : '/'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(signInError((err as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      setError('Enter your email address first, then ask for a reset link.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await sendStaffPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(resetError((err as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="card stack">
        <h2>Check your email</h2>
        <p>We sent a password reset link to <strong>{email.trim()}</strong>. Open it to choose a new password, then sign in again.</p>
        <p className="meta">If it does not arrive in a few minutes, check your spam folder.</p>
        <button type="button" className="ghost" onClick={() => setSent(false)}>Back to sign in</button>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Staff sign in</h2>
      <p className="meta">Use the staff email for this care team.</p>
      {error && <p className="error">{error}</p>}
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="ghost" disabled={busy} onClick={() => void reset()}>Email me a password reset link</button>
      <p className="meta">Family member? <Link to="/family/login">Sign in with an email link</Link>.</p>
    </form>
  );
}
