import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAccount } from '../account';
import { api } from '../api';
import { useAuth } from '../auth';
import { LoadError, Loading } from '../components/States';
import { TeamNav } from '../components/TeamNav';
import { formatWhen } from '../format';
import { atLeast, PLAN_LABEL, timeZoneOptions, type OrganizationView } from '../orgs';
import { MAX_CALL_MEDIA_RETENTION_DAYS } from '../privacy';
import { useDocumentTitle } from '../title';

/** The organization itself: its name and time zone, and for admins its plan and how much of it is used. */
export function OrganizationPage() {
  useDocumentTitle('Organization');
  const { token } = useAuth();
  const { current, refresh } = useAccount();
  const [org, setOrg] = useState<OrganizationView | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      setOrg(await api<OrganizationView>('/api/organization', await token()));
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the organization');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = async () => {
    await Promise.all([load(), refresh()]);
  };

  return (
    <div className="stack page">
      <header className="page-header">
        <div>
          <h1>{current?.orgName ?? 'Organization'}</h1>
          <p className="meta">Settings for the whole organization.</p>
        </div>
      </header>
      <TeamNav />
      {loadError && <LoadError message={loadError} onRetry={() => void load()} />}
      {!org && !loadError && <Loading label="Loading the organization…" />}
      {org && (
        <>
          <GeneralSettings org={org} onSaved={saved} />
          <RetentionSettings org={org} onSaved={load} />
          {org.billing && org.usage && <PlanCard org={org as Required<OrganizationView>} onSaved={saved} />}
        </>
      )}
    </div>
  );
}

function RetentionSettings({ org, onSaved }: { org: OrganizationView; onSaved: () => Promise<void> }) {
  const { token } = useAuth();
  const current = org.callMediaRetentionDays ?? null;
  const [days, setDays] = useState(String(current ?? ''));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const canEdit = atLeast(org.role, 'admin');
  const value = Number(days);
  const valid = Number.isInteger(value) && value >= 1 && value <= MAX_CALL_MEDIA_RETENTION_DAYS;
  useEffect(() => { setDays(String(current ?? '')); }, [current]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || busy || !valid || value === current) return;
    if (!confirming && (current === null || value < current)) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api('/api/organization', await token(), { method: 'PATCH', body: JSON.stringify({ callMediaRetentionDays: value }) });
      setConfirming(false);
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the retention period.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)} aria-labelledby="retention-heading">
      <h2 id="retention-heading">Recording and transcript retention</h2>
      <p className="meta">The period starts when each call begins. It applies to past and future calls.</p>
      <p>{current === null ? 'No automatic retention period is set.' : `Current period: ${current} ${current === 1 ? 'day' : 'days'}.`}</p>
      {canEdit && (
        <>
          <div className="retention-setting">
            <label>Retention period in days
              <input type="number" min={1} max={MAX_CALL_MEDIA_RETENTION_DAYS} step={1} required value={days} disabled={busy}
                onChange={(event) => { setDays(event.target.value); setConfirming(false); setError(''); setSaved(false); }} />
            </label>
          </div>
          {confirming && <p className="notice" role="status">Saving this period can permanently delete recordings and transcripts from past calls.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {saved && <p className="notice-success" role="status">Retention period saved.</p>}
          <div className="row">
            <button type="submit" disabled={busy || !valid || value === current}>{busy ? 'Saving…' : confirming ? 'Confirm retention period' : 'Save retention period'}</button>
            {confirming && <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>}
          </div>
        </>
      )}
    </form>
  );
}

function GeneralSettings({ org, onSaved }: { org: OrganizationView; onSaved: () => Promise<void> }) {
  const { token } = useAuth();
  const canEdit = atLeast(org.role, 'admin');
  const [name, setName] = useState(org.name);
  const [timeZone, setTimeZone] = useState(org.timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const changed = name.trim() !== org.name || timeZone !== org.timeZone;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const body = { ...(name.trim() !== org.name ? { name: name.trim() } : {}), ...(timeZone !== org.timeZone ? { timeZone } : {}) };
      await api('/api/organization', await token(), { method: 'PATCH', body: JSON.stringify(body) });
      setStatus('Saved.');
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <section className="card stack" aria-labelledby="general-heading">
        <h2 id="general-heading">General</h2>
        <dl className="usage">
          <div><dt>Name</dt><dd>{org.name}</dd></div>
          <div><dt>Time zone</dt><dd>{org.timeZone}</dd></div>
        </dl>
        <p className="meta">Only admins can change these.</p>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="general-heading">
      <h2 id="general-heading">General</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="notice-success" role="status">{status}</p>}
      <div className="field-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </label>
        <label>
          Time zone
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {timeZoneOptions(org.timeZone).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
      </div>
      <p className="meta">The time zone is the default for new patients; patients already registered keep their own.</p>
      <div className="form-actions">
        <button type="submit" disabled={busy || !changed || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function PlanCard({ org, onSaved }: { org: Required<OrganizationView>; onSaved: () => Promise<void> }) {
  const { token } = useAuth();
  const isOwner = org.role === 'owner';
  const [email, setEmail] = useState(org.billing.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api('/api/organization', await token(), { method: 'PATCH', body: JSON.stringify({ billingEmail: email.trim() }) });
      setStatus('Saved.');
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const { limits } = org.billing;
  return (
    <section className="card stack" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Plan and usage</h2>
      <dl className="usage">
        <div><dt>Plan</dt><dd>{PLAN_LABEL[org.billing.plan]}</dd></div>
        <div><dt>Verification</dt><dd>{org.verified ? 'Verified' : 'Not yet verified'}</dd></div>
        <div><dt>Patients</dt><dd>{org.usage.residents} of {limits.residents}</dd></div>
        <div><dt>Staff, with invitations</dt><dd>{org.usage.members} of {limits.members}</dd></div>
      </dl>
      <p className="meta">
        Nothing is charged yet. {org.createdAt ? `Set up ${formatWhen(org.createdAt)}. ` : ''}To raise a limit, contact Hachi.
      </p>
      {isOwner ? (
        <form className="stack" onSubmit={(e) => void submit(e)}>
          {error && <p className="error" role="alert">{error}</p>}
          {status && <p className="notice-success" role="status">{status}</p>}
          <label>
            Billing email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} spellCheck={false} />
          </label>
          <p className="meta">Where invoices will go once there are any. Only owners can change it.</p>
          <div className="form-actions">
            <button type="submit" disabled={busy || email.trim().toLowerCase() === org.billing.email}>{busy ? 'Saving…' : 'Save billing email'}</button>
          </div>
        </form>
      ) : (
        <p className="meta">Billing email: {org.billing.email}. Only owners can change it.</p>
      )}
    </section>
  );
}
