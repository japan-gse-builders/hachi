import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { CallNowButton } from '../components/CallNowButton';
import { CaseCalls } from '../components/CaseCalls';
import { CaseDecision } from '../components/CaseDecision';
import { CaseAbout, CaseHistory, CaseNotifications } from '../components/CaseRecords';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { expiredMediaLabel, isMediaExpired, RecordingPlayer } from '../components/RecordingPlayer';
import { ScreeningCard } from '../components/ScreeningCard';
import { IndicatorBar, SeverityChip, SignalsLegend } from '../components/Signals';
import { SpeechTrendCard } from '../components/SpeechTrendCard';
import { LoadError, Loading } from '../components/States';
import { audioAt, clock, formatWhen } from '../format';
import { queueLink } from '../queue';
import { buildIndicators, caseSignals, uncheckedFor, urgencySeverity } from '../signals';
import { useDocumentTitle } from '../title';
import type { CaseDetail, Evidence, IncompleteAnalyses } from '../types';
import '../styles/case.css';

function EvidenceAudio({ evidence, residentId }: { evidence: Evidence; residentId: string }) {
  if (evidence.recordingAvailable) return <RecordingPlayer residentId={residentId} callId={evidence.callId} startMs={evidence.startMs} />;
  if (!evidence.audioUrl) return null;
  return (
    <audio controls preload="none" aria-label="Call recording" src={audioAt(evidence.audioUrl, evidence.startMs)}>
      <track kind="captions" />
    </audio>
  );
}

function CaseEvidence({ evidence, noResponse, observation, expired, residentId }: {
  evidence: Evidence | undefined;
  noResponse: CaseDetail['detections'][number]['noResponse'];
  observation: string | undefined;
  expired: boolean;
  residentId: string;
}) {
  if (evidence?.quote.trim()) {
    return (
      <blockquote className="quote case-evidence">
        <p className="meta">From the call</p>
        <p className="line-clamp">“{evidence.quote}”</p>
      </blockquote>
    );
  }
  if (evidence?.recordingAvailable || evidence?.audioUrl) {
    return <div className="quote case-evidence"><p className="meta">From the call</p><EvidenceAudio evidence={evidence} residentId={residentId} /></div>;
  }
  if (expired) return <p className="meta">{expiredMediaLabel}</p>;
  if (noResponse) {
    return (
      <div className="quote case-evidence">
        <p className="meta">Observed on the call</p>
        <p>{noResponse === 'stopped_responding' ? 'Replies stopped partway through the call.' : 'Hachi heard no reply to its greeting or follow-up prompts.'}</p>
      </div>
    );
  }
  if (observation) {
    return <div className="quote case-evidence"><p className="meta">Observed pattern</p><p>{observation}</p></div>;
  }
  return <p className="meta">No call excerpt is available.</p>;
}

function EvidenceRecords({ detail, now }: { detail: CaseDetail; now: Date }) {
  const callById = new Map(detail.calls.map((call) => [call.id, call]));
  const records = detail.detections.flatMap((d) => d.evidence);
  const expired = records.some((e) => isMediaExpired(e.media, now));
  const evidence = records.filter((e) => !isMediaExpired(e.media, now) && (e.quote.trim() || e.recordingAvailable || e.audioUrl));
  if (!expired && !evidence.length) return null;
  return (
    <section className="stack" aria-labelledby="case-evidence-records">
      <h2 id="case-evidence-records">Evidence from calls</h2>
      {expired && <p className="meta">{expiredMediaLabel}</p>}
      {evidence.map((e, i) => {
        const call = callById.get(e.callId);
        return (
          <blockquote key={i} className="quote stack stack-s">
            {e.quote.trim() && <p>“{e.quote}”</p>}
            <p className="meta">
              {[call && formatWhen(call.startedAt) + ' JST', e.startMs !== undefined && `${clock(e.startMs)} into the call`].filter(Boolean).join(' · ') || 'From the call'}
            </p>
            <EvidenceAudio evidence={e} residentId={detail.resident.id} />
          </blockquote>
        );
      })}
    </section>
  );
}

