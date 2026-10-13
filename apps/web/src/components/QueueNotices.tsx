import { Link } from 'react-router';
import { openCounts, sortUnreached } from '../queue';
import { reachLevel, SEVERITY, worstSeverity } from '../signals';
import type { IncompleteAnalyses, Queue, UnreachedResident } from '../types';
import { IncompleteAnalysisList } from './IncompleteAnalyses';
import { LastReachedChip } from './Signals';

/** Open cases at each urgency, coloured as the lanes are; a zero stays grey so it reads as calm. */
export function QueueCounts({ queue }: { queue: Queue }) {
  return (
    <section className="queue-overview-panel" aria-label="Queue overview">
      <dl className="queue-counts">
        {openCounts(queue.items).map((c) => (
          <div key={c.urgency} className={`queue-count sev-${c.severity}${c.count ? '' : ' is-zero'}`}>
            <dt>
              <span className="sev-mark" aria-hidden="true">{SEVERITY[c.severity].symbol}</span>
              {queue.legend.find((l) => l.urgency === c.urgency)?.label ?? SEVERITY[c.severity].label}
            </dt>
            <dd>{c.count}</dd>
          </div>
        ))}
        {queue.summary && (
          <div className="queue-count queue-count-residents hide-below-sm">
            <dt>Residents registered</dt>
            <dd>{queue.summary.residents}</dd>
          </div>
        )}
      </dl>
      <p className="meta">Open cases at each level, whatever the filters show.</p>
    </section>
  );
}

/** Residents no call got through to; three days or more come first and stand out. */
export function QueueUnreached({ unreached, now }: { unreached: { items: UnreachedResident[]; note: string | null }; now: Date }) {
  const items = sortUnreached(unreached.items, now);
  const levels = items.map((u) => reachLevel(u, now));
  return (
    <section className={`card queue-notice queue-stripe sev-${worstSeverity(levels.map((l) => l.severity))}`} aria-labelledby="unreached-heading">
      <h2 id="unreached-heading" className="queue-notice-title">
        Nobody has been reached <span className="queue-count-pill">{items.length}<span className="sr-only"> {items.length === 1 ? 'resident' : 'residents'}</span></span>
      </h2>
      {unreached.note && <p className="meta">{unreached.note}</p>}
      <ul className="queue-unreached" aria-label="Residents nobody has spoken to">
        {items.map((u, i) => (
          <li key={`${u.residentId}-${u.localDate}`} className={levels[i]!.severity === 'emergency' ? 'is-escalated' : undefined}>
            <p className="queue-unreached-who">
              <Link to={`/staff/residents/${u.residentId}`}>{u.residentName}</Link>
              <LastReachedChip reach={u} now={now} />
            </p>
            <details className="disclosure">
              <summary>
                <span>{u.reasonLabel}</span>
                <span className="disclosure-peek">{u.tried}</span>
              </summary>
              <div className="disclosure-body">
                <p>{u.meaning}</p>
                <p className="meta">{u.localDate}</p>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Calls nothing finished looking at: our side, not a finding, so blue and dashed rather than an urgency. */
export function QueueUnchecked({ incomplete }: { incomplete: IncompleteAnalyses }) {
  const n = incomplete.items.length;
  return (
    <section className="card queue-notice queue-stripe sev-system" aria-labelledby="unchecked-heading">
      <h2 id="unchecked-heading" className="queue-notice-title">
        Not fully checked <span className="queue-count-pill">{n}<span className="sr-only"> {n === 1 ? 'call' : 'calls'}</span></span>
      </h2>
      {incomplete.note && <p className="meta">{incomplete.note}</p>}
      <IncompleteAnalysisList items={incomplete.items} />
    </section>
  );
}
