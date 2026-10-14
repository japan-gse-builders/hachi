import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { filterQueue, queueFilters, queueLanes } from '../queue';
import { ContactRequests } from '../components/ContactRequests';
import { QueueLanes } from '../components/QueueLanes';
import { QueueCounts, QueueLegend, QueueUnchecked, QueueUnreached } from '../components/QueueNotices';
import { SeverityMark } from '../components/Signals';
import { LoadError, Loading } from '../components/States';
import { urgencySeverity } from '../signals';
import { useDocumentTitle } from '../title';
import type { Queue, SpendNotice } from '../types';
import '../styles/queue.css';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const t = await token();
        const [data, money] = await Promise.all([api<Queue>(`/api/queue?locale=en${filters.includeClosed ? '&includeClosed=true' : ''}`, t), api<SpendNotice | null>('/api/spend?locale=en', t)]);
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
  const selectedLevel = queue?.legend.find((item) => item.urgency === filters.urgency);
  const filterSummary = [
    selectedLevel?.label ?? 'All levels',
    filters.query.trim() && `“${filters.query.trim()}”`,
    filters.includeClosed && 'closed included',
  ].filter(Boolean).join(' · ');
  const unreached = queue?.unreached?.items.length ? queue.unreached : null;
  const incomplete = queue?.incomplete?.items.length ? queue.incomplete : null;

  return (
    <div className="stack page queue-page">
      <header className="page-header">
        <h1>Triage queue</h1>
        <p className="meta">Open cases, most urgent first. This page refreshes every 15 seconds.</p>
      </header>
      {queue && <QueueCounts queue={queue} />}
      {error && <LoadError message={error} onRetry={retry} />}
      {queue === null && !error && <Loading layout="queue" label="Loading the queue…" />}
      {/* Staff are the ones who get asked why nobody was called today, so they can see the answer. */}
      {spend?.paused && <p className="card card-emergency"><strong>{spend.note}</strong></p>}
      {(queue || error) && (
        <div className="queue-layout">
          {queue && (
            <section className="queue-cases stack" aria-labelledby="cases-heading">
              <h2 id="cases-heading" className="sr-only">Cases</h2>
              <details className="card disclosure queue-filters" open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)}>
                <summary>
                  <span>Filter cases</span>
                  <span className="disclosure-peek">{filterSummary}</span>
                </summary>
                <div className="disclosure-body queue-filters-grid" role="search" aria-label="Filter cases">
                  <div className="queue-filter-controls">
                    <div className="queue-filter-row">
                      <fieldset>
                        <legend className="control-label">Urgency</legend>
                        <div className="row segmented" aria-describedby="urgency-explanation">
                          <button type="button" className="ghost" aria-pressed={!filters.urgency} onClick={() => changeFilter('urgency', '')}>All levels</button>
                          {queue.legend.map((level) => {
                            const severity = urgencySeverity(level.urgency);
                            const tipId = `urgency-tip-${level.urgency}`;
                            return (
                              <span key={level.urgency} className="urgency-filter">
                                <button type="button" className={`ghost urgency-option sev-${severity}`} aria-pressed={filters.urgency === level.urgency}
                                  aria-describedby={tipId} onClick={() => changeFilter('urgency', level.urgency)}>
                                  <SeverityMark severity={severity} />
                                  {level.label}
                                </button>
                                <span id={tipId} role="tooltip" className="urgency-tip">{capital(level.action)}</span>
                              </span>
                            );
                          })}
                        </div>
                      </fieldset>
                      <label className="check"><input type="checkbox" checked={filters.includeClosed} onChange={(event) => changeFilter('includeClosed', event.target.checked ? 'true' : '')} />Include closed cases</label>
                      <button type="button" className="subtle" onClick={clearFilters}>Clear filters</button>
                    </div>
                    <p id="urgency-explanation" className="meta">{selectedLevel?.meaning ?? selectedLevel?.action ?? 'All urgency levels, in priority order.'}</p>
                  </div>
                  <div className="queue-search">
                    <label>Search by patient or case summary
                      <input type="search" value={filters.query} maxLength={200} autoComplete="off" spellCheck={false} onChange={(event) => changeFilter('q', event.target.value)} />
                    </label>
                  </div>
                </div>
              </details>
              {/* A resident with no case may still need attention, so these stay above the case list. */}
              {(unreached || incomplete) && (
                <div className="queue-notices stack">
                  {unreached && <QueueUnreached unreached={unreached} now={now} />}
                  {incomplete && <QueueUnchecked incomplete={incomplete} />}
                </div>
              )}
              <div className="queue-list-head">
                <p className="meta" role="status">Showing {visible.length} of {queue.items.length} {filters.includeClosed ? 'open and closed cases' : 'open cases'}.</p>
                <details className="disclosure queue-legend">
                  <summary>What the colors and icons mean</summary>
                  <div className="disclosure-body"><QueueLegend queue={queue} includeClosed={filters.includeClosed} /></div>
                </details>
              </div>
              {visible.length === 0 && (
                <div className="card stack empty">
                  <h3>{filtered ? 'No cases match these filters' : 'No open cases need attention'}</h3>
                  <p>Try all urgency levels or clear the search to see more cases.</p>
                  <p><button type="button" className="ghost" onClick={clearFilters}>Show all open cases</button></p>
                </div>
              )}
              {visible.length > 0 && <QueueLanes lanes={queueLanes(visible, queue.items)} queue={queue} now={now} linkState={{ queueSearch: params.toString() }} />}
            </section>
          )}
          {/* Contact requests load separately, after the case list. */}
          <div className="queue-requests">
            <ContactRequests />
          </div>
        </div>
      )}
    </div>
  );
}
