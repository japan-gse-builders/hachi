import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAccount } from '../account';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { LoadError, Loading } from '../components/States';
import { formatWhen, phoneDisplay } from '../format';
import { atLeast, type Member } from '../orgs';
import { FAMILY_ACCESS_MAX, mayEditDetails, ownerName, ownershipOf } from '../ownership';
import { useDocumentTitle } from '../title';
import type { FamilyAccess, Resident } from '../types';

type AccessResult = { outcome: string; familyAccess: FamilyAccess[] };

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Errors about the address itself belong beside the field; anything else, under the form. */
const FIELD_REASONS = new Set(['family_contact', 'access_full']);

export function ResidentDetailPage() {
  const { id = '' } = useParams();
  const { token, user } = useAuth();
  const location = useLocation();
  const saved = Boolean((location.state as { saved?: boolean } | null)?.saved);
  const [resident, setResident] = useState<Resident | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(resident ? resident.name : 'Patient');

  useEffect(() => {
    setLoadError('');
    void token()
      .then((t) => api<Resident>(`/api/residents/${encodeURIComponent(id)}`, t))
      .then(setResident)
      .catch((err: unknown) => setLoadError(err instanceof ApiError && err.status === 404
        ? 'This patient is not registered, or the link is out of date.'
        : err instanceof Error ? err.message : 'Could not load this patient'));
  }, [id, token, attempt]);

  const back = (
    <p className="back-link">
      <Link to="/staff/residents"><span aria-hidden="true">← </span>Back to patients</Link>
    </p>
  );
  if (loadError) return <div className="stack page">{back}<LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} /></div>;
  if (!resident) return <div className="stack page">{back}<Loading layout="detail" label="Loading patient…" /></div>;

  return (
    <div className="stack page">
      {back}
      <header className="page-header">
        <div className="resident-heading">
          <ResidentAvatar id={resident.id} name={resident.name} portrait={resident.portrait} />
          <div>
            <h1>{resident.name}</h1>
            <p className="meta">{[resident.preferredName, phoneDisplay(resident.phone), `daily call ${resident.callTime}`].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </header>
      {saved && <p className="notice-success" role="status">Saved. The new details apply from the next call and the next alert.</p>}
      <div className="resident-detail">
        <DetailsCard resident={resident} uid={user?.uid} />
        <Responsibility resident={resident} uid={user?.uid} onSaved={setResident} />
        <FamilyAccessCard resident={resident} uid={user?.uid} onSaved={(familyAccess) => setResident({ ...resident, familyAccess })} />
      </div>
    </div>
  );
}

/** What is on record and who gets contacted, with the way to change it for whoever may. */
function DetailsCard({ resident, uid }: { resident: Resident; uid?: string }) {
  const { current } = useAccount();
  const ownership = ownershipOf(resident, uid);
  const canEdit = mayEditDetails(resident, uid, current?.role);
  const who = resident.preferredName || resident.name;
  const v = resident.vulnerability;
  const staff = resident.staff;
  const family = resident.family;
  const phone = (n: string | undefined) => n && phoneDisplay(n);
  return (
    <section className="card stack details-card" aria-labelledby="details-heading">
      <div className="row details-head">
        <h2 id="details-heading">Details and contacts</h2>
        {canEdit && <Link className="button ghost" to={`/staff/residents/${encodeURIComponent(resident.id)}/edit`}>Edit details</Link>}
      </div>
      <dl className="person-context">
        <div>
          <dt>Patient</dt>
          <dd>{[resident.name, resident.preferredName && `called “${resident.preferredName}”`, phoneDisplay(resident.phone), `daily call ${resident.callTime}`].filter(Boolean).join(' · ')}</dd>
        </div>
        {v && (
          <div>
            <dt>Circumstances</dt>
            <dd>
              {[v.livesAlone ? 'Lives alone' : 'Lives with others', v.hasCloseSupporter ? 'Has someone nearby' : 'Nobody nearby', v.needsCare ? 'Needs care' : 'No care needs recorded', ...v.chronicConditions].join(' · ')}
              {resident.householdNotes && <><br /><span className="meta">{resident.householdNotes}</span></>}
            </dd>
          </div>
        )}
        {staff && (
          <div>
            <dt>Staff in charge</dt>
            <dd>{[staff.name, phone(staff.phone) && `phone ${phone(staff.phone)}`, phone(staff.sms) && `texts ${phone(staff.sms)}`, staff.email].filter(Boolean).join(' · ')}</dd>
          </div>
        )}
        <div>
          <dt>Family contact</dt>
          <dd>{family ? [family.name, family.relationship, phone(family.sms), family.email].filter(Boolean).join(' · ') : 'None recorded'}</dd>
        </div>
      </dl>
      {!canEdit && ownership === 'theirs' && <p className="meta">Only {ownerName(resident.owner!)} or an admin can change {who}’s details.</p>}
      {!canEdit && ownership === 'unassigned' && <p className="meta">Take {who} on to change their details.</p>}
      {canEdit && ownership !== 'mine' && (
        <p className="meta">
          {ownership === 'theirs' ? `${ownerName(resident.owner!)} is responsible for ${who}.` : `Nobody is responsible for ${who} yet.`}
          {' '}As an admin you can still change their details and contacts.
        </p>
      )}
    </section>
  );
}

