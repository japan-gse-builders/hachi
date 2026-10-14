import { useState } from 'react';
import { Link } from 'react-router';
import { openCounts, sortUnreached } from '../queue';
import { reachLevel, SEVERITY, urgencySeverity, worstSeverity } from '../signals';
import type { IncompleteAnalyses, Queue, UnreachedResident } from '../types';
import { IncompleteAnalysisList } from './IncompleteAnalyses';
import { LastReachedChip, SeverityChip, SeverityMark } from './Signals';

/** The triage key describes its urgency lanes, without the separate health indicator key. */
export function QueueLegend({ queue, includeClosed }: { queue: Queue; includeClosed: boolean }) {
  return (
    <ul className="queue-urgency-legend" aria-label="Urgency key">
      {queue.legend.map((level) => (
        <li key={level.urgency}>
          <SeverityChip spoken={false} severity={urgencySeverity(level.urgency)} label={level.label} />
          <span className="meta">{level.meaning ?? level.action}</span>
        </li>
      ))}
      {includeClosed && (
        <li>
          <SeverityChip spoken={false} severity="good" label="Closed" />
          <span className="meta">No further action needed for this case.</span>
        </li>
      )}
    </ul>
  );
}

/** Open cases at each urgency, colored as the lanes are; a zero stays gray so it reads as calm. */
export function QueueCounts({ queue }: { queue: Queue }) {
  return (
    <section className="queue-overview-panel" aria-label="Triage overview">
      <dl className="queue-counts">
        {openCounts(queue.items).map((c) => (
          <div key={c.urgency} className={`queue-count sev-${c.severity}${c.count ? '' : ' is-zero'}`}>
            <dt>
              <SeverityMark severity={c.severity} />
              {queue.legend.find((l) => l.urgency === c.urgency)?.label ?? SEVERITY[c.severity].label}
            </dt>
            <dd>{c.count}</dd>
          </div>
        ))}
        {queue.summary && (
          <div className="queue-count queue-count-residents">
            <dt>Patients registered</dt>
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
        Nobody has been reached <span className="queue-count-pill">{items.length}<span className="sr-only"> {items.length === 1 ? 'patient' : 'patients'}</span></span>
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

/** Wide screens show the check details; phones begin with the notice folded to its count. */
const wideScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1020px)').matches === true;

/**
 * Calls nothing finished looking at: our side, not a finding, so blue and dashed rather than an
 * urgency. Folded to its count on a phone, where it would come between staff and the cases.
 */
export function QueueUnchecked({ incomplete }: { incomplete: IncompleteAnalyses }) {
  const n = incomplete.items.length;
  const [open] = useState(wideScreen);
  return (
    <section className="card queue-notice queue-stripe sev-system" aria-labelledby="unchecked-heading">
      <details className="disclosure queue-notice-fold" open={open}>
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
