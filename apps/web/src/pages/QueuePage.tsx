import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ContactRequests } from '../components/ContactRequests';
import { QueueLanes } from '../components/QueueLanes';
import { QueueUnchecked, QueueUnreached } from '../components/QueueNotices';
import { LoadError, Loading } from '../components/States';
import { filterQueue, queueFilters, queueLanes } from '../queue';
import { useDocumentTitle } from '../title';
import type { Queue, SpendNotice } from '../types';
import '../styles/queue.css';

export function QueuePage() {
  useDocumentTitle('Triage queue');
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
  const [spend, setSpend] = useState<SpendNotice | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const filtered = Boolean(filters.urgency || filters.query.trim() || filters.includeClosed);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const t = await token();
        const [data, money] = await Promise.all([
          api<Queue>(`/api/queue?locale=en${filters.includeClosed ? '&includeClosed=true' : ''}`, t),
          api<SpendNotice | null>('/api/spend?locale=en', t),
        ]);
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
  const now = new Date();
  const visible = queue ? filterQueue(queue.items, filters) : [];
  const lanes = queueLanes(visible);
  const needsToday = lanes.filter((lane) => lane.urgency === 'emergency' || lane.urgency === 'urgent');
  const later = lanes.filter((lane) => !needsToday.includes(lane));
  const linkState = { queueSearch: params.toString() };
  const unreached = queue?.unreached?.items.length ? queue.unreached : null;
  const incomplete = queue?.incomplete?.items.length ? queue.incomplete : null;
  const filterSummary = [
    queue?.legend.find((level) => level.urgency === filters.urgency)?.label,
    filters.query.trim() && `“${filters.query.trim()}”`,
    filters.includeClosed && 'Closed included',
  ].filter(Boolean).join(' · ');

  return (
    <div className="stack page queue-page">
      <header className="page-header"><h1>Triage queue</h1></header>
      {error && <LoadError message={error} onRetry={retry} />}
      {queue === null && !error && <Loading layout="queue" label="Loading the queue…" />}
      {spend?.paused && <p className="card card-emergency"><strong>{spend.note}</strong></p>}
      {queue && (
        <>
          <details className="card disclosure queue-filters">
            <summary>Filter cases {filterSummary && <span className="disclosure-peek">{filterSummary}</span>}</summary>
            <div className="disclosure-body stack" role="search" aria-label="Filter cases">
              <div className="queue-filter-fields">
                <label>Search cases
                  <input type="search" placeholder="Patient name or reason" value={filters.query} maxLength={200} autoComplete="off"
                    onChange={(event) => changeFilter('q', event.target.value)} />
                </label>
                <label>Urgency
                  <select value={filters.urgency} onChange={(event) => changeFilter('urgency', event.target.value)}>
                    <option value="">All levels</option>
                    {queue.legend.map((level) => <option key={level.urgency} value={level.urgency}>{level.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <label className="check"><input type="checkbox" checked={filters.includeClosed}
                  onChange={(event) => changeFilter('includeClosed', event.target.checked ? 'true' : '')} />Include closed cases</label>
                {filtered && <button type="button" className="subtle" onClick={clearFilters}>Clear filters</button>}
              </div>
              {filtered && <p className="meta" role="status">{visible.length} {visible.length === 1 ? 'case matches' : 'cases match'}</p>}
            </div>
          </details>
          <QueueLanes lanes={needsToday} linkState={linkState} />
          {visible.length === 0 && (
            <div className="card stack empty">
              <h2>{filtered ? 'No cases match these filters' : 'No open cases'}</h2>
              {filtered && <button type="button" className="ghost" onClick={clearFilters}>Show all open cases</button>}
            </div>
          )}
          {unreached && <QueueUnreached unreached={unreached} now={now} />}
          <QueueLanes lanes={later} linkState={linkState} revealFolded={filtered} />
          {incomplete && <QueueUnchecked incomplete={incomplete} />}
        </>
      )}
      {(queue || error) && <ContactRequests />}
    </div>
  );
}
