import { useEffect, useRef, useState } from 'react';
import { apiBlob, ApiError } from '../api';
import { useAuth } from '../auth';
import { audioAt } from '../format';
import type { CallMedia } from '../types';

export const expiredMediaLabel = 'Recording and transcript retention ended.';

export function isMediaExpired(media: CallMedia | undefined, now: Date): boolean {
  return Boolean(media?.expired || (media?.expiresAt && Date.parse(media.expiresAt) <= now.getTime()));
}

export function RecordingPlayer({ residentId, callId, startMs }: { residentId: string; callId: string; startMs?: number | undefined }) {
  const { token } = useAuth();
  const active = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  useEffect(() => () => {
    active.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const load = async () => {
    const abort = new AbortController();
    active.current = abort;
    setBusy(true);
    setError('');
    try {
      const path = `/api/residents/${encodeURIComponent(residentId)}/calls/${encodeURIComponent(callId)}/recording`;
      const blob = await apiBlob(path, await token(), { signal: abort.signal });
      if (abort.signal.aborted) return;
      objectUrl.current = URL.createObjectURL(blob);
      setUrl(objectUrl.current);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && err.reason === 'media_expired') setExpired(true);
      else setError(err instanceof Error ? err.message : 'Could not load the recording.');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };

  if (expired) return <p className="meta" role="status">{expiredMediaLabel}</p>;
  if (url) return (
    <audio controls preload="metadata" aria-label="Call recording" src={audioAt(url, startMs)}>
      <track kind="captions" />
    </audio>
  );
  return (
    <div className="stack stack-s">
      <div><button type="button" className="ghost" disabled={busy} onClick={() => void load()}>{busy ? 'Loading recording…' : 'Load recording'}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
