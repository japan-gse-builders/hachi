import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth';

function linkError(code: string | undefined): string {
  if (code === 'auth/operation-not-allowed') return 'Email sign-in links are not turned on yet. Please tell the care team.';
  if (code === 'auth/unauthorized-continue-uri') return 'This website is not allowed to send sign-in links yet. Please tell the care team.';
  if (code === 'auth/invalid-email') return 'That email address does not look right.';
  if (code === 'auth/quota-exceeded' || code === 'auth/too-many-requests') return 'Too many links were sent. Please try again later.';
  return 'We could not send the link. Check the address and try again.';
}

export function FamilyLoginPage() {
  const { user, sendFamilyLink } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendFamilyLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(linkError((err as { code?: string }).code));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="card stack">
        <h2>Check your email</h2>
        <p>We sent a sign-in link to <strong>{email}</strong>. Open it on this phone to see the daily calls.</p>
        <p className="meta">The link works once. If it does not arrive in a few minutes, check your spam folder.</p>
        <button type="button" className="ghost" onClick={() => setSent(false)}>Use a different email</button>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Family sign in</h2>
      <p className="meta">Enter the email address the care team has for you. We will email you a link, so there is no password.</p>
      {error && <p className="error">{error}</p>}
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      <p className="meta">Care staff? <Link to="/staff/login">Sign in here</Link>.</p>
    </form>
  );
}