function Responsibility({ resident, uid, onSaved }: { resident: Resident; uid?: string; onSaved: (r: Resident) => void }) {
  const { token } = useAuth();
  const { current } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ownership = ownershipOf(resident, uid);
  const who = resident.preferredName || resident.name;

  const change = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError('');
    try {
      onSaved(await api<Resident>(`/api/residents/${encodeURIComponent(resident.id)}/owner`, await token(), { method }));
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="responsible-heading">
      <h2 id="responsible-heading">Responsible staff member</h2>
      {ownership === 'mine' && (
        <>
          <p>You are responsible for {who} since {date(resident.owner!.since)}. Only you can change who in their family can see their calls; you and the admins can change their details.</p>
          {!confirming && <p><button className="ghost" type="button" onClick={() => { setError(''); setConfirming(true); }}>Hand over</button></p>}
          {confirming && (
            <div className="stack confirm notice">
              <p>Hand {who} over? Nobody will be responsible for them until another member of staff takes them on. Family access stays as it is.</p>
              <div className="row">
                <button type="button" disabled={busy} onClick={() => void change('DELETE')}>{busy ? 'Handing over…' : `Hand ${who} over`}</button>
                <button className="ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {ownership === 'theirs' && (
        <p>
          <strong>{ownerName(resident.owner!)}</strong> is responsible for {who} since {date(resident.owner!.since)}.
          Ask them to make changes, or to hand {who} over to you.
        </p>
      )}
      {ownership === 'unassigned' && (
        <div className="stack notice notice-warning">
          <p role="status"><strong>Nobody is responsible for {who} yet.</strong> Take them on to change their details and who in their family can see their calls.</p>
          <p><button type="button" disabled={busy} onClick={() => void change('POST')}>{busy ? 'Saving…' : `Take on ${who}`}</button></p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {atLeast(current?.role, 'admin') && <AssignOwner resident={resident} onSaved={onSaved} />}
    </section>
  );
}

/** Admins decide who is responsible when the owner is away or has left, or to rebalance work. */
function AssignOwner({ resident, onSaved }: { resident: Resident; onSaved: (r: Resident) => void }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const who = resident.preferredName || resident.name;

  const start = async () => {
    setOpen(true);
    setError('');
    try {
      const res = await api<{ members: Member[] }>('/api/organization/members', await token());
      const active = res.members.filter((m) => m.status === 'active' && m.uid !== resident.owner?.uid);
      setMembers(active);
      setChoice(active[0]?.uid ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
    }
  };

  const assign = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await api<Resident>(`/api/residents/${encodeURIComponent(resident.id)}/owner`, await token(), { method: 'PUT', body: JSON.stringify({ uid: choice }) }));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign them');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <p><button type="button" className="subtle" onClick={() => void start()}>As an admin: make someone else responsible</button></p>;
  }
  return (
    <form className="stack confirm notice" onSubmit={(e) => void assign(e)}>
      {!members && !error && <p className="meta">Loading the team…</p>}
      {members && members.length === 0 && <p>There is nobody else active in the organization to make responsible.</p>}
      {members && members.length > 0 && (
        <label>
          Make responsible for {who}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {members.map((m) => <option key={m.uid} value={m.uid}>{m.name ? `${m.name} (${m.email})` : m.email}</option>)}
          </select>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        {members && members.length > 0 && <button type="submit" disabled={busy || !choice}>{busy ? 'Saving…' : 'Make responsible'}</button>}
        <button type="button" className="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function FamilyAccessCard({ resident, uid, onSaved }: { resident: Resident; uid?: string; onSaved: (access: FamilyAccess[]) => void }) {
  const { token } = useAuth();
  const field = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const access = resident.familyAccess ?? [];
  const canChange = ownershipOf(resident, uid) === 'mine';
  const full = access.length >= FAMILY_ACCESS_MAX;
  const who = resident.preferredName || resident.name;
  const signInLink = `${window.location.origin}/family/login`;
  const contact = resident.family;

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');
    const address = email.trim().toLowerCase();
    if (!field.current?.checkValidity() || !address) {
      setFieldError('Enter the email address the family member signs in with, like name@example.com.');
      field.current?.focus();
      return;
    }
    setAdding(true);
    try {
      const result = await api<AccessResult>(`/api/residents/${encodeURIComponent(resident.id)}/family-access`, await token(), {
        method: 'POST',
        body: JSON.stringify({ email: address }),
      });
      onSaved(result.familyAccess);
      setEmail('');
      setStatus(result.outcome === 'added'
        ? `${address} can now see ${who}’s calls. Ask them to sign in at ${signInLink} with this address.`
        : `${address} already has access.`);
    } catch (err) {
      const reason = err instanceof ApiError ? (err.body as { reason?: string } | null)?.reason : undefined;
      const message = err instanceof Error ? err.message : 'Could not give access';
      if (reason && FIELD_REASONS.has(reason)) {
        setFieldError(message);
        field.current?.focus();
      } else {
        setError(message);
      }
    } finally {
      setAdding(false);
    }
  };

  const remove = async (address: string) => {
    setRemoveBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await api<AccessResult>(
        `/api/residents/${encodeURIComponent(resident.id)}/family-access/${encodeURIComponent(address)}`,
        await token(),
        { method: 'DELETE' },
      );
      onSaved(result.familyAccess);
      setRemoving(null);
      setStatus(`${address} can no longer see ${who}’s calls.`);
    } catch (err) {
      // Already gone, perhaps removed in another tab: the list should say so rather than offer it again.
      if (err instanceof ApiError && err.status === 404) {
        onSaved(access.filter((a) => a.email !== address));
        setRemoving(null);
        setStatus(`${address} no longer had access.`);
      } else {
        setError(err instanceof Error ? err.message : 'Could not remove access');
      }
    } finally {
      setRemoveBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(signInLink).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <section className="card stack" aria-labelledby="family-access-heading">
      <div>
        <h2 id="family-access-heading">Family access</h2>
        <p className="meta">
          Family members sign in with the email address you add here and see {who}’s daily-call summaries and alerts.
          They never see recordings or transcripts.
        </p>
      </div>

      <dl className="person-context">
        <div>
          <dt>Family contact <span className="badge state-active">Gets alerts</span></dt>
          <dd>
            {contact
              ? [contact.name, contact.relationship, contact.email, contact.sms && phoneDisplay(contact.sms)].filter(Boolean).join(' · ')
              : 'None recorded. Nobody is alerted besides the care team.'}
          </dd>
        </div>
      </dl>

      <div className="stack">
        <h3 className="control-label">Can also see {who}’s calls ({access.length} of {FAMILY_ACCESS_MAX})</h3>
        {access.length === 0 && <p className="meta">Nobody else yet.</p>}
        {access.length > 0 && (
          <ul className="access-list">
            {access.map((a) => (
              <li key={a.email}>
                <div className="access-row">
                  <div>
                    <p className="access-email">{a.email}</p>
                    <p className="meta">Added {formatWhen(a.addedAt)}</p>
                  </div>
                  {canChange && removing !== a.email && (
                    <button className="ghost" type="button" disabled={removeBusy} aria-label={`Remove access for ${a.email}`}
                      onClick={() => { setError(''); setRemoving(a.email); }}>Remove</button>
                  )}
                </div>
                {removing === a.email && (
                  <div className="stack confirm notice">
                    <p>Remove {a.email}? They will no longer be able to see {who}’s calls.</p>
                    <div className="row">
                      <button type="button" disabled={removeBusy} onClick={() => void remove(a.email)}>{removeBusy ? 'Removing…' : 'Remove access'}</button>
                      <button className="ghost" type="button" disabled={removeBusy} onClick={() => setRemoving(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canChange && !full && (
        <form className="stack" noValidate onSubmit={(e) => void add(e)}>
          <label>Family member’s email
            <span className="hint">The address they sign in to Hachi with. They have to confirm it is theirs before they see anything.</span>
            <input ref={field} type="email" name="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
              aria-required="true" maxLength={254} placeholder="name@example.com" value={email}
              aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? 'family-email-error' : undefined}
              onChange={(e) => { setEmail(e.target.value); setFieldError(''); setStatus(''); }} />
          </label>
          {fieldError && <p id="family-email-error" className="field-error">{fieldError}</p>}
          <div className="row form-actions">
            <button type="submit" disabled={adding}>{adding ? 'Giving access…' : 'Give access'}</button>
          </div>
        </form>
      )}
      {canChange && full && <p className="meta">{FAMILY_ACCESS_MAX} family members can have access. Remove one to add someone else.</p>}
      {!canChange && (
        <p className="meta">
          {resident.owner
            ? `Only ${ownerName(resident.owner)} can change who has access.`
            : `Take ${who} on to change who has access.`}
        </p>
      )}

      <p className="notice-success" role="status">{status}</p>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="row">
        <span className="meta">Family sign-in page: <a href={signInLink}>{signInLink}</a></span>
        {'clipboard' in navigator && (
          <button className="subtle" type="button" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
        )}
      </div>
    </section>
  );
}
