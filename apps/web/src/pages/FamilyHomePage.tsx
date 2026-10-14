import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { LoadError, Loading } from '../components/States';
import { useDocumentTitle } from '../title';

interface FamilyResident {
  id: string;
  name: string;
}

export function FamilyHomePage() {
  useDocumentTitle('Family');
  const { token, user, confirmEmail } = useAuth();
  const [residents, setResidents] = useState<FamilyResident[] | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // FAM-01: the API only matches contacts Firebase has verified, and a new password account is not.
  const unverified = Boolean(user && !user.emailVerified && !user.phoneNumber);
  useEffect(() => {
    if (unverified) return;
    void token()
      .then((t) => api<{ residents: FamilyResident[] }>('/api/family/residents?locale=en', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [token, unverified, attempt]);

  const sendLink = () => {
    setSending(true);
    setSendError('');
    void confirmEmail()
      .then(() => setSent(true))
      .catch(() => setSendError('We could not send the email. Please try again in a few minutes.'))
      .finally(() => setSending(false));
  };

  if (unverified) {
    return (
      <section className="card stack narrow centered">
        <h1>Confirm your email address</h1>
        {sent ? (
          <p role="status">We sent a link to {user?.email}. Open it, and you will come straight back here. Your password still works.</p>
        ) : (
          <>
            <p>Before we show you anyone&apos;s daily calls, we need to know this address is yours. We will email you a link to confirm it.</p>
            {sendError && <p className="error" role="alert">{sendError}</p>}
            <p><button type="button" disabled={sending} onClick={sendLink}>{sending ? 'Sending…' : 'Email me a link'}</button></p>
          </>
        )}
      </section>
    );
  }
  if (error) {
    return (
      <div className="narrow centered">
        <LoadError message={error} onRetry={() => { setError(''); setAttempt((n) => n + 1); }} />
      </div>
    );
  }
  if (!residents) return <div className="narrow centered"><Loading label="Loading…" /></div>;
  if (residents.length === 1) return <Navigate to={`/family/residents/${residents[0]!.id}`} replace />;
  if (residents.length === 0) {
    return (
      <section className="card stack narrow centered">
        <h1>No one is linked to this email yet</h1>
        <p>You are signed in as {user?.email}. Ask the care team to add this address as the family contact.</p>
      </section>
    );
  }
  return (
    <div className="stack page narrow centered">
      <h1>Who would you like to check on?</h1>
      <div className="tiles tiles-compact">
        {residents.map((r) => (
          <Link key={r.id} className="card card-link" to={`/family/residents/${r.id}`}>
            <span className="resident-heading">
              <ResidentAvatar id={r.id} name={r.name} />
              <h2>{r.name}</h2>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
