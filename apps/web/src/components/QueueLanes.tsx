import { useId } from 'react';
import { Link } from 'react-router';
import { deliveryLabel, formatWhen } from '../format';
import { ageLabel, knownSignals, notifiedSummary, type QueueLane } from '../queue';
import { SEVERITY, uncheckedFor, urgencySeverity } from '../signals';
import type { Queue, QueueItem, UrgencyLegendItem } from '../types';
import { ResidentAvatar } from './ResidentAvatar';
import { IndicatorBar, SeverityChip } from './Signals';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Notified({ item }: { item: QueueItem }) {
  const summary = notifiedSummary(item.notifications);
  if (!summary.length) return null;
  return (
    <ul className="queue-notified" aria-label="Who was told">
      {summary.map((n) => (
        <li key={n.recipient} className={n.delivered ? '' : 'is-failed'}>
          <span className="queue-notified-mark" aria-hidden="true">{n.delivered ? '✓' : '×'}</span>
          {capital(n.recipient)}
          {!n.delivered && <span> not delivered</span>}
          <span className="sr-only">
            {' '}{n.items.map((i) => `by ${i.channel} (${deliveryLabel(i.delivery)}), ${formatWhen(i.sentAt)}`).join('; ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One case on one card. The resident's name is the link and covers the card; the indicator bar sits above it. */
function QueueCaseCard({ item, queue, now, linkState }: { item: QueueItem; queue: Queue; now: Date; linkState: unknown }) {
  const severity = urgencySeverity(item.urgency);
  const closed = item.status === 'closed';
  const signals = knownSignals(item.signals, {
    unreached: queue.unreached?.items.find((u) => u.residentId === item.residentId),
    unchecked: uncheckedFor(queue.incomplete, item.residentId),
  });
  return (
    <li className={`card queue-case queue-stripe sev-${closed ? 'good' : severity}${signals ? ' has-signals' : ''}${closed ? ' is-closed' : ''}`}>
      <div className="queue-case-sev">
        <SeverityChip spoken={false} severity={severity} label={item.urgencyLabel} detail={item.urgencyMeaning} />
      </div>
      <h4 className="resident-heading queue-case-name">
        <ResidentAvatar id={item.residentId} name={item.residentName} portrait={item.residentPortrait} />
        <Link className="queue-case-link" to={`/staff/cases/${item.caseId}`} state={linkState}>{item.residentName}</Link>
      </h4>
      <div className="queue-case-what">
        <p className="queue-case-summary">{item.summary}</p>
        {item.residentFacts?.length ? <p className="queue-case-facts meta">{item.residentFacts.join(' · ')}</p> : null}
        {signals && (
          <div className="queue-case-signals hide-from-lg">
            <IndicatorBar signals={signals} now={now} compact />
          </div>
        )}
      </div>
      {signals && (
        <div className="queue-case-signals queue-case-bar hide-below-lg">
          <IndicatorBar signals={signals} now={now} />
        </div>
      )}
      <p className="queue-case-when meta">
        <time dateTime={item.detectedAt} title={formatWhen(item.detectedAt)}>{ageLabel(item.detectedAt, now)}</time>
      </p>
      <div className="queue-case-state">
        <span className="queue-status">{item.statusLabel}</span>
        <Notified item={item} />
      </div>
    </li>
  );
}

function Lane({ lane, legend, queue, now, linkState }: { lane: QueueLane; legend: UrgencyLegendItem[]; queue: Queue; now: Date; linkState: unknown }) {
  const id = useId();
  const level = legend.find((l) => l.urgency === lane.urgency);
  const label = lane.urgency === null ? 'Closed' : (level?.label ?? lane.items[0]!.urgencyLabel);
  const n = lane.items.length;
  return (
    <section className="queue-lane" aria-labelledby={id}>
      <h3 id={id} className="queue-lane-title">
        <span className={`sev-mark sev-${lane.severity}`} aria-hidden="true">{SEVERITY[lane.severity].symbol}</span>
        <span>{label}</span>
        <span className="queue-count-pill">{n}<span className="sr-only"> {n === 1 ? 'case' : 'cases'}</span></span>
      </h3>
      <ol className="queue-lane-items">
        {lane.items.map((item) => <QueueCaseCard key={item.caseId} item={item} queue={queue} now={now} linkState={linkState} />)}
      </ol>
    </section>
  );
}

/** Cases grouped by urgency, in one column so reading order and priority order are the same. */
export function QueueLanes({ lanes, queue, now, linkState }: { lanes: QueueLane[]; queue: Queue; now: Date; linkState: unknown }) {
  return (
    <div className="queue-lanes">
      {lanes.map((lane) => <Lane key={lane.key} lane={lane} legend={queue.legend} queue={queue} now={now} linkState={linkState} />)}
    </div>
  );
}
