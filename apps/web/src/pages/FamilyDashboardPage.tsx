import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AlertsCard } from '../components/AlertsCard';
import { channelList, familyDeliveryList, formatWhen, minutes } from '../format';
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
  const { staff } = data;

  return (
    <div className="stack">
      <section className="card">
        <h2>Daily calls with {data.resident.name}</h2>
        <p>{data.nextCallAt ? `Next call: ${formatWhen(data.nextCallAt)}` : 'Daily calls are paused.'}</p>
        <p className="meta">Times are Japan time. Hachi calls once a day for a short chat.</p>
      </section>

      {data.alerts.length > 0 && (
        <section className="card">
          <h2>Alerts sent to you</h2>
          {data.alerts.map((a) => (
            <p key={a.sentAt}>
              {formatWhen(a.sentAt)} · by {a.deliveries ? familyDeliveryList(a.deliveries) : channelList(a.channels)} ·{' '}
              <strong>{a.caseStatusLabel}</strong>
            </p>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Care team</h2>
        <p>{staff.name}</p>
        <div className="row">
          <a className="button" href={`tel:${staff.phone}`}>Call {staff.phone}</a>
          {staff.email && <a className="button ghost" href={`mailto:${staff.email}`}>Email</a>}
        </div>
      </section>

      <section className="card">
        <h2>The last two weeks</h2>
        {data.calls.length === 0 && <p className="meta">No calls yet.</p>}
        <div className="calls">
          {data.calls.map((c) => (
            <article key={c.startedAt}>
              <p className="meta">
                {formatWhen(c.startedAt)} · {c.connected ? `Talked${c.durationSec !== null ? ` for ${minutes(c.durationSec)}` : ''}` : 'Did not connect'}
              </p>
              {c.summary && (
                <>
                  <p><strong>Health.</strong> {c.summary.health}</p>
                  <p><strong>Meals.</strong> {c.summary.meals}</p>
                  {c.summary.topics.length > 0 && <p><strong>Talked about.</strong> {c.summary.topics.join(', ')}</p>}
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      <AlertsCard />
    </div>
  );
}