function CaseMetrics({ detail, now }: { detail: CaseDetail; now: Date }) {
  const { token } = useAuth();
  const [incomplete, setIncomplete] = useState<IncompleteAnalyses>();
  useEffect(() => {
    const abort = new AbortController();
    void token()
      .then((t) => api<IncompleteAnalyses>('/api/incomplete-analyses?locale=en', t, { signal: abort.signal }))
      .then(setIncomplete, () => undefined);
    return () => abort.abort();
  }, [token]);

  const unchecked = uncheckedFor(incomplete, detail.resident.id);
  const signals = { ...caseSignals(detail, now), ...(unchecked !== undefined ? { unchecked } : {}) };
  return (
    <div className="disclosure-body stack">
      <div className="hide-below-xs"><IndicatorBar signals={signals} now={now} /></div>
      <div className="hide-from-xs"><IndicatorBar signals={signals} now={now} compact /></div>
      <details className="disclosure">
        <summary>What the colors and icons mean</summary>
        <div className="disclosure-body"><SignalsLegend levels={buildIndicators(signals, now).map((i) => i.severity)} /></div>
      </details>
      {detail.speechTrend.length > 0 && <SpeechTrendCard trend={detail.speechTrend} baseline={detail.speechBaseline} name={detail.resident.preferredName || detail.resident.name} />}
      {detail.screening && <ScreeningCard screening={detail.screening} />}
    </div>
  );
}

export function CasePage() {
  const { id = '' } = useParams();
  return <CaseView key={id} id={id} />;
}

