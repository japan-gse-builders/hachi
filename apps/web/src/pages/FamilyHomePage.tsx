import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';

interface FamilyResident {
  id: string;
  name: string;
}

export function FamilyHomePage() {
  const { token, user, sendSignInLink } = useAuth();
  const [residents, setResidents] = useState<FamilyResident[] | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // FAM-01: the API only matches contacts Firebase has verified, and a new password account is not.
  const unverified = Boolean(user && !user.emailVerified && !user.phoneNumber);
  useEffect(() => {
    if (unverified) return;
    void token()
      .then((t) => api<{ residents: FamilyResident[] }>('/api/family/residents?locale=en', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [token, unverified]);

  if (unverified) {
    return (
      <section className="card stack narrow">
        <h2>Confirm your email address</h2>
        {sent ? (
          <p>We sent a sign-in link to {user?.email}. Open it on this device; that confirms the address and signs you in.</p>
        ) : (
          <>
            <p>Before we show you anyone&apos;s daily calls, we need to know this address is yours. We will email you a link to confirm it.</p>
            <button
              type="button"
              onClick={() => {
                if (user?.email) void sendSignInLink(user.email).then(() => setSent(true));
              }}
            >
              Email me a link
            </button>
          </>
        )}
      </section>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!residents) return <p>Loading…</p>;
  if (residents.length === 1) return <Navigate to={`/family/residents/${residents[0]!.id}`} replace />;
  if (residents.length === 0) {
    return (
      <section className="card stack">
        <h2>No one is linked to this email yet</h2>
        <p>You are signed in as {user?.email}. Ask the care team to add this address as the family contact.</p>
      </section>
    );
  }
  return (
    <div className="stack narrow">
      <h2>Who would you like to check on?</h2>
      {residents.map((r) => (
        <Link key={r.id} className="card card-link" to={`/family/residents/${r.id}`}>
          <h2>{r.name}</h2>
        </Link>
      ))}
    </div>
  );
}
