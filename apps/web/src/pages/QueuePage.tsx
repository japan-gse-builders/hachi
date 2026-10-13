import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { filterQueue, queueFilters } from '../queue';
import { ContactRequests } from '../components/ContactRequests';
import { IncompleteAnalysisList } from '../components/IncompleteAnalyses';
import { deliveryLabel, formatWhen, urgencyTone } from '../format';
import type { Queue, Spend } from '../types';

export function QueuePage() {
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
  }, [token, filters.includeClosed]);

  const visible = queue ? filterQueue(queue.items, filters) : [];
  const selectedLevel = queue?.legend.find((item) => item.urgency === filters.urgency);

  return (
    <div className="stack">
      <h1>Needs attention</h1>
      {/* The scale stays above every panel, separate from the case-card grid. */}
      {queue && queue.legend.length > 0 && (
        <ul className="legend" aria-label="What each urgency level asks of you">
          {queue.legend.map((l) => (
            <li key={l.urgency}>
              <span className={`badge ${urgencyTone(l.urgency)}`}>{l.label}</span> {l.action}
            </li>
          ))}
        </ul>
      )}
      {queue?.summary && (
        <section aria-label="Queue overview" className="stack">
          <dl className="queue-overview">
            <div><dt>Need attention</dt><dd><span className="overview-count">{queue.summary.needsAttention}</span><p>{queue.summary.needsAttention === 0 ? 'No open cases need attention.' : 'Open cases needing action now, today or soon.'}</p></dd></div>
            <div><dt>Keeping an eye on</dt><dd><span className="overview-count">{queue.summary.monitor}</span><p>Open cases at Monitor level.</p></dd></div>
            <div><dt>Residents registered</dt><dd><span className="overview-count">{queue.summary.residents}</span><p>All residents registered with the care team.</p></dd></div>
          </dl>
          <p className="meta">These totals cover all open cases. Filters change the list below.</p>
        </section>
      )}
      {queue && (
        <section className="card stack queue-controls" aria-label="Filter cases">
          <fieldset>
            <legend>Urgency</legend>
            <div className="row" aria-describedby="urgency-explanation">
              <button type="button" className="ghost" aria-pressed={!filters.urgency} onClick={() => changeFilter('urgency', '')}>All levels</button>
              {queue.legend.map((level) => (
                <button key={level.urgency} type="button" className="ghost" aria-pressed={filters.urgency === level.urgency} onClick={() => changeFilter('urgency', level.urgency)}>{level.label}</button>
              ))}
            </div>
            <p id="urgency-explanation" className="meta">{selectedLevel?.meaning ?? selectedLevel?.action ?? 'All urgency levels, in priority order.'}</p>
          </fieldset>
          <div className="queue-search">
            <label>Search by resident or case summary
              <input type="search" value={filters.query} maxLength={200} onChange={(event) => changeFilter('q', event.target.value)} />
            </label>
            <button type="button" className="ghost" onClick={clearFilters}>Clear filters</button>
          </div>
          <label className="check"><input type="checkbox" checked={filters.includeClosed} onChange={(event) => changeFilter('includeClosed', event.target.checked ? 'true' : '')} />Include closed cases</label>
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
      {error && <p className="error">{error}</p>}
      {queue === null && !error && <p>Loading…</p>}
      {queue && <p className="meta" role="status">Showing {visible.length} of {queue.items.length} {filters.includeClosed ? 'open and closed cases' : 'open cases'}.</p>}
      {queue && visible.length === 0 && (
        <section className="card stack">
          <h2>{!filters.urgency && !filters.query.trim() && !filters.includeClosed ? 'No open cases need attention' : 'No cases match these filters'}</h2>
          <p>Try all urgency levels or clear the search to see more cases.</p>
          <button type="button" className="ghost" onClick={clearFilters}>Show all open cases</button>
        </section>
      )}
      {queue && visible.length > 0 && (
        <div className="tiles">
          {visible.map((item) => (
            <Link key={item.caseId} className={`card card-link ${item.urgency === 'emergency' ? 'card-emergency' : ''}`} to={`/staff/cases/${item.caseId}`}>
              <span className={`badge ${urgencyTone(item.urgency)}`} title={item.urgencyMeaning}>{item.urgencyLabel}</span>
              <div className="resident-heading">
                <ResidentAvatar id={item.residentId} name={item.residentName} />
                <h2>{item.residentName}</h2>
              </div>
              {item.synthetic && <p className="meta">Synthetic demo resident, not a real person</p>}
              {item.residentFacts?.length ? <p className="meta">{item.residentFacts.join(' · ')}</p> : null}
              {item.householdNotes && <p className="meta">{item.householdNotes}</p>}
              <p>{item.summary}</p>
              <p className="reason">{item.reason}</p>
              <p className="meta">{item.rule} · {item.statusLabel} · {formatWhen(item.detectedAt)}</p>
              {item.notifications.length > 0 && (
                <p className="meta">
                  Notified {item.notifications.map((n) => `${n.recipient} by ${n.channel} (${deliveryLabel(n.delivery)})`).join(', ')} ·{' '}
                  {formatWhen(item.notifications[0]!.sentAt)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
      {spend && !spend.paused && (
        <p className="meta">
          {spend.note} {spend.inFlight !== '$0.00' && `${spend.inFlight} is held by calls in progress.`}
        </p>
      )}
    </div>
  );
}
