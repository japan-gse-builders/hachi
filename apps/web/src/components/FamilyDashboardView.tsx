import { channelList, familyDeliveryList, formatWhen, minutes, phoneDisplay, topicList } from '../format';
import type { FamilyDashboard } from '../types';
import { LatestCall, Legend, TagList, TagTrends, TwoWeekGrid } from './FamilyGlance';

/** FAM-02..04: what family see, without recordings, transcripts or anything about how the resident speaks. */
export function FamilyDashboardView({ data, now }: { data: FamilyDashboard; now: Date }) {
  const { staff, glance } = data;
  return (
    <>
      <section className="card family-hero">
        <h1>Daily calls with {data.resident.name}</h1>
        {glance && <LatestCall latest={glance.latest} now={now} shareMood={glance.shareMood} />}
        <p className="next-call">{data.nextCallAt ? `Next call: ${formatWhen(data.nextCallAt)}` : 'Daily calls are paused.'}</p>
        <p className="meta">Times are Japan time. Hachi calls once a day for a short chat.</p>
      </section>

      {data.alerts.length > 0 && (
        <section className="card" aria-labelledby="family-alerts-heading">
          <h2 id="family-alerts-heading">{data.receivesAlerts === false ? 'Alerts sent to the family contact' : 'Alerts sent to you'}</h2>
          {data.alerts.map((a) => (
            <p key={a.sentAt}>
              {formatWhen(a.sentAt)} · by {a.deliveries ? familyDeliveryList(a.deliveries) : channelList(a.channels)} ·{' '}
              <strong>{a.caseStatusLabel}</strong>
            </p>
          ))}
        </section>
      )}

      {/* Asking the care team is what a worried relative does next, so it comes before the history. */}
      <section className="card" aria-labelledby="care-team-heading">
        <h2 id="care-team-heading">Care team</h2>
        <p>{staff.name}</p>
        <div className="row">
          <a className="button" href={`tel:${staff.phone}`}>Call {phoneDisplay(staff.phone)}</a>
          {staff.email && <a className="button ghost" href={`mailto:${staff.email}`}>Email</a>}
        </div>
      </section>

      {glance && <TwoWeekGrid days={glance.days} shareMood={glance.shareMood} legend={<Legend />} />}
      {glance && <TagTrends trends={glance.trends} />}

      <section className="card" aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes from each call</h2>
        {data.calls.length === 0 ? (
          <p className="meta">No calls yet.</p>
        ) : (
          <details>
            <summary>Show the last two weeks ({data.calls.length} {data.calls.length === 1 ? 'call' : 'calls'})</summary>
            <div className="calls">
              {data.calls.map((c) => (
                <article key={c.startedAt}>
                  <p className="meta">
                    {formatWhen(c.startedAt)} · {c.connected ? `Talked${c.durationSec !== null ? ` for ${minutes(c.durationSec)}` : ''}` : 'Did not connect'}
                  </p>
                  {/* Not ready is not the same as nothing to say, so it is said rather than left blank. */}
                  {c.notesPending && <p className="meta">Hachi's notes on this call are not ready yet.</p>}
                  <TagList tags={c.tags ?? []} label={`Topics from the call on ${formatWhen(c.startedAt)}`} />
                  {c.summary && (
                    <>
                      <p><strong>Health.</strong> {c.summary.health}</p>
                      <p><strong>Meals.</strong> {c.summary.meals}</p>
                      {c.summary.topics.length > 0 && <p><strong>Talked about.</strong> {topicList(c.summary.topics)}</p>}
                    </>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}
