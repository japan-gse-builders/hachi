import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { sectionOf } from '../signin';
import { Loading } from '../components/States';
import { useDocumentTitle } from '../title';

export function FamilyFinishPage() {
  useDocumentTitle('Finish signing in');
  const { user, isSignInLink, storedLinkEmail, finishSignInLink } = useAuth();
  const section = sectionOf(useLocation().pathname) ?? 'family';
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

  if (user) return <Navigate to={`/${section}`} replace />;
  if (!valid) {
    return (
      <section className="card stack narrow centered">
        <h1>This link does not work</h1>
        <p><Link to={`/${section}/login`}>Ask for a new sign-in link</Link>.</p>
      </section>
    );
  }

  if (busy && storedLinkEmail()) return <div className="narrow centered"><Loading label="Signing you in…" /></div>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void finish(email);
  };

  return (
    <form className="card stack narrow centered" onSubmit={submit}>
      <h1>Confirm your email</h1>
      <p className="meta">You opened the link on a different device. Enter the same email address to finish signing in.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <label>Email<input type="email" autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <p><Link to={`/${section}/login`}>Ask for a new sign-in link</Link></p>}
    </form>
  );
}
