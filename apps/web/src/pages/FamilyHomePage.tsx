import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';

interface FamilyResident {
  id: string;
  name: string;
}

export function FamilyHomePage() {
  const { token, user } = useAuth();
  const [residents, setResidents] = useState<FamilyResident[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void token()
      .then((t) => api<{ residents: FamilyResident[] }>('/api/family/residents?locale=en', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [token]);

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
