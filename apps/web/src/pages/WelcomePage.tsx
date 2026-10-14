import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAccount } from '../account';
import { api } from '../api';
import { useAuth } from '../auth';
import { LoadError, Loading } from '../components/States';
import { formatWhen } from '../format';
import { ROLE_LABEL, timeZoneOptions } from '../orgs';
import { useDocumentTitle } from '../title';
import '../styles/accounts.css';

/**
 * Where a staff account lands until it belongs to an organization: confirm the address, then
 * join one that invited it or set up a new one. Also reachable later, to accept another invitation.
 */
export function WelcomePage() {
  useDocumentTitle('Get started');
  const { me, current, loading, error, refresh } = useAccount();
  if (error) return <LoadError message={error} onRetry={() => void refresh()} />;
  if (loading || !me) return <Loading />;
  if (!me.email) {
    return (
      <section className="card stack narrow centered">
        <h1>Staff accounts need an email address</h1>
        <p>This account signs in without one. Sign out, then sign in with Google or with your work email.</p>
      </section>
    );
  }
  if (!me.emailVerified) return <ConfirmEmail email={me.email} />;

  const disabled = me.memberships.filter((m) => m.status === 'disabled');
  const suspended = me.memberships.filter((m) => m.status === 'active' && m.orgStatus === 'suspended');
  return (
    <div className="stack page narrow centered">
      <header className="page-header">
        <div>
          <h1>{current ? 'Join or create an organization' : 'Welcome to Hachi'}</h1>
          <p className="meta">Signed in as {me.email}</p>
        </div>
      </header>
      {current && (
        <p className="notice card">
          You are working in <strong>{current.orgName}</strong>. <Link to="/staff">Go to the queue</Link>.
        </p>
      )}
      {disabled.map((m) => (
        <p key={m.orgId} className="notice notice-warning card" role="status">
          Your access to <strong>{m.orgName}</strong> has been turned off. Ask one of its admins to turn it back on.
        </p>
      ))}
      {suspended.map((m) => (
        <p key={m.orgId} className="notice notice-warning card" role="status">
          <strong>{m.orgName}</strong> is suspended. Contact Hachi support.
        </p>
      ))}
      <Invitations />
      <CreateOrganization />
    </div>
  );
}

function ConfirmEmail({ email }: { email: string }) {
  const { confirmEmail, reloadUser } = useAuth();
  const { refresh } = useAccount();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (what: 'send' | 'check') => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (what === 'send') {
        await confirmEmail();
        setStatus(`We sent a confirmation link to ${email}. Open it, then come back here.`);
      } else {
        await reloadUser();
        const next = await refresh();
        if (next && !next.emailVerified) setStatus('Not confirmed yet. Open the link in the email we sent, then try again.');
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'auth/too-many-requests' ? 'Too many emails were sent. Wait a few minutes and try again.' : err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack narrow centered" aria-labelledby="confirm-heading">
      <h1 id="confirm-heading">Confirm your email address</h1>
      <p>
        Invitations, the team list and the activity log all go by email, so Hachi needs to know <strong>{email}</strong> is yours
        before you join or set up an organization.
      </p>
      {status && <p className="notice-success" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void run('send')}>Send confirmation email</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void run('check')}>I have confirmed it</button>
      </div>
    </section>
  );
}

function Invitations() {
  const { me, refresh } = useAccount();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const invitations = me?.invitations ?? [];
  if (!invitations.length) return null;

  const decide = async (id: string, decision: 'accept' | 'decline') => {
    setBusy(`${id}/${decision}`);
    setError('');
    try {
      const res = await api<{ orgId: string } | { status: string }>(`/api/invitations/${encodeURIComponent(id)}/${decision}`, await token(), { method: 'POST' });
      await refresh('orgId' in res ? res.orgId : undefined);
      if (decision === 'accept') void navigate('/staff');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer that invitation');
      await refresh();
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card stack" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invitations</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="access-list">
        {invitations.map((i) => (
          <li key={i.id}>
            <div className="access-row">
              <div>
                <p><strong>{i.orgName}</strong> · {ROLE_LABEL[i.role]}</p>
                <p className="meta">{i.invitedBy ? `Invited by ${i.invitedBy}. ` : ''}Open until {formatWhen(i.expiresAt)}.</p>
                {!i.orgVerified && (
                  <p className="meta">Hachi has not verified this organization yet: these names are as it typed them. Join only if you know who sent it.</p>
                )}
              </div>
              <div className="row">
                <button type="button" disabled={Boolean(busy)} onClick={() => void decide(i.id, 'accept')}>
                  {busy === `${i.id}/accept` ? 'Joining…' : 'Join'}
                </button>
                <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => void decide(i.id, 'decline')}>
                  {busy === `${i.id}/decline` ? 'Declining…' : 'Decline'}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateOrganization() {
  const { token } = useAuth();
  const { refresh, me } = useAccount();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Tokyo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invited = Boolean(me?.invitations.length);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ orgId: string }>('/api/organizations', await token(), { method: 'POST', body: JSON.stringify({ name: name.trim(), timeZone }) });
      await refresh(res.orgId);
      void navigate('/staff/team', { state: { created: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the organization');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="create-heading">
      <h2 id="create-heading">{invited ? 'Or set up a new organization' : 'Set up your organization'}</h2>
      <p className="meta">
        For a care company or team starting with Hachi. You will be its owner and can invite your colleagues next.
        If your organization already uses Hachi, ask one of its admins to invite {me?.email ?? 'you'} instead.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <label>
        Organization name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="organization" />
      </label>
      <label>
        Time zone
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {timeZoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </label>
      <p className="meta">New patients get this time zone for their daily call. Starts on the trial plan: up to 20 patients and 10 staff.</p>
      <div className="form-actions">
        <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create organization'}</button>
      </div>
    </form>
  );
}
