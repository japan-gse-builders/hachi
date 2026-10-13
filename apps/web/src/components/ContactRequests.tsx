import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatWhen } from '../format';
import type { ContactRequest } from '../types';
import { LoadError } from './States';

const lastShown = new Map<string, ContactRequest[]>();

/**
 * Messages waiting on a person. The resident read a number out over the phone, so one misheard
 * digit would send their name to a stranger; either their care staff or their own family reads it
 * back against what they know and decides. Nothing shows here when there is nothing waiting.
 *
 * Nothing shows while the first load runs either: the box is usually empty, so holding a slot for it
 * would leave a gap that closes under the reader. A return visit starts from the last list this
 * person was shown, so the box is already in place instead of arriving above the page. A check that
 * fails takes one line, because a missed request is a resident left waiting.
 */
export function ContactRequests() {
  const { token, user } = useAuth();
  const uid = user?.uid ?? '';
  // useAuth hands out a new token function on every render, so loading follows the person instead.
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  });
  const [loaded, setLoaded] = useState<{ uid: string; requests: ContactRequest[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [loadError, setLoadError] = useState('');
  const requests = (loaded?.uid === uid ? loaded.requests : lastShown.get(uid)) ?? [];

  const load = useCallback(async () => {
    const data = await api<{ requests: ContactRequest[] }>('/api/contact-requests', await tokenRef.current());
    lastShown.set(uid, data.requests);
    setLoaded({ uid, requests: data.requests });
  }, [uid]);

  const refresh = useCallback(async () => {
    try {
      await load();
      setLoadError('');
    } catch {
      setLoadError('Requests for a phone call could not be checked.');
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(`${id}/${decision}`);
    setError('');
    setDone('');
    try {
      await api(`/api/contact-requests/${id}`, await token(), { method: 'POST', body: JSON.stringify({ decision }) });
      setDone(decision === 'approve' ? 'Decision saved: send the message.' : 'Decision saved: do not send the message.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that decision');
    } finally {
      setBusy('');
    }
  };

  const failed = loadError ? <LoadError compact message={loadError} onRetry={() => void refresh()} /> : null;

  // The confirmation outlives the last request, so deciding it does not make the answer vanish unread.
  if (!requests.length) return failed ?? (done ? <p className="notice-success" role="status">{done}</p> : null);

  return (
    <div className="stack">
      <h2 className="section-title">Asked for a phone call</h2>
      {failed}
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="notice-success" role="status">{done}</p>}
      <div className="tiles tiles-compact">
        {requests.map((r) => (
          <div key={r.id} className="card stack">
            <h3>{r.residentName}</h3>
            <p>
              Asked us to text <strong>{r.requestedFor}</strong> on <strong>{r.number}</strong>.
            </p>
            <p className="meta">Read the number back before you agree to it. Hachi heard it over the phone.</p>
            <p className="quote">{r.body}</p>
            <p className="meta">Asked {formatWhen(r.requestedAt)}</p>
            <div className="row tile-actions">
              <button type="button" disabled={busy.startsWith(`${r.id}/`)} onClick={() => void decide(r.id, 'approve')}>
                {busy === `${r.id}/approve` ? 'Saving…' : 'Send it'}
              </button>
              <button type="button" className="ghost" disabled={busy.startsWith(`${r.id}/`)} onClick={() => void decide(r.id, 'reject')}>
                {busy === `${r.id}/reject` ? 'Saving…' : 'Do not send'}
              </button>
            </div>
        </div>
      ))}
      </div>
    </div>
  );
}
