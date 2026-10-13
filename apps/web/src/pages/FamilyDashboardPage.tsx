import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AlertsCard } from '../components/AlertsCard';
import { ContactRequests } from '../components/ContactRequests';
import { FamilyDashboardView } from '../components/FamilyDashboardView';
import { LoadError, Loading } from '../components/States';
import '../styles/family.css';
import { useDocumentTitle } from '../title';
import type { FamilyDashboard } from '../types';

export function FamilyDashboardPage() {
  const { id = '' } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState<FamilyDashboard | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(data ? `Daily calls with ${data.resident.name}` : 'Daily calls');
  useEffect(() => {
    void token()
      .then((t) => api<FamilyDashboard>(`/api/family/residents/${id}/dashboard?locale=en`, t))
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load'));
  }, [id, token, attempt]);

  const body = error ? (
    <LoadError message={error} onRetry={() => { setError(''); setAttempt((n) => n + 1); }} />
  ) : data ? (
    <FamilyDashboardView data={data} now={new Date()} />
  ) : (
    <Loading layout="detail" label="Loading daily calls…" />
  );

  // Phone-call requests load alongside the dashboard and sit below it, so neither pushes the other down.
  return (
    <div className="stack page family-page">
      {body}
      <ContactRequests />
      {data && (data.receivesAlerts === false
        ? <p className="meta">Urgent alerts go to the family contact the care team has on record. You can see them here.</p>
        : <AlertsCard />)}
    </div>
  );
}
