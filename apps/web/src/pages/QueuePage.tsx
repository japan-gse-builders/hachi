import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { filterQueue, queueFilters } from '../queue';
import { ContactRequests } from '../components/ContactRequests';
import { IncompleteAnalysisList } from '../components/IncompleteAnalyses';
import { LoadError, Loading } from '../components/States';
import { deliveryLabel, formatWhen, urgencyTone } from '../format';
import { useDocumentTitle } from '../title';
import type { Queue, Spend } from '../types';

export function QueuePage() {
  useDocumentTitle('Needs attention');
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = queueFilters(params);
  const changeFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    setParams(next, { replace: name === 'q' });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const key of ['q', 'urgency', 'includeClosed']) next.delete(key);
    setParams(next);
  };
  const [queue, setQueue] = useState<Queue | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const t = await token();
        const [data, money] = await Promise.all([api<Queue>(`/api/queue?locale=en${filters.includeClosed ? '&includeClosed=true' : ''}`, t), api<Spend | null>('/api/spend?locale=en', t)]);
        if (!stop) {
          setQueue(data);
          setSpend(money);
          setError('');
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : 'Could not load the queue');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [token, filters.includeClosed, attempt]);

  const retry = () => {
    setError('');
    setAttempt((n) => n + 1);
  };
  const visible = queue ? filterQueue(queue.items, filters) : [];
  const selectedLevel = queue?.legend.find((item) => item.urgency === filters.urgency);
  const filtered = Boolean(filters.urgency || filters.query.trim() || filters.includeClosed);

  return (
    <div className="stack page">
      <header className="page-header">
        <h1>Needs attention</h1>
        <p className="meta">Open cases, most urgent first. This page refreshes every 15 seconds.</p>
      </header>
      {error && <LoadError message={error} onRetry={retry} />}
      {queue === null && !error && <Loading layout="queue" label="Loading the queue…" />}
      {queue?.summary && (
        <section aria-label="Queue overview" className="stack">
          <dl className="queue-overview">
            <div><dt>Need attention</dt><dd><span className="overview-count">{queue.summary.needsAttention}</span><p>{queue.summary.needsAttention === 0 ? 'No open cases need attention.' : 'Open cases needing action now, today or soon.'}</p></dd></div>
            <div><dt>Keeping an eye on</dt><dd><span className="overview-count">{queue.summary.monitor}</span><p>Open cases at Monitor level.</p></dd></div>
            <div><dt>Residents registered</dt><dd><span className="overview-count">{queue.summary.residents}</span><p>All residents registered with the care team.</p></dd></div>
          </dl>
          <p className="meta">These totals cover all open cases. Filters change the list of cases below.</p>
        </section>
      )}
      <ContactRequests />
      {/* Staff are the ones who get asked why nobody was called today, so they can see the answer. */}
      {spend?.paused && (
        <p className="card card-emergency">
          <strong>Check-in calls have stopped.</strong> {spend.note}
        </p>
      )}
      {/* Above the cases on purpose: a resident with no case at all may be the one to worry about. */}
      {queue?.unreached && queue.unreached.items.length > 0 && (
        <div className="card card-emergency stack">
          <p>
            <strong>Nobody has been reached.</strong> {queue.unreached.note}
          </p>
          <ul className="unreached" aria-label="Residents nobody has spoken to">
            {queue.unreached.items.map((u) => (
              <li key={`${u.residentId}-${u.localDate}`}>
                <p className="row">
                  <Link to={`/staff/residents/${u.residentId}`}>{u.residentName}</Link>
                  <span className="badge watch">{u.reasonLabel}</span>
                </p>
                <p>{u.meaning}</p>
                <p className="meta">
                  {u.localDate} · {u.tried}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Beside the cases rather than among them: these calls found nothing because nothing finished looking. */}
      {queue?.incomplete && queue.incomplete.items.length > 0 && (
        <div className="card card-unchecked stack">
          <p>
            <strong>Not fully checked.</strong> {queue.incomplete.note}
          </p>
          <IncompleteAnalysisList items={queue.incomplete.items} />
        </div>
      )}
      {queue && (
        <section className="stack" aria-labelledby="cases-heading">
          <h2 id="cases-heading" className="section-title">Cases</h2>
          {/* The filters sit directly on the list they change, not above the notices between them. */}
          <div className="card queue-controls" role="search" aria-label="Filter cases">
            <fieldset>
              <legend className="control-label">Urgency</legend>
              <div className="urgency-filter">
                <div className="row segmented" aria-describedby="urgency-explanation urgency-legend">
                  <button type="button" className="ghost" aria-pressed={!filters.urgency} onClick={() => changeFilter('urgency', '')}>All levels</button>
                  {queue.legend.map((level) => (
                    <button key={level.urgency} type="button" className="ghost" aria-pressed={filters.urgency === level.urgency} onClick={() => changeFilter('urgency', level.urgency)}>{level.label}</button>
                  ))}
                </div>
                {queue.legend.length > 0 && (
                  <ul id="urgency-legend" className="legend" aria-label="What each urgency level asks of you">
                    {queue.legend.map((l) => (
                      <li key={l.urgency}>
                        <span className={`badge ${urgencyTone(l.urgency)}`}>{l.label}</span> {l.action}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p id="urgency-explanation" className="meta">{selectedLevel?.meaning ?? selectedLevel?.action ?? 'All urgency levels, in priority order.'}</p>
            </fieldset>
            <div className="queue-search">
              <label>Search by resident or case summary
                <input type="search" value={filters.query} maxLength={200} autoComplete="off" spellCheck={false} onChange={(event) => changeFilter('q', event.target.value)} />
              </label>
              <div className="row">
                <label className="check"><input type="checkbox" checked={filters.includeClosed} onChange={(event) => changeFilter('includeClosed', event.target.checked ? 'true' : '')} />Include closed cases</label>
                <button type="button" className="subtle" onClick={clearFilters}>Clear filters</button>
              </div>
            </div>
          </div>
          <p className="meta" role="status">Showing {visible.length} of {queue.items.length} {filters.includeClosed ? 'open and closed cases' : 'open cases'}.</p>
          {visible.length === 0 && (
            <div className="card stack empty">
              <h3>{filtered ? 'No cases match these filters' : 'No open cases need attention'}</h3>
              <p>Try all urgency levels or clear the search to see more cases.</p>
              <p><button type="button" className="ghost" onClick={clearFilters}>Show all open cases</button></p>
            </div>
          )}
          {visible.length > 0 && (
            <div className="tiles">
              {visible.map((item) => (
                <Link key={item.caseId} className={`card card-link case-tile ${item.urgency === 'emergency' ? 'card-emergency' : ''}`} to={`/staff/cases/${item.caseId}`} state={{ queueSearch: params.toString() }}>
                  <span className="tile-top">
                    <span className={`badge ${urgencyTone(item.urgency)}`} title={item.urgencyMeaning}>{item.urgencyLabel}</span>
                    <span className="meta">{formatWhen(item.detectedAt)}</span>
                  </span>
                  <span className="resident-heading">
                    <ResidentAvatar id={item.residentId} name={item.residentName} />
                    <h3>{item.residentName}</h3>
                  </span>
                  <span className="tile-summary">{item.summary}</span>
                  <span className="reason">{item.reason}</span>
                  {Boolean(item.residentFacts?.length || item.householdNotes) && (
                    <span className="tile-context meta">
                      {item.residentFacts?.length ? <span>{item.residentFacts.join(' · ')}</span> : null}
                      {item.householdNotes && <span>{item.householdNotes}</span>}
                    </span>
                  )}
                  <span className="tile-foot meta">
                    <span>{item.rule} · {item.statusLabel}</span>
                    {item.notifications.length > 0 && (
                      <span>
                        Notified {item.notifications.map((n) => `${n.recipient} by ${n.channel} (${deliveryLabel(n.delivery)})`).join(', ')} ·{' '}
                        {formatWhen(item.notifications[0]!.sentAt)}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
      {spend && !spend.paused && (
        <p className="meta">
          {spend.note} {spend.inFlight !== '$0.00' && `${spend.inFlight} is held by calls in progress.`}
        </p>
      )}
    </div>
  );
}
