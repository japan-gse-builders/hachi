import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth';

export function FamilyFinishPage() {
  const { user, isSignInLink, storedLinkEmail, finishSignInLink } = useAuth();
  const href = window.location.href;
  const valid = isSignInLink(href);
  const [email, setEmail] = useState(storedLinkEmail() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const finish = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await finishSignInLink(address.trim(), href);
    } catch {
      setError('This link has expired or was already used. Ask for a new one.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const stored = storedLinkEmail();
    if (valid && stored && !tried.current) {
      tried.current = true;
      void finish(stored);
    }
    // Runs once for the link in the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user) return <Navigate to="/" replace />;
  if (!valid) {
    return (
      <section className="card stack">
        <h2>This link does not work</h2>
        <p><Link to="/family/login">Ask for a new sign-in link</Link>.</p>
      </section>
    );
  }

  if (busy && storedLinkEmail()) return <p>Signing you in…</p>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void finish(email);
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Confirm your email</h2>
      <p className="meta">You opened the link on a different device. Enter the same email address to finish signing in.</p>
      {error && <p className="error">{error}</p>}
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <p><Link to="/family/login">Ask for a new sign-in link</Link></p>}
    </form>
  );
}
