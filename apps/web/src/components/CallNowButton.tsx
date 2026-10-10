import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { callProgressLine, isUnderWay, type CallProgress } from '../callNow';
import { phoneDisplay } from '../format';

const POLL_MS = 3000;

/**
 * Issue #13: asks Hachi to ring the resident now, through the same path as the daily call, and
 * then follows that call until it ends. `busyCallId` is the call already holding the line, if any,
 * so a page opened mid-call shows that call instead of offering a second one.
 */
export function CallNowButton({ residentId, name, phone, busyCallId }: { residentId: string; name: string; phone: string; busyCallId?: string }) {
  const { token } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [callId, setCallId] = useState<string | undefined>(busyCallId);
  const [progress, setProgress] = useState<CallProgress | null>(null);

  useEffect(() => {
    if (!callId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const p = await api<CallProgress>(`/api/residents/${residentId}/calls/${callId}`, await token());
        if (stop) return;
        setProgress(p);
        if (isUnderWay(p.status)) timer = setTimeout(() => void poll(), POLL_MS);
      } catch {
        // A missed poll is not worth an error on screen; the next one will tell.
        if (!stop) timer = setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [callId, residentId, token]);

  const call = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ callId: string }>(`/api/residents/${residentId}/calls`, await token(), { method: 'POST' });
      setProgress(null);
      setCallId(res.callId);
      setConfirming(false);
    } catch (err) {
      // Somebody else got there first: follow their call rather than report an error.
      const other = err instanceof ApiError && err.status === 409 ? (err.body as { callId?: string } | null)?.callId : undefined;
      if (other) {
        setCallId(other);
        setConfirming(false);
      } else {
        setError(err instanceof Error ? err.message : 'Could not ask Hachi to call');
      }
    } finally {
      setBusy(false);
    }
  };

  const underWay = progress ? isUnderWay(progress.status) : !!callId;
  return (
    <div className="stack call-now">
      {progress && (
        <p className={underWay ? '' : 'meta'} role="status">
          {callProgressLine(progress, name)}
        </p>
      )}
      {!underWay && !confirming && (
        <p>
          <button className="ghost" type="button" onClick={() => { setError(''); setConfirming(true); }}>Call now</button>
        </p>
      )}
      {!underWay && confirming && (
        <div className="stack confirm">
          <p>
            Ring {name} on {phoneDisplay(phone)} now? Hachi will say the care team asked it to call. The call is recorded and checked like the daily call.
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void call()}>{busy ? 'Asking…' : `Call ${name} now`}</button>
            <button className="ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
