import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Resident } from '../types';
import { CallConsentField } from '../components/CallConsentField';
import { CallNowButton } from '../components/CallNowButton';
import { hasCallConsent, PRIVACY_NOTICE } from '../privacy';

/** The call holding the line now, so the page follows it instead of offering a second call. */
const liveCall = (r: Resident) => (r.callSlot && Date.parse(r.callSlot.until) > Date.now() ? r.callSlot.callId : undefined);

export function ResidentsPage() {
  const { token } = useAuth();
  const [residents, setResidents] = useState<Resident[] | null>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<Record<string, string>>({});
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    void token()
      .then((t) => api<{ residents: Resident[] }>('/api/residents', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load residents'));
  }, [token]);

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

  /** Only reflect a permission or call-status change after the server has saved it. */
  const updateResident = async (residentId: string, patch: object): Promise<boolean> => {
    setError('');
    setBusyId(residentId);
    try {
      const saved = await api<Resident>(`/api/residents/${residentId}`, await token(), {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setResidents((prev) => prev?.map((r) => (r.id === residentId ? saved : r)) ?? prev);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <h1>Residents</h1>
        <Link className="button" to="/staff/residents/new">Add resident</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {residents && residents.length > 0 && (
        <div className="tiles">
          {residents.map((r) => (
            <article className="card" key={r.id}>
              <h2>{r.name}</h2>
              <p className="meta">{[r.preferredName, r.phone, `daily call ${r.callTime}`, r.active ? 'active' : 'inactive'].filter(Boolean).join(' · ')}</p>
              <p className="meta">Resident {r.id}</p>
              {hasCallConsent(r.callConsent) ? (
                <p className="meta">First-use approval recorded on {new Date(r.callConsent!.recordedAt).toLocaleDateString('en-GB')}.</p>
              ) : (
                <>
                  <p role="status">Approval needed. Daily calls will wait until the resident agrees.</p>
                  {consentFor !== r.id && <button type="button" disabled={busyId !== null} onClick={() => setConsentFor(r.id)}>Record first-use approval</button>}
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
                </>
              )}
              {r.active && hasCallConsent(r.callConsent) && (
                <CallNowButton residentId={r.id} name={r.preferredName || r.name} phone={r.phone} busyCallId={liveCall(r)} />
              )}
              <p><button className="ghost" type="button" disabled={busyId !== null || (!r.active && !hasCallConsent(r.callConsent))}
                onClick={() => void updateResident(r.id, { active: !r.active })}>{r.active ? 'Pause calls' : 'Resume calls'}</button></p>
              <label className="file">Import past calls (JSON)
                <input type="file" accept="application/json,.json" onChange={(e) => void importCalls(r.id, e)} />
                <span className="button ghost">Choose a file</span>
              </label>
              {imported[r.id] && <p className="meta" role="status">{imported[r.id]}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
