import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ContactRequests } from '../components/ContactRequests';
import { deliveryLabel, formatWhen, urgencyTone } from '../format';
import type { Queue, Spend } from '../types';

export function QueuePage() {
  const { token } = useAuth();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const t = await token();
        const [data, money] = await Promise.all([api<Queue>('/api/queue?locale=en', t), api<Spend | null>('/api/spend?locale=en', t)]);
        if (!stop) {
          setQueue(data);
          setSpend(money);
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
      {/* Staff are the ones who get asked why nobody was called today, so they can see the answer. */}
      {spend?.paused && (
        <p className="card card-emergency">
          <strong>Check-in calls have stopped.</strong> {spend.note}
        </p>
      )}
      {/* Above the cases on purpose: a resident with no case at all may be the one to worry about. */}
      {queue?.unreached && queue.unreached.items.length > 0 && (
        <div className="card card-emergency stack">
          <p>
            <strong>Nobody has been reached.</strong> {queue.unreached.note}
          </p>
          <ul className="legend" aria-label="Residents nobody has spoken to">
            {queue.unreached.items.map((u) => (
              <li key={`${u.residentId}-${u.localDate}`}>
                <Link to={`/staff/residents/${u.residentId}`}>{u.residentName}</Link>{' '}
                <span className="badge watch">{u.reasonLabel}</span> {u.meaning}
                <span className="meta">
                  {u.localDate} · {u.tried}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <h2>Needs attention</h2>
      {/* A card shows only its own level, so the whole scale is spelled out once, in reading order. */}
      {queue && queue.legend.length > 0 && (
        <ul className="legend" aria-label="What each urgency level asks of you">
          {queue.legend.map((l) => (
            <li key={l.urgency}>
              <span className={`badge ${urgencyTone(l.urgency)}`}>{l.label}</span> {l.action}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {queue === null && !error && <p>Loading…</p>}
      {queue?.items.length === 0 && <p className="card">No open cases. New calls appear here after they are reviewed.</p>}
      {queue?.items.map((item) => (
        <Link key={item.caseId} className={`card card-link ${item.urgency === 'emergency' ? 'card-emergency' : ''}`} to={`/staff/cases/${item.caseId}`}>
          <span className={`badge ${urgencyTone(item.urgency)}`} title={item.urgencyMeaning}>{item.urgencyLabel}</span>
          <h2>{item.residentName}</h2>
          <p className="meta">Resident {item.residentId}</p>
          <p>{item.summary}</p>
          <p className="reason">{item.reason}</p>
          <p className="meta">{item.rule} · {item.statusLabel} · {formatWhen(item.detectedAt)}</p>
          {item.notifications.length > 0 && (
            <p className="meta">
              Notified {item.notifications.map((n) => `${n.recipient} by ${n.channel} (${deliveryLabel(n.delivery)})`).join(', ')} ·{' '}
              {formatWhen(item.notifications[0]!.sentAt)}
            </p>
          )}
        </Link>
      ))}
      {spend && !spend.paused && (
        <p className="meta">
          {spend.note} {spend.inFlight !== '$0.00' && `${spend.inFlight} is held by calls in progress.`}
        </p>
      )}
    </div>
  );
}
