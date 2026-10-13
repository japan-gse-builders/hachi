import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAccount } from '../account';
import { api } from '../api';
import { useAuth } from '../auth';
import { CallConsentField } from '../components/CallConsentField';
import { readResidentForm, ResidentFields } from '../components/ResidentFields';
import { PRIVACY_NOTICE } from '../privacy';
import { useDocumentTitle } from '../title';

export function ResidentPage() {
  useDocumentTitle('Add a resident');
  const { token } = useAuth();
  const { current } = useAccount();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      ...readResidentForm(form),
      timeZone: current?.timeZone ?? 'Asia/Tokyo',
      ...(form.get('callConsent') === 'on' ? { callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version } } : {}),
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
        <ResidentFields />
        <CallConsentField />
        {error && <p ref={errorRef} className="error" role="alert" tabIndex={-1}>{error}</p>}
        <div className="row form-actions">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save resident'}</button>
        </div>
      </form>
    </div>
  );
}
