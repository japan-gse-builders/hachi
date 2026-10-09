import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatWhen } from '../format';
import type { ContactRequest } from '../types';

/**
 * Messages waiting on a person. The resident read a number out over the phone, so one misheard
 * digit would send their name to a stranger; either their care staff or their own family reads it
 * back against what they know and decides. Nothing shows here when there is nothing waiting.
 */
export function ContactRequests() {
  const { token } = useAuth();
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const data = await api<{ requests: ContactRequest[] }>('/api/contact-requests', await token());
    setRequests(data.requests);
  }, [token]);

  useEffect(() => {
    // A request that cannot be loaded is not worth an error on a page about something else.
    void load().catch(() => undefined);
  }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    setError('');
    try {
      await api(`/api/contact-requests/${id}`, await token(), { method: 'POST', body: JSON.stringify({ decision }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that decision');
    } finally {
      setBusy('');
    }
  };

  if (!requests.length) return null;

  return (
    <div className="stack">
      <h2>Asked for a phone call</h2>
      {error && <p className="error">{error}</p>}
      <div className="tiles tiles-compact">
        {requests.map((r) => (
          <div key={r.id} className="card">
            <h2>{r.residentName}</h2>
            <p>
              Asked us to text <strong>{r.requestedFor}</strong> on <strong>{r.number}</strong>.
            </p>
            <p className="meta">Read the number back before you agree to it. Hachi heard it over the phone.</p>
            <p className="quote">{r.body}</p>
            <p className="meta">Asked {formatWhen(r.requestedAt)}</p>
            <div className="row">
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r.id, 'approve')}>
                Send it
              </button>
              <button type="button" className="ghost" disabled={busy === r.id} onClick={() => void decide(r.id, 'reject')}>
                Do not send
              </button>
            </div>
        </div>
      ))}
      </div>
    </div>
  );
}
