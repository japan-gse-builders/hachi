import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { IncompleteAnalyses, Queue, Resident } from '../types';
import { CallConsentField } from '../components/CallConsentField';
import { IncompleteAnalysisList } from '../components/IncompleteAnalyses';
import { CallNowButton } from '../components/CallNowButton';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { IndicatorBar, SeverityChip, SignalsLegend } from '../components/Signals';
import { LoadError, Loading } from '../components/States';
import { phoneDisplay } from '../format';
import { ownerName, ownershipOf } from '../ownership';
import { hasCallConsent, PRIVACY_NOTICE } from '../privacy';
import { knownSignals, needsAttention, residentChips } from '../queue';
import { bySeverity, uncheckedFor, worstSeverity } from '../signals';
import { useDocumentTitle } from '../title';
import '../styles/residents.css';

/**
 * A staff call holding the line now, so the page follows it instead of offering a second call.
 * Daily calls are left out: at a shared call time they would start a poll for every resident on
 * the page. Pressing "Call now" during one is refused with its id, and the button follows it then.
 */
const liveCall = (r: Resident) =>
  r.callSlot && /-now-\d+$/.test(r.callSlot.callId) && Date.parse(r.callSlot.until) > Date.now() ? r.callSlot.callId : undefined;

/** A resident's chips and indicator inputs from the lists on this page; null lists did not load. */
function glanceOf(r: Resident, queue: Queue | null, incomplete: IncompleteAnalyses | null, now: Date) {
  const unreached = queue?.unreached?.items.find((u) => u.residentId === r.id);
  const unchecked = uncheckedFor(incomplete ?? undefined, r.id);
  const signals = knownSignals(r.signals, { unreached, unchecked });
  const chips = residentChips(r, { cases: queue?.items, reach: signals?.reach ?? unreached, unchecked }, now);
  return { signals, chips, severity: worstSeverity(chips.map((c) => c.severity)) };
}

