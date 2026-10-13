import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { CallNowButton } from '../components/CallNowButton';
import { callDay, CaseCalls } from '../components/CaseCalls';
import { CaseDecision } from '../components/CaseDecision';
import { CaseAbout, CaseHistory, CaseNotifications } from '../components/CaseRecords';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { ScreeningCard } from '../components/ScreeningCard';
import { IndicatorBar, LastReachedChip, SeverityChip } from '../components/Signals';
import { SpeechTrendCard } from '../components/SpeechTrendCard';
import { LoadError, Loading } from '../components/States';
import { audioAt, clock, formatWhen, phoneDisplay, speakerLabel } from '../format';
import { queueLink } from '../queue';
import { caseSignals, uncheckedFor, urgencySeverity, type Severity } from '../signals';
import '../styles/case.css';
import { useDocumentTitle } from '../title';
import type { CaseDetail, IncompleteAnalyses } from '../types';

const STATUS_SEVERITY: Record<string, Severity> = { open: 'none', in_progress: 'monitor', closed: 'good' };

function openFor(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/** What was found, in one line: the latest detection's own summary. */
function headlineOf(d: CaseDetail): string {
  const latest = [...d.detections].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))[0];
  return latest?.summary ?? d.case.ruleName;
}

function callOn(iso: string, now: Date): string {
  const day = callDay(iso, now);
  return day === 'Today' || day === 'Yesterday' ? `${day}'s call` : `call on ${day}`;
}

/** Only what adds to the worry; `resident.facts` also lists the reassuring ones, which stay under About. */
function riskFacts(r: CaseDetail['resident']): string[] {
  const v = r.vulnerability;
  const risks = [v.livesAlone && 'Lives alone', !v.hasCloseSupporter && 'No close supporter', v.needsCare && 'Needs care'];
  return [...risks.filter((f): f is string => !!f), ...v.chronicConditions];
}

