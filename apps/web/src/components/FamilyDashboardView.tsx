import { channelList, familyDeliveryList, formatWhen, minutes, phoneDisplay, topicList } from '../format';
import type { FamilyDashboard } from '../types';
import { LatestCall, Legend, TagList, TagTrends, TwoWeekGrid } from './FamilyGlance';

/** FAM-02..04: what family see, without recordings, transcripts or anything about how the resident speaks. */
export function FamilyDashboardView({ data, now }: { data: FamilyDashboard; now: Date }) {
  const { staff, glance } = data;
  return (
    <>
      {glance && <Legend />}
      <section className="card">
        <h1>Daily calls with {data.resident.name}</h1>
        {glance && <LatestCall latest={glance.latest} now={now} shareMood={glance.shareMood} />}
        <p>{data.nextCallAt ? `Next call: ${formatWhen(data.nextCallAt)}` : 'Daily calls are paused.'}</p>
        <p className="meta">Times are Japan time. Hachi calls once a day for a short chat.</p>
      </section>

      {data.alerts.length > 0 && (
        <section className="card">
          <h2 className="eyebrow">Alerts sent to you</h2>
          {data.alerts.map((a) => (
            <p key={a.sentAt}>
              {formatWhen(a.sentAt)} · by {a.deliveries ? familyDeliveryList(a.deliveries) : channelList(a.channels)} ·{' '}
              <strong>{a.caseStatusLabel}</strong>
            </p>
          ))}
        </section>
      )}

      {glance && <TwoWeekGrid days={glance.days} shareMood={glance.shareMood} />}
      {glance && <TagTrends trends={glance.trends} />}

      <section className="card">
        <h2 className="eyebrow">Care team</h2>
        <p>{staff.name}</p>
        <div className="row">
          <a className="button" href={`tel:${staff.phone}`}>Call {phoneDisplay(staff.phone)}</a>
          {staff.email && <a className="button ghost" href={`mailto:${staff.email}`}>Email</a>}
        </div>
      </section>

      <section className="card">
        <h2 className="eyebrow">Notes from each call</h2>
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
