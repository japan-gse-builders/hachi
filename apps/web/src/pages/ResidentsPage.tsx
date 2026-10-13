import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { IncompleteAnalyses, Resident } from '../types';
import { CallConsentField } from '../components/CallConsentField';
import { IncompleteAnalysisList } from '../components/IncompleteAnalyses';
import { CallNowButton } from '../components/CallNowButton';
import { LoadError, Loading } from '../components/States';
import { ownerName, ownershipOf } from '../ownership';
import { hasCallConsent, PRIVACY_NOTICE } from '../privacy';
import { useDocumentTitle } from '../title';

/**
 * A staff call holding the line now, so the page follows it instead of offering a second call.
 * Daily calls are left out: at a shared call time they would start a poll for every resident on
 * the page. Pressing "Call now" during one is refused with its id, and the button follows it then.
 */
const liveCall = (r: Resident) =>
  r.callSlot && /-now-\d+$/.test(r.callSlot.callId) && Date.parse(r.callSlot.until) > Date.now() ? r.callSlot.callId : undefined;

export function ResidentsPage() {
  useDocumentTitle('Residents');
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [added] = useState((location.state as { added?: string } | null)?.added);
  // Shown once: a reload or a return visit should not announce the same resident again.
  useEffect(() => {
    if (added) void navigate('.', { replace: true, state: null });
  }, [added, navigate]);
  const [residents, setResidents] = useState<Resident[] | null>(null);
  const [error, setError] = useState('');
  const [failedId, setFailedId] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<IncompleteAnalyses | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void token()
      .then((t) => api<{ residents: Resident[] }>('/api/residents', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load residents'));
    // Secondary: the residents still show if this list cannot be loaded.
    void token()
      .then((t) => api<IncompleteAnalyses>('/api/incomplete-analyses?locale=en', t))
      .then(setIncomplete)
      .catch(() => setIncomplete(null));
  }, [token, attempt]);

  // USR-04: a JSON file of {"calls": [{startedAt, endedAt, transcript}]} for demos and baselines.
  const importCalls = async (residentId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const show = (message: string) => setImported((prev) => ({ ...prev, [residentId]: message }));
    try {
      const body = JSON.stringify(JSON.parse(await file.text()));
      const result = await api<{ imported: number; usableForBaseline: number }>(
        `/api/residents/${residentId}/calls/import`,
        await token(),
        { method: 'POST', body },
      );
      show(`Imported ${result.imported} calls, ${result.usableForBaseline} usable for the speech baseline.`);
    } catch (err) {
      show(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Import failed');
    }
  };

  /** Only reflect a permission, call-status or ownership change after the server has saved it. */
  const updateResident = async (residentId: string, patch: object | 'take-on'): Promise<boolean> => {
    setError('');
    setFailedId(null);
    setBusyId(residentId);
    try {
      const saved = patch === 'take-on'
        ? await api<Resident>(`/api/residents/${residentId}/owner`, await token(), { method: 'POST' })
        : await api<Resident>(`/api/residents/${residentId}`, await token(), { method: 'PATCH', body: JSON.stringify(patch) });
      setResidents((prev) => prev?.map((r) => (r.id === residentId ? saved : r)) ?? prev);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      setFailedId(residentId);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const retry = () => {
    setError('');
    setAttempt((n) => n + 1);
  };

  return (
    <div className="stack page">
      <header className="page-header">
        <div>
          <h1>Residents</h1>
          {residents && <p className="meta">{residents.length} {residents.length === 1 ? 'resident' : 'residents'} registered with the care team.</p>}
        </div>
        <Link className="button" to="/staff/residents/new">Add resident</Link>
      </header>
      {added && <p className="notice-success" role="status">{added} was added.</p>}
      {/* A failed save shows on its own resident, where the person who pressed the button is looking. */}
      {error && !failedId && (residents ? <p className="error" role="alert">{error}</p> : <LoadError message={error} onRetry={retry} />)}
      {residents === null && !error && <Loading layout="tiles" label="Loading residents…" />}
      {residents && residents.length === 0 && (
        <div className="card stack empty">
          <h2>No residents yet</h2>
          <p>Add a resident to start their daily check-in calls.</p>
          <p><Link className="button" to="/staff/residents/new">Add resident</Link></p>
        </div>
      )}
      {residents && residents.length > 0 && (
        <div className="tiles">
          {residents.map((r) => {
            const ownership = ownershipOf(r, user?.uid);
            const mine = ownership === 'mine';
            return (
            <article className="card resident-tile" key={r.id}>
              <div className="tile-top">
                <h2><Link to={`/staff/residents/${r.id}`}>{r.name}</Link></h2>
                <span className={`badge ${r.active ? 'state-active' : 'watch'}`}>{r.active ? 'Active' : 'Inactive'}</span>
              </div>
              <p className="meta">{[r.preferredName, r.phone, `daily call ${r.callTime}`].filter(Boolean).join(' · ')}</p>
              <p className="meta">Resident {r.id}</p>
              <div className="tile-owner">
                {ownership === 'unassigned' ? (
                  <>
                    <span className="badge watch">Nobody responsible</span>
                    <p><button className="ghost" type="button" disabled={busyId !== null} onClick={() => void updateResident(r.id, 'take-on')}>
                      {busyId === r.id ? 'Saving…' : 'Take on'}
                    </button></p>
                  </>
                ) : (
                  <p className="meta">Responsible: {mine ? <strong>you</strong> : ownerName(r.owner!)}</p>
                )}
                <p className="meta">
                  <Link to={`/staff/residents/${r.id}`}>Family access{r.familyAccess?.length ? ` (${r.familyAccess.length})` : ''}</Link>
                </p>
              </div>
              {incomplete && <IncompleteAnalysisList items={incomplete.items.filter((i) => i.residentId === r.id)} showResident={false} />}
              {hasCallConsent(r.callConsent) ? (
                <p className="meta">First-use approval recorded on {new Date(r.callConsent!.recordedAt).toLocaleDateString('en-GB')}.</p>
              ) : (
                <div className="stack notice notice-warning">
                  <p role="status"><strong>Approval needed.</strong> Daily calls will wait until the resident agrees.</p>
                  {mine && consentFor !== r.id && <p><button type="button" disabled={busyId !== null} onClick={() => setConsentFor(r.id)}>Record first-use approval</button></p>}
                  {!mine && <p className="meta">{r.owner ? `${ownerName(r.owner)} can record it.` : 'Take them on to record it.'}</p>}
                  {consentFor === r.id && (
                    <form className="stack" onSubmit={(event) => {
                      event.preventDefault();
                      if (new FormData(event.currentTarget).get('callConsent') !== 'on') return;
                      void updateResident(r.id, { callConsent: { accepted: true, noticeVersion: PRIVACY_NOTICE.version } })
                        .then((saved) => { if (saved) setConsentFor(null); });
                    }}>
                      <CallConsentField required />
                      <div className="row">
                        <button type="submit" disabled={busyId !== null}>{busyId === r.id ? 'Saving…' : 'Save approval'}</button>
                        <button className="ghost" type="button" disabled={busyId !== null} onClick={() => setConsentFor(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              )}
              {failedId === r.id && error && <p className="error" role="alert">{error}</p>}
              <div className="tile-actions">
                {r.active && hasCallConsent(r.callConsent) && (
                  <CallNowButton residentId={r.id} name={r.preferredName || r.name} phone={r.phone} busyCallId={liveCall(r)} />
                )}
                {mine && (
                  <p><button className="ghost" type="button" disabled={busyId !== null || (!r.active && !hasCallConsent(r.callConsent))}
                    onClick={() => void updateResident(r.id, { active: !r.active })}>{busyId === r.id && consentFor !== r.id ? 'Saving…' : r.active ? 'Pause calls' : 'Resume calls'}</button></p>
                )}
              </div>
              <div className="tile-footer">
                <label className="file">Import past calls (JSON)
                  <input type="file" accept="application/json,.json" onChange={(e) => void importCalls(r.id, e)} />
                  <span className="button ghost">Choose a file</span>
                </label>
                {imported[r.id] && <p className="meta" role="status">{imported[r.id]}</p>}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
