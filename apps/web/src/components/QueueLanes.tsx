import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { channelList, deliveryLabel, formatWhen } from '../format';
import { ageLabel, knownSignals, notifiedSummary, type QueueLane } from '../queue';
import { uncheckedFor, urgencySeverity } from '../signals';
import type { Queue, QueueItem, UrgencyLegendItem } from '../types';
import { ResidentAvatar } from './ResidentAvatar';
import { IndicatorBar, placeTip, SeverityMark } from './Signals';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function NotificationInfo({ notification: n, open, onOpenChange }: {
  notification: ReturnType<typeof notifiedSummary>[number];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const item = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (!open || !item.current) return;
    const position = () => {
      const trigger = item.current;
      if (!trigger) return;
      placeTip(trigger);
      const tip = trigger.querySelector<HTMLElement>('.sev-tip');
      if (!tip) return;
      const rect = trigger.getBoundingClientRect();
      const below = Math.max(0, document.documentElement.clientHeight - rect.bottom - 14);
      const above = Math.max(0, rect.top - 14);
      const up = tip.scrollHeight > below && above > below;
      tip.style.setProperty('--notification-tip-room', `${up ? above : below}px`);
      tip.style.setProperty('--notification-tip-top', up ? `${-tip.offsetHeight - 6}px` : 'calc(100% + 6px)');
    };
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false); };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open, n.items, onOpenChange]);

  return (
    <li
      ref={item}
      className={`queue-notification${n.delivered ? '' : ' is-failed'}${open ? ' is-open' : ''}`}
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) onOpenChange(false); }}
    >
      <button
        type="button"
        className="queue-notified-trigger"
        aria-label={`${capital(n.recipient)} notification details${n.delivered ? '' : ' (not delivered)'}`}
        aria-describedby={id}
        onFocus={() => onOpenChange(true)}
        onBlur={() => onOpenChange(false)}
        onClick={() => onOpenChange(true)}
      >
        <span className="queue-notified-mark" aria-hidden="true">{n.delivered ? '✓' : '×'}</span>
        <span className="queue-notified-name">{capital(n.recipient)}{!n.delivered && ' not delivered'}</span>
      </button>
      <div id={id} className="sev-tip queue-notification-tip" role="tooltip">
        <strong>{capital(n.recipient)} notification</strong>
        <p>{n.delivered ? 'Hachi sent an alert. No delivery failure is recorded.' : 'At least one alert could not be delivered.'}</p>
        <ul>
          {n.items.map((i, index) => (
            <li key={index}>
              <span>{capital(channelList([i.channel]))}: {deliveryLabel(i.delivery)}</span>
              <time dateTime={i.sentAt}>Sent {formatWhen(i.sentAt)}</time>
            </li>
          ))}
        </ul>
        <p>This mark does not confirm that the alert was read or acted on.</p>
      </div>
    </li>
  );
}

function Notified({ item }: { item: QueueItem }) {
  const [open, setOpen] = useState<string | null>(null);
  const summary = notifiedSummary(item.notifications);
  if (!summary.length) return null;
  return (
    <ul className="queue-notified" aria-label="Notification status">
      {summary.map((n) => (
        <NotificationInfo key={n.recipient} notification={n} open={open === n.recipient}
          onOpenChange={(show) => setOpen((current) => show ? n.recipient : current === n.recipient ? null : current)} />
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
      <h4 className="resident-heading queue-case-name">
        <ResidentAvatar id={item.residentId} name={item.residentName} />
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
  const ask = lane.urgency === null ? 'No action needed' : level?.action;
  const n = lane.items.length;
  return (
    <section className="queue-lane" aria-labelledby={id}>
      <h3 id={id} className="queue-lane-title">
        <SeverityMark severity={lane.severity} />
        <span>{label}</span>
        <span className="queue-count-pill">{n}<span className="sr-only"> {n === 1 ? 'case' : 'cases'}</span></span>
        {ask && <span className="queue-lane-ask">{ask}</span>}
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
