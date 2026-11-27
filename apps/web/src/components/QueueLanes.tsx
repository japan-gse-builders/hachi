import { Link } from 'react-router';
import { formatWhen } from '../format';
import type { QueueLane } from '../queue';
import { urgencySeverity } from '../signals';
import type { QueueItem } from '../types';
import { ResidentAvatar } from './ResidentAvatar';
import { SeverityChip, SeverityMark } from './Signals';

function QueueCaseCard({ item, linkState }: { item: QueueItem; linkState: unknown }) {
  const severity = urgencySeverity(item.urgency);
  const closed = item.status === 'closed';
  const assignment = item.assignment;
  return (
    <li className={`card queue-case queue-stripe sev-${closed ? 'good' : severity}`}>
      <div className="queue-case-copy">
        <div className="queue-case-identity">
          <h3 className="resident-heading queue-case-name">
            <ResidentAvatar id={item.residentId} name={item.residentName} portrait={item.residentPortrait} />
            {item.residentName}
          </h3>
          <SeverityChip spoken={false} severity={severity} label={item.urgencyLabel} detail={item.urgencyMeaning} />
        </div>
        <p className="queue-case-summary" title={item.summary}>{item.summary || item.reason}</p>
        {(assignment || item.status === 'in_progress') && (
          <p className="queue-case-assignment meta">
            <strong>{item.statusLabel}</strong>
            {assignment ? <> · {assignment.name} · <time dateTime={assignment.claimedAt}>{formatWhen(assignment.claimedAt)} JST</time></> : ' · Unassigned'}
          </p>
        )}
      </div>
      <Link className="button ghost queue-case-action" to={`/staff/cases/${item.caseId}`} state={linkState}
        aria-label={`Review case for ${item.residentName}, ${item.urgencyLabel}`}>
        Review case
      </Link>
    </li>
  );
}

export function QueueLanes({ lanes, linkState, revealFolded = false }: { lanes: QueueLane[]; linkState: unknown; revealFolded?: boolean }) {
  return lanes.map((lane) => {
    const heading = (
      <h2 className="queue-lane-title">
        <SeverityMark severity={lane.severity} />
        {lane.urgency === null ? 'Closed cases' : lane.items[0]!.urgencyLabel}
        <span className="queue-count-pill">{lane.items.length}<span className="sr-only"> {lane.items.length === 1 ? 'case' : 'cases'}</span></span>
      </h2>
    );
    const list = (
      <ol className="queue-lane-items">
        {lane.items.map((item) => <QueueCaseCard key={item.caseId} item={item} linkState={linkState} />)}
      </ol>
    );
    if (lane.urgency === 'watch' || lane.urgency === null) {
      return (
        <details key={lane.key} className="card disclosure queue-fold" open={revealFolded}>
          <summary>{heading}</summary>
          <div className="disclosure-body">{list}</div>
        </details>
      );
    }
    return <section key={lane.key} className="queue-lane">{heading}{list}</section>;
  });
}