export function ResidentsPage() {
  useDocumentTitle('Patients');
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [added] = useState((location.state as { added?: string } | null)?.added);
  // Shown once: a reload or a return visit should not announce the same resident again.
  useEffect(() => {
    if (added) void navigate('.', { replace: true, state: null });
  }, [added, navigate]);
  const [residents, setResidents] = useState<Resident[] | null>(null);
  // As loaded, so the order stays put while somebody saves a change on a card.
  const [listed, setListed] = useState<Resident[] | null>(null);
  const [error, setError] = useState('');
  const [failedId, setFailedId] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<IncompleteAnalyses | null>(null);
  const [incompleteError, setIncompleteError] = useState('');
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueError, setQueueError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [extraAttempt, setExtraAttempt] = useState(0);
  useEffect(() => {
    void token()
      .then((t) => api<{ residents: Resident[] }>('/api/residents', t))
      .then((data) => {
        setResidents(data.residents);
        setListed(data.residents);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load patients'));
  }, [token, attempt]);
  // Secondary: the residents still show if these cannot be loaded, with a line saying what is missing.
  useEffect(() => {
    void token()
      .then((t) => api<IncompleteAnalyses>('/api/incomplete-analyses?locale=en', t))
      .then((data) => {
        setIncomplete(data);
        setIncompleteError('');
      })
      .catch(() => {
        setIncomplete(null);
        setIncompleteError('Calls that were not fully checked could not be loaded.');
      });
    void token()
      .then((t) => api<Queue>('/api/queue?locale=en', t))
      .then((data) => {
        setQueue(data);
        setQueueError('');
      })
      .catch(() => {
        setQueue(null);
        setQueueError('Open cases and missed calls could not be loaded.');
      });
  }, [token, attempt, extraAttempt]);

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
      // Write responses leave out `signals`; keep the ones the list came with.
      setResidents((prev) => prev?.map((r) => (r.id === residentId ? { ...saved, signals: saved.signals ?? r.signals } : r)) ?? prev);
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
  const retryExtra = () => setExtraAttempt((n) => n + 1);

  const settled = listed !== null && (queue !== null || Boolean(queueError)) && (incomplete !== null || Boolean(incompleteError));
  const now = new Date();
  const order = useMemo(() => {
    if (!settled || !listed) return null;
    const at = new Date();
    return listed
      .map((r) => ({ id: r.id, severity: glanceOf(r, queue, incomplete, at).severity }))
      .sort((a, b) => bySeverity(a.severity, b.severity));
  }, [settled, listed, queue, incomplete]);
  const byId = new Map((residents ?? []).map((r) => [r.id, r]));
  const ranked = (order ?? []).flatMap((o) => (byId.has(o.id) ? [{ r: byId.get(o.id)!, attention: needsAttention(o.severity) }] : []));
  const groups = [
    { key: 'attention', title: 'Need attention', items: ranked.filter((x) => x.attention) },
    { key: 'rest', title: 'Nothing to do right now', items: ranked.filter((x) => !x.attention) },
  ].filter((g) => g.items.length > 0);

  const card = (r: Resident) => {
    const ownership = ownershipOf(r, user?.uid);
    const mine = ownership === 'mine';
    const { signals, chips, severity } = glanceOf(r, queue, incomplete, now);
    return (
      <article className={`card residents-card residents-stripe sev-${severity}${signals ? ' has-signals' : ''}`} key={r.id}>
        <div className="residents-who">
          <h3 className="resident-heading">
            <ResidentAvatar id={r.id} name={r.name} portrait={r.portrait} />
            <Link to={`/staff/residents/${r.id}`}>{r.name}</Link>
          </h3>
          <p className="meta">
            {r.preferredName && <>{r.preferredName} · </>}
            <a href={`tel:${r.phone}`}>{phoneDisplay(r.phone)}</a> · daily call {r.callTime}
          </p>
          {chips.length > 0 && (
            <ul className="residents-chips" aria-label="At a glance">
              {chips.map((c) => (
                <li key={c.key}>
                  {/* Only how long since a call got through says more with the level read first. */}
                  <SeverityChip spoken={c.key === 'reach' ? undefined : false} severity={c.severity} label={c.word} detail={c.detail} />
                  {c.caseId && <Link className="residents-case-link" to={`/staff/cases/${c.caseId}`}>See case</Link>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {signals && (
          <div className="residents-signals">
            <div className="hide-from-xl"><IndicatorBar signals={signals} now={now} compact /></div>
            <div className="hide-below-xl"><IndicatorBar signals={signals} now={now} /></div>
          </div>
        )}
        <div className="tile-owner residents-owner">
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
            <Link to={`/staff/residents/${r.id}`}>Details and family access{r.familyAccess?.length ? ` (${r.familyAccess.length})` : ''}</Link>
          </p>
          {mine && <p className="meta"><Link to={`/staff/residents/${r.id}/edit`}>Edit details and contacts</Link></p>}
        </div>
        <div className="tile-actions residents-actions">
          {r.active && hasCallConsent(r.callConsent) && (
            <CallNowButton residentId={r.id} name={r.preferredName || r.name} phone={r.phone} busyCallId={liveCall(r)} />
          )}
          {mine && (
            <p><button className="ghost" type="button" disabled={busyId !== null || (!r.active && !hasCallConsent(r.callConsent))}
              onClick={() => void updateResident(r.id, { active: !r.active })}>{busyId === r.id && consentFor !== r.id ? 'Saving…' : r.active ? 'Pause calls' : 'Resume calls'}</button></p>
          )}
        </div>
        <IncompleteAnalysisList items={incomplete?.items.filter((i) => i.residentId === r.id) ?? null} showResident={false} />
        {!hasCallConsent(r.callConsent) && (
          <div className="stack notice notice-warning">
            <p role="status"><strong>Approval needed.</strong> Daily calls will wait until the patient agrees.</p>
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
        <details className="disclosure residents-more">
          <summary>More</summary>
          <div className="disclosure-body stack stack-s">
            {hasCallConsent(r.callConsent) && (
              <p className="meta">First-use approval recorded on {new Date(r.callConsent!.recordedAt).toLocaleDateString('en-GB')}.</p>
            )}
            <label className="file">Import past calls (JSON)
              <input type="file" accept="application/json,.json" onChange={(e) => void importCalls(r.id, e)} />
              <span className="button ghost">Choose a file</span>
            </label>
            {imported[r.id] && <p className="meta" role="status">{imported[r.id]}</p>}
          </div>
        </details>
      </article>
    );
  };

  return (
    <div className="stack page residents-page">
      <header className="page-header">
        <div>
          <h1>Patients</h1>
          {residents && <p className="meta">{residents.length} {residents.length === 1 ? 'patient' : 'patients'} registered with the care team.</p>}
        </div>
        <Link className="button" to="/staff/residents/new">Add patient</Link>
      </header>
      {added && <p className="notice-success" role="status">{added} was added.</p>}
      {/* A failed save shows on its own resident, where the person who pressed the button is looking. */}
      {error && !failedId && (residents ? <p className="error" role="alert">{error}</p> : <LoadError message={error} onRetry={retry} />)}
      {residents && queueError && <LoadError compact message={queueError} onRetry={retryExtra} />}
      {residents && incompleteError && <LoadError compact message={incompleteError} onRetry={retryExtra} />}
      {!error && (residents === null || (residents.length > 0 && !settled)) && <Loading layout="tiles" label="Loading patients…" />}
      {residents && residents.length === 0 && (
        <div className="card stack empty">
          <h2>No patients yet</h2>
          <p>Add a patient to start their daily check-in calls.</p>
          <p><Link className="button" to="/staff/residents/new">Add patient</Link></p>
        </div>
      )}
      {settled && ranked.length > 0 && (
        <>
          <details className="disclosure residents-legend">
            <summary>What the colours and icons mean</summary>
            <div className="disclosure-body"><SignalsLegend /></div>
          </details>
          {groups.map((g) => (
            <section key={g.key} className="stack residents-group" aria-labelledby={`residents-${g.key}`}>
              <h2 id={`residents-${g.key}`} className="residents-group-title">
                {g.title} <span className="residents-count">{g.items.length}</span>
              </h2>
              <div className="tiles residents-list">{g.items.map((x) => card(x.r))}</div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
