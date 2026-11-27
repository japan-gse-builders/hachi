import { Link } from 'react-router';
import { sortUnreached } from '../queue';
import { reachLevel, worstSeverity } from '../signals';
import type { IncompleteAnalyses, UnreachedResident } from '../types';
import { IncompleteAnalysisList } from './IncompleteAnalyses';
import { LastReachedChip } from './Signals';

/** Residents no call got through to; three days or more come first and stand out. */
export function QueueUnreached({ unreached, now }: { unreached: { items: UnreachedResident[]; note: string | null }; now: Date }) {
  const items = sortUnreached(unreached.items, now);
  const levels = items.map((u) => reachLevel(u, now));
  return (
    <section className={`card queue-notice queue-stripe sev-${worstSeverity(levels.map((l) => l.severity))}`} aria-labelledby="unreached-heading">
      <h2 id="unreached-heading" className="queue-notice-title">
        Missed check-ins <span className="queue-count-pill">{items.length}<span className="sr-only"> {items.length === 1 ? 'patient' : 'patients'}</span></span>
      </h2>
      {unreached.note && <p className="meta">{unreached.note}</p>}
      <ul className="queue-unreached" aria-label="Patients nobody has spoken to">
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

/** Calls with unfinished analysis are available from the queue on demand. */
export function QueueUnchecked({ incomplete }: { incomplete: IncompleteAnalyses }) {
  const n = incomplete.items.length;
  return (
    <section className="card queue-notice queue-stripe sev-system" aria-labelledby="unchecked-heading">
      <details className="disclosure queue-notice-fold">
        <summary>
          <h2 id="unchecked-heading" className="queue-notice-title">
            Not fully checked <span className="queue-count-pill">{n}<span className="sr-only"> {n === 1 ? 'call' : 'calls'}</span></span>
          </h2>
        </summary>
        <div className="disclosure-body stack">
          {incomplete.note && <p className="meta">{incomplete.note}</p>}
          <IncompleteAnalysisList items={incomplete.items} />
        </div>
      </details>
    </section>
  );
}
