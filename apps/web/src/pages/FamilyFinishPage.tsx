import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { sectionOf } from '../signin';
import { Loading } from '../components/States';
import { useDocumentTitle } from '../title';

export function FamilyFinishPage() {
  useDocumentTitle('Finish signing in');
  const { user, ready, isSignInLink, storedLinkEmail, finishSignInLink } = useAuth();
  const location = useLocation();
  const section = sectionOf(location.pathname) ?? 'family';
  const invitation = section === 'staff' && new URLSearchParams(location.search).get('invitation') === '1';
  const href = window.location.href;
  const valid = isSignInLink(href);
  // A colleague sent this link, so a remembered address may belong to someone else on this device.
  const [email, setEmail] = useState(invitation ? '' : storedLinkEmail() ?? '');
  const [completedEmail, setCompletedEmail] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const finish = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await finishSignInLink(address.trim(), href);
      setCompletedEmail(address.trim().toLowerCase());
    } catch {
      setError('Could not finish signing in. Check that you entered the email address that received this link. If the link has expired or was already used, ask for a new one.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const stored = invitation ? null : storedLinkEmail();
    if (ready && valid && stored && !tried.current) {
      tried.current = true;
      void finish(stored);
    }
    // Runs once for the link in the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, valid, invitation]);

  if (!ready) return <Loading />;
  // Wait for the completed identity, even if this browser was already signed in as someone else.
  if (completedEmail) {
    if (user?.email?.toLowerCase() !== completedEmail) return <Loading label="Signing you in…" />;
    return <Navigate to={invitation ? '/staff/welcome' : `/${section}`} replace />;
  }
  if (user && !invitation) return <Navigate to={`/${section}`} replace />;
  if (!valid) {
    return (
      <section className="card stack narrow centered">
        <h1>This link does not work</h1>
        <p><Link to={`/${section}/login`}>Ask for a new sign-in link</Link>.</p>
      </section>
    );
  }

  if (busy && !invitation && storedLinkEmail()) return <div className="narrow centered"><Loading label="Signing you in…" /></div>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void finish(email);
  };

  return (
    <form className="card stack narrow centered" onSubmit={submit}>
      <h1>{invitation ? 'Join your team on Hachi' : 'Confirm your email'}</h1>
      <p className="meta">{invitation
        ? 'Enter the work email address that received this link. After signing in, you can review the invitation and choose Join.'
        : 'Enter the email address that received this link to finish signing in.'}</p>
      {user && <p className="meta">This browser is signed in as {user.email}. Continuing signs in with the email address you enter below.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <label>Email<input type="email" autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <p><Link to={`/${section}/login`}>Ask for a new sign-in link</Link></p>}
    </form>
  );
}
