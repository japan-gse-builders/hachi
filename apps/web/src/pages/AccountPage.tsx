import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAccount } from '../account';
import { api, ORG_HEADER } from '../api';
import { useAuth } from '../auth';
import { LoadError, Loading } from '../components/States';
import { ROLE_LABEL, type MembershipSummary } from '../orgs';
import { useDocumentTitle } from '../title';
import '../styles/accounts.css';

/** Firebase's own codes, because "wrong password" and "too weak" need different actions. */
function passwordError(code: string | undefined, fallback: string): string {
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Your current password was not accepted.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Choose a longer password, with a mix of letters and numbers.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/requires-recent-login') return 'Sign out and sign in again, then change your password.';
  return fallback;
}

/** The signed-in person: their name, how they sign in, their organizations, and their sessions. */
export function AccountPage() {
  useDocumentTitle('Your account');
  const { me, loading, error, refresh } = useAccount();
  if (error) return <LoadError message={error} onRetry={() => void refresh()} />;
  if (loading || !me) return <Loading />;
  return (
    <div className="stack page narrow centered">
      <header className="page-header">
        <div>
          <h1>Your account</h1>
          <p className="meta">{me.email}{me.emailVerified ? '' : ' · not confirmed yet'}</p>
        </div>
      </header>
      <ProfileCard name={me.name ?? ''} phone={me.phone ?? ''} sms={me.sms ?? ''} />
      <PasswordCard email={me.email} />
      <OrganizationsCard memberships={me.memberships} uid={me.uid} />
      <SessionsCard />
    </div>
  );
}

/** The name colleagues see, and the numbers alerts reach them on as staff in charge of a patient. */
function ProfileCard({ name: initialName, phone: initialPhone, sms: initialSms }: { name: string; phone: string; sms: string }) {
  const { token } = useAuth();
  const { refresh } = useAccount();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [sms, setSms] = useState(initialSms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const changed = name.trim() !== initialName || phone.trim() !== initialPhone || sms.trim() !== initialSms;
  // Patients they are in charge of would be left with no number for alerts.
  const removingPhone = Boolean(initialPhone) && !phone.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/api/me', await token(), {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(sms.trim() ? { sms: sms.trim() } : initialSms ? { sms: null } : {}),
        }),
      });
      const next = await refresh();
      setPhone(next?.phone ?? phone.trim());
      setSms(next?.sms ?? '');
      setStatus('Saved. Colleagues see this name, and alerts about patients you are in charge of use these numbers, from now on.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="profile-heading">
      <h2 id="profile-heading">Your name and numbers</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="notice-success" role="status">{status}</p>}
      <label>
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" />
      </label>
      <p className="meta">Shown on the team list, beside patients you are responsible for, and in the activity log.</p>
      <label>
        Phone, for emergency calls
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required={Boolean(initialPhone)} placeholder="+81312345678" spellCheck={false} autoComplete="tel" />
      </label>
      <label>
        <span>Mobile for text alerts <span className="hint">(optional)</span></span>
        <input type="tel" value={sms} onChange={(e) => setSms(e.target.value)} placeholder="+819012345678" spellCheck={false} autoComplete="tel" />
      </label>
      <p className="meta">
        You are the staff in charge of the patients you are responsible for, so their alerts come to these numbers and
        to your email. You can only be made responsible for a patient once you have added a phone number.
      </p>
      {removingPhone && <p className="field-error">Patients you are in charge of need a number for alerts. Change it instead of removing it.</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy || !name.trim() || !changed || removingPhone}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function PasswordCard({ email }: { email: string | null }) {
  const { hasPassword, changePassword, sendPasswordReset } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setStatus('');
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (next !== repeat) return setError('The two new passwords are different.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setStatus('Password changed. Other devices stay signed in; sign out everywhere below if you are changing it because of a lost device.');
    } catch (err) {
      setError(passwordError((err as { code?: string }).code, 'Could not change the password.'));
    } finally {
      setBusy(false);
    }
  };

  const sendSetLink = async () => {
    if (!email) return;
    setBusy(true);
    setError('');
    try {
      await sendPasswordReset(email);
      setStatus(`We sent a link to ${email} to choose a password.`);
    } catch (err) {
      setError(passwordError((err as { code?: string }).code, 'Could not send the email.'));
    } finally {
      setBusy(false);
    }
  };

  if (!hasPassword) {
    return (
      <section className="card stack" aria-labelledby="password-heading">
        <h2 id="password-heading">Password</h2>
        <p>You sign in with Google or an email link, so this account has no password.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {status && <p className="notice-success" role="status">{status}</p>}
        {email && <p><button type="button" className="ghost" disabled={busy} onClick={() => void sendSetLink()}>Email me a link to set a password</button></p>}
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="password-heading">
      <h2 id="password-heading">Change password</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="notice-success" role="status">{status}</p>}
      <input type="email" autoComplete="username" value={email ?? ''} readOnly hidden />
      <label>
        Current password
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label>
        New password
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      </label>
      <label>
        New password again
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={8} />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={busy || !current || !next || !repeat}>{busy ? 'Changing…' : 'Change password'}</button>
      </div>
    </form>
  );
}