function CaseView({ id }: { id: string }) {
  const location = useLocation();
  const { token } = useAuth();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [metricsSeen, setMetricsSeen] = useState(false);
  const [mediaTick, setMediaTick] = useState(0);
  const decision = useRef<HTMLDetailsElement>(null);
  useDocumentTitle(detail ? `${detail.resident.name} · Case` : 'Case');

  const path = `/api/cases/${encodeURIComponent(id)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await api<CaseDetail>(`${path}?locale=en`, await token(), signal ? { signal } : {});
    setDetail(data);
  }, [path, token]);

  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => {
      void load(abort.signal).catch((err: unknown) => {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load this case');
      });
    };
    const onVisible = () => { if (!document.hidden) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abort.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, attempt]);

  useEffect(() => {
    if (!detail) return;
    const records = [...detail.calls, ...detail.detections.flatMap((d) => d.evidence)];
    const now = Date.now();
    const next = Math.min(...records.flatMap(({ media }) => {
      const at = media?.expiresAt ? Date.parse(media.expiresAt) : 0;
      return media?.expired || !Number.isFinite(at) || at <= now ? [] : [at];
    }));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setMediaTick((tick) => tick + 1), Math.min(next - now, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [detail, mediaTick]);

  const save = async (body: Record<string, unknown>) => {
    await api(path, await token(), { method: 'PATCH', body: JSON.stringify(body) });
    setClaimed(false);
    setClaimError('');
    await load();
  };

  const takeCase = async () => {
    setClaiming(true);
    setClaimError('');
    try {
      const saved = await api<Pick<CaseDetail['case'], 'status' | 'statusLabel' | 'assignment'>>(`${path}/claim?locale=en`, await token(), { method: 'POST' });
      setDetail((current) => current && { ...current, case: { ...current.case, ...saved } });
      setClaimed(true);
      void load().catch(() => undefined);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Could not take this case');
      if (err instanceof ApiError && err.status === 409) await load().catch(() => undefined);
    } finally {
      setClaiming(false);
    }
  };

  const back = <p className="back-link"><Link to={queueLink(location.state)}><span aria-hidden="true">←</span> Back to the queue</Link></p>;
  if (!detail) {
    return (
      <div className="stack page case-page">
        {back}
        {error ? <LoadError message={error} onRetry={() => { setError(''); setAttempt((n) => n + 1); }} /> : <Loading layout="detail" label="Loading this case…" />}
      </div>
    );
  }

  const { case: c, resident, otherOpenCases } = detail;
  const now = new Date();
  const severity = urgencySeverity(c.urgency);
  const latest = [...detail.detections].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))[0];
  const evidence = latest?.evidence.find((e) => !isMediaExpired(e.media, now) && (e.quote.trim() || e.recordingAvailable || e.audioUrl));
  const expired = !evidence && Boolean(latest?.evidence.some((e) => isMediaExpired(e.media, now)));
  const reason = evidence || latest?.noResponse || expired ? latest?.summary || c.ruleName : c.ruleName;
  const quoted = new Set(detail.detections.flatMap((d) => d.evidence.map((e) => e.callId)));
  const canClaim = c.status !== 'closed' && !c.assignment;
  const openDecision = () => {
    if (!decision.current) return;
    decision.current.open = true;
    decision.current.querySelector('summary')?.focus();
  };

  return (
    <div className="stack page case-page">
      {back}
      <header className={`card case-head sev-${severity}`}>
        <div className="case-head-top">
          <div className="resident-heading">
            <ResidentAvatar id={resident.id} name={resident.name} portrait={resident.portrait} />
            <h1>{resident.name}</h1>
          </div>
          <SeverityChip spoken={false} severity={severity} label={c.urgencyLabel} detail={c.urgencyMeaning} />
        </div>
        <div className="case-review">
          <div className="stack stack-s">
            <h2 className="case-kicker">Why Hachi flagged this</h2>
            <p className="case-headline">{reason}</p>
            <CaseEvidence evidence={evidence} noResponse={latest?.noResponse} expired={expired}
              residentId={resident.id} observation={latest?.summary === reason ? undefined : latest?.summary} />
          </div>
          <div className="case-next">
            {c.status !== 'open' && (
              <p className="case-owner">
                <strong>{c.statusLabel}</strong>
                {c.assignment && <> · {c.assignment.name}<br /><time className="meta" dateTime={c.assignment.claimedAt}>Taken {formatWhen(c.assignment.claimedAt)} JST</time></>}
              </p>
            )}
            <div className="row">
              <button type="button" disabled={claiming} onClick={canClaim ? () => void takeCase() : openDecision}>
                {claiming ? 'Taking case…' : canClaim ? 'Take this case' : 'Update case'}
              </button>
              {resident.phone && <a className="case-call-patient" href={`tel:${resident.phone}`}>Call patient</a>}
            </div>
            <p className="sr-only" role="status">{claimed ? 'You have taken this case. It is in progress.' : ''}</p>
            {claimError && <p className="error" role="alert">{claimError}</p>}
          </div>
        </div>
      </header>

      <div className="card case-sections">
        <details className="disclosure case-section" ref={decision}>
          <summary>Status, urgency and rank</summary>
          <div className="disclosure-body">
            <CaseDecision detail={detail} onSave={save} />
          </div>
        </details>
        <details className="disclosure case-section">
          <summary>Call history and transcripts</summary>
          <div className="disclosure-body stack">
            <EvidenceRecords detail={detail} now={now} />
            <CaseCalls calls={detail.calls} now={now} quotedCallIds={quoted} resident={resident} />
          </div>
        </details>
        <details className="disclosure case-section" onToggle={(event) => { if (event.currentTarget.open) setMetricsSeen(true); }}>
          <summary>Indicators and trends</summary>
          {metricsSeen && <CaseMetrics detail={detail} now={now} />}
        </details>
        <details className="disclosure case-section">
          <summary>Notification history</summary>
          <div className="disclosure-body"><CaseNotifications notifications={c.notifications} /></div>
        </details>
        <details className="disclosure case-section">
          <summary>Patient details and contact</summary>
          <div className="disclosure-body stack">
            {(resident.callable ?? !resident.synthetic) && <CallNowButton residentId={resident.id} name={resident.preferredName || resident.name} phone={resident.phone} />}
            <CaseAbout detail={detail} />
          </div>
        </details>
        {!!otherOpenCases?.length && (
          <details className="disclosure case-section">
            <summary>Other open cases <span className="disclosure-peek">{otherOpenCases.length}</span></summary>
            <div className="disclosure-body">
              <ul className="case-others-list">
                {otherOpenCases.map((o) => (
                  <li key={o.id}>
                    <SeverityChip spoken={false} severity={urgencySeverity(o.urgency)} label={o.urgencyLabel} detail={o.urgencyMeaning} />
                    <Link to={`/staff/cases/${o.id}`} state={location.state}>{o.summary || o.ruleName}</Link>
                    <span className="meta">{o.statusLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
        {detail.events.length > 0 && (
          <details className="disclosure case-section">
            <summary>Case activity</summary>
            <div className="disclosure-body"><CaseHistory events={detail.events} options={[...detail.statusOptions, ...detail.urgencyOptions]} /></div>
          </details>
        )}
      </div>
    </div>
  );
}
