import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth';

/** The code matters here: a locked-out account and a wrong password need different actions. */
function signInError(code: string | undefined): string {
  if (code === 'auth/too-many-requests') return 'Too many attempts from this device. Wait a few minutes, or reset your password below.';
  if (code === 'auth/network-request-failed') return 'Could not reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/user-disabled') return 'This account is disabled. Ask an administrator to enable it.';
  if (code === 'auth/operation-not-allowed') return 'That way of signing in is not turned on for this project.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/account-exists-with-different-credential') return 'This address already signs in another way. Use a password or a sign-in link instead.';
  if (code === undefined) return 'Sign-in failed.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    return 'That email or password was not accepted.';
  }
  return `Sign-in failed (${code}).`;
}

function linkError(code: string | undefined): string {
  if (code === 'auth/unauthorized-continue-uri') return 'This website is not allowed to send sign-in links yet. Please tell the care team.';
  if (code === 'auth/invalid-email') return 'That email address does not look right.';
  if (code === 'auth/quota-exceeded' || code === 'auth/too-many-requests') return 'Too many emails were sent. Please try again later.';
  if (code === 'auth/operation-not-allowed') return 'Email sign-in links are not turned on yet. Please tell the care team.';
  return 'We could not send the email. Check the address and try again.';
}

type Sent = 'link' | 'reset';

const SENT: Record<Sent, { title: string; body: (email: string) => string }> = {
  link: {
    title: 'Check your email',
    body: (email) => `We sent a sign-in link to ${email}. Open it on this device to sign in. From then on this account has no password; use the link or Google each time, or set a password with “Reset my password”.`,
  },
  reset: {
    title: 'Check your email',
    body: (email) => `We sent a password reset link to ${email}. Open it to choose a new password, then sign in again.`,
  },
};

/**
 * One sign-in card for staff and family: Google, a password, or a link by email. The link doubles
 * as the way in when a password is forgotten, so nobody is locked out of their own calls.
 */
export function SignInCard({ title, intro, notice, footer }: { title: string; intro: string; notice?: string; footer: ReactNode }) {
  const { signIn, signInWithGoogle, sendPasswordReset, sendSignInLink } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (what: 'google' | 'password' | 'link' | 'reset') => {
    if (what !== 'google' && !email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (what === 'google') await signInWithGoogle();
      else if (what === 'password') await signIn(email.trim(), password);
      else if (what === 'link') {
        await sendSignInLink(email.trim());
        setSent('link');
      } else {
        await sendPasswordReset(email.trim());
        setSent('reset');
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(what === 'link' || what === 'reset' ? linkError(code) : signInError(code));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run('password');
  };

  if (sent) {
    return (
      <section className="card stack narrow">
        <h1>{SENT[sent].title}</h1>
        <p>{SENT[sent].body(email.trim())}</p>
        <p className="meta">If it does not arrive in a few minutes, check your spam folder.</p>
        <button type="button" className="ghost" onClick={() => setSent(null)}>Back to sign in</button>
      </section>
    );
  }

  return (
    <form className="card stack narrow" onSubmit={submit}>
      <h1>{title}</h1>
      <p className="meta">{intro}</p>
      {notice && <p className="meta">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="ghost" disabled={busy} onClick={() => void run('google')}>Continue with Google</button>
      <p className="meta or-divider">or</p>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={() => void run('reset')}>Reset my password</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run('link')}>Email me a sign-in link</button>
      </div>
      {/* Firebase deletes an account's password as soon as a sign-in link is used on it. */}
      <p className="meta">Forgotten your password? Reset it. A sign-in link is for people who have no password: using one clears any password the account had.</p>
      {footer}
    </form>
  );
}