function OrganizationsCard({ memberships, uid }: { memberships: MembershipSummary[]; uid: string }) {
  const { token } = useAuth();
  const { refresh, current } = useAccount();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const leave = async (orgId: string) => {
    setBusy(true);
    setError('');
    try {
      // For this organization, whichever one the rest of the app is acting for.
      await api(`/api/organization/members/${encodeURIComponent(uid)}`, await token(), { method: 'DELETE', headers: { [ORG_HEADER]: orgId } });
      setLeaving(null);
      const next = await refresh();
      if (next && !next.memberships.some((m) => m.status === 'active')) void navigate('/staff/welcome');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="orgs-heading">
      <h2 id="orgs-heading">Organizations</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {memberships.length === 0 && <p>You do not belong to an organization yet. <Link to="/staff/welcome">Join or create one</Link>.</p>}
      {memberships.length > 0 && (
        <ul className="access-list">
          {memberships.map((m) => (
            <li key={m.orgId}>
              <div className="access-row">
                <div>
                  <p>
                    <strong>{m.orgName}</strong> <span className={`badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>{' '}
                    {m.status === 'disabled' && <span className="badge status-off">Access off</span>}
                    {m.orgStatus === 'suspended' && <span className="badge status-off">Suspended</span>}
                  </p>
                  {current?.orgId === m.orgId && <p className="meta">Working here now</p>}
                </div>
                {m.status === 'active' && <button type="button" className="ghost" disabled={busy} onClick={() => setLeaving(m.orgId)}>Leave</button>}
              </div>
              {leaving === m.orgId && (
                <div className="stack confirm notice">
                  <p>Leave {m.orgName}? Patients you are responsible for there become unassigned, and you will need a new invitation to come back.</p>
                  <div className="row">
                    <button type="button" disabled={busy} onClick={() => void leave(m.orgId)}>{busy ? 'Leaving…' : `Leave ${m.orgName}`}</button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => setLeaving(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="meta"><Link to="/staff/welcome">Join another organization, or create one</Link></p>
    </section>
  );
}

function SessionsCard() {
  const { token, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signOutEverywhere = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/me/sign-out-everywhere', await token(), { method: 'POST' });
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out everywhere');
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">Signed-in devices</h2>
      <p>Lost a phone, or signed in on a shared computer? Sign out everywhere, including here. Each device then has to sign in again.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!confirming && <p><button type="button" className="ghost" onClick={() => setConfirming(true)}>Sign out everywhere</button></p>}
      {confirming && (
        <div className="stack confirm notice">
          <p>Sign out of Hachi staff on every device, including this one?</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void signOutEverywhere()}>{busy ? 'Signing out…' : 'Sign out everywhere'}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
