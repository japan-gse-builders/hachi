import { channelList, deliveryLabel, eventLabel, formatWhen, phoneDisplay } from '../format';
import type { Severity } from '../signals';
import type { CaseDetail } from '../types';
import { SeverityChip } from './Signals';

type Notification = CaseDetail['case']['notifications'][number];

const DELIVERED = new Set(['delivered', 'answered']);
const NOT_DELIVERED = new Set(['undelivered', 'failed', 'no_answer', 'busy', 'canceled']);

/** Delivered is good; anything the provider says did not arrive needs a look today; otherwise unknown. */
function deliverySeverity(n: Notification): Severity {
  const s = n.delivery?.status;
  if (s && NOT_DELIVERED.has(s)) return 'today';
  if (s && DELIVERED.has(s)) return 'good';
  return 'none';
}

const RECIPIENT: Record<string, string> = { staff: 'Staff', family: 'Family' };

export function CaseNotifications({ notifications }: { notifications: Notification[] }) {
  return (
    <section className="card stack case-notifications" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Who was told</h2>
      {notifications.length === 0 ? (
        <p className="meta">No notifications were sent for this case.</p>
      ) : (
        <ul className="case-told">
          {notifications.map((n, i) => (
            <li key={i}>
              <SeverityChip spoken={false} severity={deliverySeverity(n)} label={deliveryLabel(n.delivery)} />
              <span>
                <strong>{RECIPIENT[n.recipient] ?? n.recipient}</strong> by {channelList([n.channel])}
                <span className="meta"> · {formatWhen(n.sentAt)} · {n.address}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CaseAbout({ detail }: { detail: CaseDetail }) {
  const r = detail.resident;
  const v = r.vulnerability;
  return (
    <section className="card stack case-about" aria-labelledby="about-heading">
      <h2 id="about-heading">About this person</h2>
      <dl className="case-facts-list">
        <div><dt>Household</dt><dd>{v.livesAlone ? 'Lives alone' : 'Lives with others'}{r.householdNotes ? ` · ${r.householdNotes}` : ''}</dd></div>
        <div><dt>Support</dt><dd>{v.hasCloseSupporter ? 'Has a close supporter' : 'No close supporter recorded'}</dd></div>
        <div><dt>Care needs</dt><dd>{v.needsCare ? 'Needs care' : 'No care needs recorded'}</dd></div>
        <div><dt>Recorded conditions</dt><dd>{v.chronicConditions.join(', ') || 'None recorded'}</dd></div>
        <div>
          <dt>Assigned staff</dt>
          <dd>
            {r.staff ? (
              <>
                {r.staff.name} · <a href={`tel:${r.staff.phone}`}>{phoneDisplay(r.staff.phone)}</a>
                {r.staff.email && <> · <a href={`mailto:${r.staff.email}`}>{r.staff.email}</a></>}
              </>
            ) : (
              'Not available'
            )}
          </dd>
        </div>
        <div><dt>Why Hachi ranked it here</dt><dd>{detail.case.reason}</dd></div>
      </dl>
    </section>
  );
}

/** `options` names statuses and urgencies, so a change reads "Not started → In progress". */
export function CaseHistory({ events, options = [] }: { events: CaseDetail['events']; options?: { value: string; label: string }[] }) {
  if (events.length === 0) return null;
  const name = (v: string | number | null) => (typeof v === 'string' ? (options.find((o) => o.value === v)?.label ?? v) : String(v));
  return (
    <section className="card stack case-history" aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <ol className="case-events">
        {events.map((event, i) => (
          <li key={i}>
            <span className="meta">{formatWhen(event.at)}</span>
            <span>
              <strong>{eventLabel(event.type)}</strong>
              {event.from !== undefined && event.to !== undefined ? ` · ${name(event.from)} → ${name(event.to)}` : ''}
              {event.reason ? ` · ${event.reason}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
