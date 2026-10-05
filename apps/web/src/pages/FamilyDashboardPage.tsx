import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AlertsCard } from '../components/AlertsCard';
import { FamilyDashboardView } from '../components/FamilyDashboardView';
import type { FamilyDashboard } from '../types';

export function FamilyDashboardPage() {
  const { id = '' } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<FamilyDashboard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void token()
      .then((t) => api<FamilyDashboard>(`/api/family/residents/${id}/dashboard?locale=en`, t))
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [id, token]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div className="stack">
      <FamilyDashboardView data={data} now={new Date()} />
      <AlertsCard />
    </div>
  );
}
