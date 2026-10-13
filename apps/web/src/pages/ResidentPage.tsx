import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { CallConsentField } from '../components/CallConsentField';
import { PRIVACY_NOTICE } from '../privacy';
import { useDocumentTitle } from '../title';

export function ResidentPage() {
  useDocumentTitle('Add a resident');
  const { token } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

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
      ...(form.get('callConsent') === 'on' ? { callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version } } : {}),
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
      void navigate('/staff/residents', { state: { added: body.name } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this resident');
      // Everything typed stays in the form; only the message is new, so that is where focus goes.
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack page narrow">
      <p className="back-link"><Link to="/staff/residents"><span aria-hidden="true">← </span>Back to residents</Link></p>
      {/* These are the resident's details, not the signed-in staff member's, so the browser should not fill them. */}
      <form className="card stack resident-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
        <h1>Add a resident</h1>
        <p className="meta">Fields marked optional can be left empty. Phone numbers include the country code, such as +81 90 1234 5678.</p>
        <fieldset>
          <legend>Resident</legend>
          <div className="field-grid">
            <label>Full name<input name="name" required /></label>
            <label>Name Hachi should use<input name="preferredName" required /></label>
            <label>Mobile number<input name="phone" type="tel" required placeholder="+819012345678" spellCheck={false} /></label>
            <label>Daily call time
              <input name="callTime" required defaultValue="10:00" pattern="([01]\d|2[0-3]):[0-5]\d" title="Use 24-hour time, such as 09:30" aria-describedby="call-time-hint" />
              <span id="call-time-hint" className="hint">24-hour time, Japan time</span>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Circumstances used for ranking</legend>
          <div className="checks">
            <label className="check"><input name="livesAlone" type="checkbox" />Lives alone</label>
            <label className="check"><input name="hasCloseSupporter" type="checkbox" />Has someone nearby</label>
            <label className="check"><input name="needsCare" type="checkbox" />Needs care</label>
          </div>
          <label><span>Ongoing conditions, separated by commas <span className="hint">(optional)</span></span><input name="conditions" /></label>
          <label><span>Household notes <span className="hint">(optional)</span></span><textarea name="householdNotes" rows={2} maxLength={1000} /></label>
        </fieldset>
        <fieldset>
          <legend>Staff in charge</legend>
          <p className="meta">Alerts go by text message or email, so enter at least one of them.</p>
          <div className="field-grid">
            <label>Staff name<input name="staffName" required /></label>
            <label>Staff phone, for emergency calls<input name="staffPhone" type="tel" required placeholder="+81312345678" spellCheck={false} /></label>
            <label>Staff mobile for text alerts<input name="staffSms" type="tel" placeholder="+819012345678" spellCheck={false} /></label>
            <label>Staff email<input name="staffEmail" type="email" spellCheck={false} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Family member (optional)</legend>
          <p className="meta">If you add one, enter a name and a mobile number or an email address.</p>
          <div className="field-grid">
            <label>Family name<input name="familyName" /></label>
            <label>Relationship<input name="familyRelationship" placeholder="Daughter" /></label>
            <label>Family mobile<input name="familySms" type="tel" placeholder="+819012345678" spellCheck={false} /></label>
            <label>Family email<input name="familyEmail" type="email" spellCheck={false} /></label>
          </div>
        </fieldset>
        <CallConsentField />
        {error && <p ref={errorRef} className="error" role="alert" tabIndex={-1}>{error}</p>}
        <div className="row form-actions">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save resident'}</button>
        </div>
      </form>
    </div>
  );
}
