import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ContactRequests } from '../components/ContactRequests';
import { deliveryLabel, formatWhen, urgencyTone } from '../format';
import type { QueueItem } from '../types';

export function QueuePage() {
  const { token } = useAuth();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const data = await api<{ items: QueueItem[] }>('/api/queue?locale=en', await token());
        if (!stop) {
          setItems(data.items);
          setError('');
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : 'Could not load the queue');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [token]);

  return (
    <div className="stack tiles">
      <ContactRequests />
      <h2>Needs attention</h2>
      {error && <p className="error">{error}</p>}
      {items === null && !error && <p>Loading…</p>}
      {items?.length === 0 && <p className="card">No open cases. New calls appear here after they are reviewed.</p>}
      {items?.map((item) => (
        <Link key={item.caseId} className={`card card-link ${item.urgency === 'emergency' ? 'card-emergency' : ''}`} to={`/staff/cases/${item.caseId}`}>
          <span className={`badge ${urgencyTone(item.urgency)}`}>{item.urgencyLabel}</span>
          <h2>{item.residentName}</h2>
          <p className="meta">Resident {item.residentId}</p>
          <p>{item.summary}</p>
          <p className="reason">{item.reason}</p>
          <p className="meta">{item.rule} · {item.status.replace('_', ' ')} · {formatWhen(item.detectedAt)}</p>
          {item.notifications.length > 0 && (
            <p className="meta">
              Notified {item.notifications.map((n) => `${n.recipient} by ${n.channel} (${deliveryLabel(n.delivery)})`).join(', ')} ·{' '}
              {formatWhen(item.notifications[0]!.sentAt)}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
