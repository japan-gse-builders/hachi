import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { useAccount } from '../account';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { LoadError, Loading } from '../components/States';
import { TeamNav } from '../components/TeamNav';
import { formatWhen } from '../format';
import { atLeast, ROLE_LABEL, ROLE_MEANING, type Member, type OrgInvitation, type OrgRole } from '../orgs';
import { useDocumentTitle } from '../title';

/** Who works in this organization, and for admins: inviting, changing roles, turning access off. */
export function TeamPage() {
  useDocumentTitle('Team');
  const { token, user } = useAuth();
  const { current } = useAccount();
  const location = useLocation();
  const created = Boolean((location.state as { created?: boolean } | null)?.created);
  const isAdmin = atLeast(current?.role, 'admin');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const t = await token();
      const [m, i] = await Promise.all([
        api<{ members: Member[] }>('/api/organization/members', t),
        isAdmin ? api<{ invitations: OrgInvitation[] }>('/api/organization/invitations', t) : Promise.resolve({ invitations: [] }),
      ]);
      setMembers(m.members);
      setInvitations(i.invitations);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the team');
    }
  }, [token, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack page">
      <header className="page-header">
        <div>
          <h1>{current?.orgName ?? 'Team'}</h1>
          <p className="meta">You are {current ? `${ROLE_LABEL[current.role].toLowerCase()} here` : 'a member'}. {current ? ROLE_MEANING[current.role] : ''}</p>
        </div>
      </header>
      <TeamNav />
      {created && (
        <p className="notice-success card" role="status">
          Your organization is ready. Invite your colleagues below, then add your first resident.
        </p>
      )}
      {loadError && <LoadError message={loadError} onRetry={() => void load()} />}
      {!members && !loadError && <Loading label="Loading the team…" />}
      {members && (
        <>
          {isAdmin && <InviteForm onInvited={load} />}
          {isAdmin && invitations.length > 0 && <PendingInvitations invitations={invitations} onChanged={load} />}
          <MemberList members={members} myUid={user?.uid ?? ''} myRole={current?.role ?? 'member'} onChanged={load} />
        </>
      )}
    </div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => Promise<void> }) {
  const { token } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const res = await api<{ email: string }>('/api/organization/invitations', await token(), { method: 'POST', body: JSON.stringify({ email: email.trim(), role }) });
      setStatus(`Invitation saved for ${res.email}. Nothing is emailed yet: ask them to sign in to Hachi staff with this address, and the invitation will be waiting.`);
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not invite them');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite a colleague</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="notice-success" role="status">{status}</p>}
      <div className="field-grid">
        <label>
          Their work email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} spellCheck={false} autoComplete="off" />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Member: {ROLE_MEANING.member}</option>
            <option value="admin">Admin: {ROLE_MEANING.admin}</option>
          </select>
        </label>
      </div>
      <p className="meta">Only an account that has confirmed this address can accept. Invitations are open for 14 days. To make someone an owner, invite them first, then change their role.</p>
      <div className="form-actions">
        <button type="submit" disabled={busy || !email.trim()}>{busy ? 'Inviting…' : 'Invite'}</button>
      </div>
    </form>
  );
}

function PendingInvitations({ invitations, onChanged }: { invitations: OrgInvitation[]; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const withdraw = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      await api(`/api/organization/invitations/${encodeURIComponent(id)}`, await token(), { method: 'DELETE' });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw it');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card stack" aria-labelledby="pending-heading">
      <h2 id="pending-heading">Waiting to join</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="access-list">
        {invitations.map((i) => (
          <li key={i.id}>
            <div className="access-row">
              <div>
                <p className="access-email">{i.email} <span className={`badge role-${i.role}`}>{ROLE_LABEL[i.role]}</span> {i.expired && <span className="badge status-off">Expired</span>}</p>
                <p className="meta">
                  {i.invitedBy ? `Invited by ${i.invitedBy} ` : 'Invited '}{formatWhen(i.createdAt)}.{' '}
                  {i.expired ? 'Withdraw it and invite them again.' : `Open until ${formatWhen(i.expiresAt)}.`}
                </p>
              </div>
              <button type="button" className="ghost" disabled={busy === i.id} onClick={() => void withdraw(i.id)}>
                {busy === i.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MemberList({ members, myUid, myRole, onChanged }: { members: Member[]; myUid: string; myRole: OrgRole; onChanged: () => Promise<void> }) {
  return (
    <section className="card stack" aria-labelledby="members-heading">
      <h2 id="members-heading">Members ({members.filter((m) => m.status === 'active').length})</h2>
      <ul className="access-list">
        {members.map((m) => <MemberRow key={m.uid} member={m} self={m.uid === myUid} myRole={myRole} onChanged={onChanged} />)}
      </ul>
    </section>
  );
}

function MemberRow({ member, self, myRole, onChanged }: { member: Member; self: boolean; myRole: OrgRole; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmOwner, setConfirmOwner] = useState(false);
  // Mirrors the API: admins manage members and admins, owners manage everyone, nobody manages themselves.
  const canManage = !self && atLeast(myRole, 'admin') && (member.role !== 'owner' || myRole === 'owner');
  const who = member.name ?? member.email;

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError('');
    try {
      await api(path, await token(), init);
      setConfirmRemove(false);
      setConfirmOwner(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };
  const url = `/api/organization/members/${encodeURIComponent(member.uid)}`;
  const patch = (body: object) => run(url, { method: 'PATCH', body: JSON.stringify(body) });

  return (
    <li>
      <div className="access-row">
        <div>
          <p>
            <span className="member-name">{who}</span>
            {self && <span className="meta"> (you)</span>}{' '}
            <span className={`badge role-${member.role}`}>{ROLE_LABEL[member.role]}</span>{' '}
            {member.status === 'disabled' && <span className="badge status-off">Access off</span>}
          </p>
          <p className="meta">{member.name ? `${member.email} · ` : ''}Joined {formatWhen(member.joinedAt)}</p>
        </div>
        {canManage && (
          <div className="member-controls">
            <label className="sr-only" htmlFor={`role-${member.uid}`}>Role for {who}</label>
            <select
              id={`role-${member.uid}`}
              value={confirmOwner ? 'owner' : member.role}
              disabled={busy}
              onChange={(e) => {
                // Only an owner can undo it, and they cannot undo it themselves, so it is asked first.
                if (e.target.value === 'owner') setConfirmOwner(true);
                else {
                  setConfirmOwner(false);
                  void patch({ role: e.target.value });
                }
              }}
            >
              <option value="member">{ROLE_LABEL.member}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
              {myRole === 'owner' && <option value="owner">{ROLE_LABEL.owner}</option>}
            </select>
            <button type="button" className="ghost" disabled={busy} onClick={() => void patch({ status: member.status === 'active' ? 'disabled' : 'active' })}>
              {member.status === 'active' ? 'Turn off access' : 'Turn access back on'}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
          </div>
        )}
      </div>
      {confirmOwner && (
        <div className="stack confirm notice">
          <p>
            Make {who} an owner? Owners can do everything, including managing other owners and billing. They cannot step down
            themselves; another owner has to change their role.
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void patch({ role: 'owner' })}>{busy ? 'Saving…' : `Make ${who} an owner`}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmOwner(false)}>Cancel</button>
          </div>
        </div>
      )}
      {confirmRemove && (
        <div className="stack confirm notice">
          <p>
            Remove {who} from the organization? Residents they are responsible for become unassigned. To keep things as they
            are for someone who will be back, turn off their access instead.
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void run(url, { method: 'DELETE' })}>{busy ? 'Removing…' : `Remove ${who}`}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}