function CaseHeader({ detail, now, unchecked }: { detail: CaseDetail; now: Date; unchecked: number | undefined }) {
  const c = detail.case;
  const r = detail.resident;
  const severity = urgencySeverity(c.urgency);
  const signals = { ...caseSignals(detail, now), ...(unchecked !== undefined ? { unchecked } : {}) };
  const facts = riskFacts(r);
  const glance = `At a glance for ${r.name}`;
  return (
    <header className={`card case-head sev-${severity}`}>
      <div className="case-head-top">
        <p className="cluster case-head-state">
          <SeverityChip spoken={false} severity={severity} label={c.urgencyLabel} detail={c.urgencyMeaning} />
          <SeverityChip spoken={false} severity={STATUS_SEVERITY[c.status] ?? 'none'} label={c.statusLabel} />
          {/* One case on the screen, so what the level asks for is written out rather than left to a tooltip. */}
          <span className="meta">{c.urgencyMeaning}</span>
        </p>
        <div className="case-head-action">
          {r.phone && (
            <p className="case-phone">
              <span className="control-label">Phone</span> <a href={`tel:${r.phone}`}>{phoneDisplay(r.phone)}</a>
            </p>
          )}
          {/* The next step after reading a case is often to hear from them again (issue #13). */}
          {(r.callable ?? !r.synthetic) && <CallNowButton residentId={r.id} name={r.preferredName || r.name} phone={r.phone} />}
        </div>
      </div>
      <div className="resident-heading">
        <ResidentAvatar id={r.id} name={r.name} portrait={r.portrait} />
        <h1>{r.name}</h1>
        <LastReachedChip reach={signals.reach} now={now} />
        {facts.length > 0 && (
          <ul className="cluster case-chips" aria-label="Circumstances">
            {facts.map((f) => (
              <li key={f}>
                <SeverityChip spoken={false} severity="monitor" label={f} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="case-headline">
        <strong>{headlineOf(detail)}</strong>{' '}
        <span className="meta">
          {c.ruleName} ·{' '}
          <span className="case-nowrap">
            open <time dateTime={c.firstDetectedAt} title={`Since ${formatWhen(c.firstDetectedAt)}`}>{openFor(c.firstDetectedAt, now)}</time>
          </span>
        </span>
      </p>
      <div className="hide-below-xs">
        <IndicatorBar signals={signals} now={now} label={glance} />
      </div>
      <div className="hide-from-xs">
        <IndicatorBar signals={signals} now={now} label={glance} compact />
      </div>
    </header>
  );
}

function CaseSaid({ detail, now }: { detail: CaseDetail; now: Date }) {
  const callById = new Map(detail.calls.map((c) => [c.id, c]));
  const silences = detail.detections.filter((d) => d.noResponse);
  const evidence = detail.detections.flatMap((d) => d.evidence);
  const call = detail.calls.find((c) => c.transcript?.length);
  return (
    <section className="card stack case-said" aria-labelledby="said-heading">
      <h2 id="said-heading">What was said</h2>
      {silences.map((d, i) => (
        <p key={`no-response-${i}`} className="case-silence">
          <SeverityChip spoken={false} severity="monitor" label="Silence" /> {d.summary} This is an observation of silence; there is no patient quote.
        </p>
      ))}
      {evidence.map((e, i) => {
        const from = callById.get(e.callId);
        return (
          <blockquote className="quote" key={`${e.callId}-${i}`}>
            {/* The quote is what makes the case checkable, so it reads before the rule that found it. */}
            <p className="quote-words">“{e.quote}”</p>
            <p className="meta">
              In their own words{from ? ` · ${callOn(from.startedAt, now)}` : ''}
              {e.startMs !== undefined ? ` · ${clock(e.startMs)} in` : ''}
            </p>
            {e.audioUrl && (
              <audio controls preload="metadata" src={audioAt(e.audioUrl, e.startMs)}>
                <track kind="captions" />
              </audio>
            )}
          </blockquote>
        );
      })}
      {!evidence.length && !silences.length && <p className="meta">No words were quoted for this case.</p>}
      {call && (
        <details className="disclosure case-transcript">
          <summary>
            Whole conversation
            <span className="disclosure-peek">{call.transcript!.length} turns</span>
          </summary>
          <div className="transcript disclosure-body">
            {call.transcript!.map((t, i) => (
              <p key={i} className={t.speaker === 'agent' ? 'agent' : ''}>
                <strong>{speakerLabel(t.speaker, detail.resident.name)}: </strong>
                {t.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** Below two columns the decision is further down, so a bar keeps it one tap away until it is on screen. */
function useInView(id: string, ready: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ready ? document.getElementById(id) : null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, ready]);
  return inView;
}

export function CasePage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { token } = useAuth();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [incomplete, setIncomplete] = useState<IncompleteAnalyses | undefined>();
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState('');
  const decisionInView = useInView('decision-heading', !!detail);
  useDocumentTitle(detail ? `${detail.resident.name} · Case` : 'Case');

  const load = async () => {
    const data = await api<CaseDetail>(`/api/cases/${id}?locale=en`, await token());
    setNow(new Date());
    setDetail(data);
  };
  const loadOrReport = () => {
    setError('');
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this case'));
  };

  useEffect(() => {
    loadOrReport();
    // Only for the Checked indicator; without it that indicator says "Not known".
    void token()
      .then((t) => api<IncompleteAnalyses>('/api/incomplete-analyses?locale=en', t))
      .then(setIncomplete, () => undefined);
    // The case id is the only input. load closes over the latest token function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async (body: Record<string, unknown>) => {
    await api(`/api/cases/${id}`, await token(), { method: 'PATCH', body: JSON.stringify(body) });
    await load();
  };

  const back = (
    <p className="back-link">
      <Link to={queueLink(location.state)}><span aria-hidden="true">← </span>Back to the queue</Link>
    </p>
  );
  if (!detail) {
    return (
      <div className="stack page">
        {back}
        {error ? <LoadError message={error} onRetry={loadOrReport} /> : <Loading layout="detail" label="Loading this case…" />}
      </div>
    );
  }

  const quoted = new Set(detail.detections.flatMap((d) => d.evidence.map((e) => e.callId)));
  const unchecked = uncheckedFor(incomplete, detail.resident.id);

  return (
    <div className="stack page case-page">
      {back}
      {error && <LoadError message={error} onRetry={loadOrReport} compact />}
      <CaseHeader detail={detail} now={now} unchecked={unchecked} />
      {/* Read, then decide: evidence, the decision beside it, then the records to compare with. */}
      <div className="case-layout">
        <div className="case-col case-col-evidence">
          <CaseSaid detail={detail} now={now} />
          {detail.speechTrend.length > 0 && <SpeechTrendCard trend={detail.speechTrend} baseline={detail.speechBaseline} name={detail.resident.preferredName || detail.resident.name} />}
          {detail.screening && <ScreeningCard screening={detail.screening} />}
        </div>
        <div className="case-col case-col-decide sticky-panel">
          <CaseDecision detail={detail} onSave={save} />
          <CaseNotifications notifications={detail.case.notifications} />
        </div>
        <div className="case-col case-col-records">
          <CaseCalls calls={detail.calls} now={now} quotedCallIds={quoted} />
          <CaseAbout detail={detail} />
          <CaseHistory events={detail.events} options={[...detail.statusOptions, ...detail.urgencyOptions]} />
        </div>
      </div>
      {!decisionInView && (
        <div className="action-bar hide-from-md case-action-bar">
          <SeverityChip spoken={false} severity={STATUS_SEVERITY[detail.case.status] ?? 'none'} label={detail.case.statusLabel} />
          <a className="button" href="#decision-heading">Update this case</a>
        </div>
      )}
    </div>
  );
}
