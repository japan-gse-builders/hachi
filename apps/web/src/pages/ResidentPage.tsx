import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';

export function ResidentPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const optional = (key: string, name: string) => (text(name) ? { [key]: text(name) } : {});
    const hasFamily = ['familyName', 'familySms', 'familyEmail'].some((name) => text(name));
    const body = {
      name: text('name'),
      preferredName: text('preferredName'),
      phone: text('phone'),
      callTime: text('callTime'),
      timeZone: 'Asia/Tokyo',
      vulnerability: {
        livesAlone: form.get('livesAlone') === 'on',
        hasCloseSupporter: form.get('hasCloseSupporter') === 'on',
        needsCare: form.get('needsCare') === 'on',
        chronicConditions: text('conditions') ? text('conditions').split(',').map((s) => s.trim()).filter(Boolean) : [],
      },
      ...optional('householdNotes', 'householdNotes'),
      staff: { name: text('staffName'), phone: text('staffPhone'), ...optional('sms', 'staffSms'), ...optional('email', 'staffEmail') },
      ...(hasFamily
        ? {
            family: {
              name: text('familyName'),
              ...optional('relationship', 'familyRelationship'),
              ...optional('sms', 'familySms'),
              ...optional('email', 'familyEmail'),
            },
          }
        : {}),
    };
    setBusy(true);
    setError('');
    try {
      await api('/api/residents', await token(), { method: 'POST', body: JSON.stringify(body) });
      void navigate('/residents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this resident');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Add a resident</h2>
      <p className="meta">Phone numbers include the country code, such as +81 90 1234 5678.</p>
      {error && <p className="error">{error}</p>}
      <label>Full name<input name="name" required /></label>
      <label>Name Hachi should use<input name="preferredName" required /></label>
      <label>Mobile number<input name="phone" required placeholder="+819012345678" /></label>
      <label>Daily call time<input name="callTime" required defaultValue="10:00" pattern="([01]\d|2[0-3]):[0-5]\d" /></label>
      <fieldset>
        <legend>Circumstances used for ranking</legend>
        <label className="check"><input name="livesAlone" type="checkbox" />Lives alone</label>
        <label className="check"><input name="hasCloseSupporter" type="checkbox" />Has someone nearby</label>
        <label className="check"><input name="needsCare" type="checkbox" />Needs care</label>
        <label>Ongoing conditions, separated by commas<input name="conditions" /></label>
        <label>Household notes<textarea name="householdNotes" rows={2} maxLength={1000} /></label>
      </fieldset>
      <fieldset>
        <legend>Staff in charge</legend>
        <p className="meta">Alerts go by text message or email, so enter at least one of them.</p>
        <label>Staff name<input name="staffName" required /></label>
        <label>Staff phone, for emergency calls<input name="staffPhone" required placeholder="+81312345678" /></label>
        <label>Staff mobile for text alerts<input name="staffSms" placeholder="+819012345678" /></label>
        <label>Staff email<input name="staffEmail" type="email" /></label>
      </fieldset>
      <fieldset>
        <legend>Family member (optional)</legend>
        <p className="meta">If you add one, enter a name and a mobile number or an email address.</p>
        <label>Family name<input name="familyName" /></label>
        <label>Relationship<input name="familyRelationship" placeholder="Daughter" /></label>
        <label>Family mobile<input name="familySms" placeholder="+819012345678" /></label>
        <label>Family email<input name="familyEmail" type="email" /></label>
      </fieldset>
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save resident'}</button>
    </form>
  );
}
