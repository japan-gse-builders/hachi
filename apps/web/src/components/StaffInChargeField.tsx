import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAccount } from '../account';
import { api } from '../api';
import { useAuth } from '../auth';
import { phoneDisplay } from '../format';
import { atLeast, memberLabel, type Member } from '../orgs';
import type { Resident } from '../types';

/**
 * The staff member in charge is whoever is responsible for the patient, so it is always someone on
 * the team: picked from it when adding a patient (by an admin; others add patients for themselves),
 * and changed afterwards by changing who is responsible, never by typing a contact in.
 */
export function StaffInChargeField({ resident }: { resident?: Resident }) {
  return (
    <fieldset>
      <legend>Staff in charge</legend>
      {resident ? <CurrentStaff resident={resident} /> : <ChooseStaff />}
    </fieldset>
  );
}

function contactLine(c: { name?: string | null; phone?: string | null; sms?: string | null; email?: string | null }): string {
  return [c.name, c.phone && `phone ${phoneDisplay(c.phone)}`, c.sms && `texts ${phoneDisplay(c.sms)}`, c.email].filter(Boolean).join(' · ');
}

function CurrentStaff({ resident }: { resident: Resident }) {
  const who = resident.name;
  return (
    <>
      <p>{resident.staff ? contactLine(resident.staff) : 'Nobody yet.'}</p>
      <p className="meta">
        Alerts go to the staff member responsible for {who}, at the numbers on their account. To change who that is, change
        the <Link to={`/staff/residents/${encodeURIComponent(resident.id)}`}>responsible staff member</Link>.
      </p>
    </>
  );
}

function ChooseStaff() {
  const { token } = useAuth();
  const { me, current } = useAccount();
  const isAdmin = atLeast(current?.role, 'admin');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void token()
      .then((t) => api<{ members: Member[] }>('/api/organization/members', t))
      .then((res) => {
        if (!live) return;
        const active = res.members.filter((m) => m.status === 'active');
        setMembers(active);
        const self = active.find((m) => m.uid === me?.uid && m.canBeInCharge);
        setChoice((self ?? active.find((m) => m.canBeInCharge))?.uid ?? '');
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Could not load the team'));
    return () => { live = false; };
  }, [isAdmin, token, me?.uid]);

  const addPhone = <Link to="/staff/account">add your phone number in Your account</Link>;

  if (!isAdmin) {
    return me?.phone ? (
      <>
        <p>You: {contactLine({ name: me.name, phone: me.phone, sms: me.sms, email: me.email })}</p>
        <p className="meta">You will be responsible for this patient, and their alerts come to you. You can hand them over later.</p>
      </>
    ) : (
      <p className="notice notice-warning" role="status">You will be in charge of this patient, so first {addPhone}. Alerts about them go to it.</p>
    );
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!members) return <p className="meta">Loading the team…</p>;
  const ready = members.filter((m) => m.canBeInCharge);
  return (
    <>
      <label>
        Responsible staff member
        <select name="staffUid" required value={choice} onChange={(e) => setChoice(e.target.value)}>
          {ready.length === 0 && <option value="">Nobody on the team has a phone number yet</option>}
          {members.map((m) => (
            <option key={m.uid} value={m.uid} disabled={!m.canBeInCharge}>
              {memberLabel(m)}{m.uid === me?.uid ? ' (you)' : ''}{m.canBeInCharge ? '' : ' (no phone number yet)'}
            </option>
          ))}
        </select>
      </label>
      <p className="meta">
        Only members of the team can be chosen. They become responsible for this patient, and alerts go to the phone,
        mobile and email on their account.
      </p>
      {!me?.phone && <p className="meta">To choose yourself, {addPhone}.</p>}
    </>
  );
}
