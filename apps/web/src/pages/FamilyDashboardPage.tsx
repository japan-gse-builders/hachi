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
  return <FamilyView key={id} id={id} />;
}

function FamilyView({ id }: { id: string }) {
  const { token } = useAuth();
  const [data, setData] = useState<FamilyDashboard | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(data ? `Daily calls with ${data.resident.name}` : 'Daily calls');
  useEffect(() => {
    const abort = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const path = `/api/family/residents/${encodeURIComponent(id)}/dashboard?locale=en`;
        const next = await api<FamilyDashboard>(path, await token(), { signal: abort.signal });
        if (!abort.signal.aborted) {
          setData(next);
          setError('');
        }
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load daily calls');
      } finally {
        loading = false;
      }
    };
    const refresh = () => void load();
    refresh();
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, token, attempt]);

  return (
    <div className="stack page family-page">
      {error && <LoadError compact={!!data} message={data ? 'Could not refresh today’s call status.' : error}
        onRetry={() => { setError(''); setAttempt((n) => n + 1); }} />}
      {data && <FamilyDashboardView data={data} now={new Date()} />}
      {!data && !error && <Loading layout="detail" label="Loading daily calls…" />}
      <ContactRequests />
      {data && (data.receivesAlerts === false
        ? <p className="meta">Urgent alerts go to the family contact the care team has on record. You can see them here.</p>
        : <AlertsCard />)}
    </div>
  );
}
