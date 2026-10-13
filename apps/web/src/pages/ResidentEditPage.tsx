import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { readResidentForm, ResidentFields } from '../components/ResidentFields';
import { LoadError, Loading } from '../components/States';
import { ownerName, ownershipOf } from '../ownership';
import { useDocumentTitle } from '../title';
import type { Resident } from '../types';

/** The responsible staff member changing a resident's details and who is contacted about them. */
export function ResidentEditPage() {
  const { id = '' } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [resident, setResident] = useState<Resident | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useDocumentTitle(resident ? `${resident.name} · Edit details` : 'Edit details');

  useEffect(() => {
    setLoadError('');
    void token()
      .then((t) => api<Resident>(`/api/residents/${encodeURIComponent(id)}`, t))
      .then(setResident)
      .catch((err: unknown) => setLoadError(err instanceof ApiError && err.status === 404
        ? 'This resident is not registered, or the link is out of date.'
        : err instanceof Error ? err.message : 'Could not load this resident'));
  }, [id, token, attempt]);

  const detailLink = `/staff/residents/${encodeURIComponent(id)}`;
  const back = (
    <p className="back-link">
      <Link to={detailLink}><span aria-hidden="true">← </span>Back to {resident?.name ?? 'the resident'}</Link>
    </p>
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = readResidentForm(new FormData(event.currentTarget), { clearing: true });
    setBusy(true);
    setError('');
    try {
      await api<Resident>(`/api/residents/${encodeURIComponent(id)}`, await token(), { method: 'PATCH', body: JSON.stringify(body) });
      void navigate(detailLink, { state: { saved: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these details');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="stack page narrow">{back}<LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} /></div>;
  if (!resident) return <div className="stack page narrow">{back}<Loading layout="detail" label="Loading resident…" /></div>;

  const ownership = ownershipOf(resident, user?.uid);
  if (ownership !== 'mine') {
    return (
      <div className="stack page narrow">
        {back}
        <section className="card stack">
          <h1>Edit {resident.name}</h1>
          <p>
            {ownership === 'theirs'
              ? `Only ${ownerName(resident.owner!)}, who is responsible for ${resident.preferredName || resident.name}, can change these details.`
              : `Nobody is responsible for ${resident.preferredName || resident.name} yet. Take them on to change these details.`}
          </p>
          <p><Link to={detailLink}>Go to {resident.name}</Link></p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack page narrow">
      {back}
      <form className="card stack resident-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
        <h1>Edit {resident.name}</h1>
        <p className="meta">Changes apply from the next call and the next alert. Phone numbers include the country code, such as +81 90 1234 5678.</p>
        <ResidentFields resident={resident} />
        {error && <p ref={errorRef} className="error" role="alert" tabIndex={-1}>{error}</p>}
        <div className="row form-actions">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <Link className="button ghost" to={detailLink}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
