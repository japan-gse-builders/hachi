import { channelList, familyDeliveryList, formatWhen, minutes, phoneDisplay, topicList } from '../format';
import { familyDays, familyStatus, lastTalkedLevel, missedDays, nextCallLabel, todayCallNote } from '../glance';
import type { FamilyDashboard } from '../types';
import { FamilyStatusCard, LatestCall, TagList, TagTrends } from './FamilyGlance';
import { FamilyTwoWeeks } from './FamilyTwoWeeks';
import { SeverityChip } from './Signals';

/**
 * FAM-02..04: what family see, without recordings, transcripts or anything about how the resident
 * speaks. How she is comes first, then today and the two weeks; on a phone they stack in that order.
 */
export function FamilyDashboardView({ data, now }: { data: FamilyDashboard; now: Date }) {
  const { staff, glance } = data;
  const shareMood = glance?.shareMood === true;
  const callsActive = data.nextCallAt !== null;
  const days = glance ? familyDays(glance.days, data.calls, now, callsActive) : [];
  const latest = glance?.latest ?? null;
  const latestNotesPending = !!latest && data.calls.some((c) => c.startedAt === latest.startedAt && c.notesPending === true);
  const status = glance
    ? familyStatus({ name: data.resident.name, latest, days, shareMood, callsActive, anyCalls: data.calls.length > 0, latestNotesPending, now })
    : null;
  const reach = glance ? lastTalkedLevel(latest?.startedAt ?? null, missedDays(days), now) : null;
  const todayNote = todayCallNote(data.nextCallAt, now);

  return (
    <>
      <FamilyStatusCard name={data.resident.name} status={status} reach={reach} next={nextCallLabel(data.nextCallAt, now)} careTeamPhone={staff.phone} />

      <div className="family-layout">
        <div className="family-col">
          {glance && <LatestCall latest={latest} now={now} shareMood={shareMood} notesPending={latestNotesPending} />}

          {data.alerts.length > 0 && (
            <section className="card family-alerts-card" aria-labelledby="family-alerts-heading">
              <h2 id="family-alerts-heading">{data.receivesAlerts === false ? 'Alerts sent to the family contact' : 'Alerts sent to you'}</h2>
              <ul className="family-alerts">
                {data.alerts.map((a) => (
                  <li key={a.sentAt}>
                    <span>
                      {formatWhen(a.sentAt)} · by {a.deliveries ? familyDeliveryList(a.deliveries) : channelList(a.channels)}
                    </span>
                    <SeverityChip spoken={false} severity={a.caseStatus === 'closed' ? 'good' : 'monitor'} label={`Care team: ${a.caseStatusLabel}`} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card family-care" aria-labelledby="care-team-heading">
            <h2 id="care-team-heading">Care team</h2>
            <p>{staff.name}</p>
            <div className="row">
              <a className={status?.askCareTeam ? 'button ghost' : 'button'} href={`tel:${staff.phone}`}>Call {phoneDisplay(staff.phone)}</a>
              {staff.email && <a className="button ghost" href={`mailto:${staff.email}`}>Email</a>}
            </div>
          </section>
        </div>

        <div className="family-col">
          {glance && <FamilyTwoWeeks days={days} shareMood={shareMood} name={data.resident.name} todayNote={todayNote} />}
          {glance && <TagTrends trends={glance.trends} />}

          <section className="card family-notes" aria-labelledby="notes-heading">
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
                        {formatWhen(c.startedAt)} · {c.connected ? `Talked${c.durationSec !== null ? ` for ${minutes(c.durationSec)}` : ''}` : "Didn't get through"}
                      </p>
                      {/* Not ready is not the same as nothing to say, so it is said rather than left blank. */}
                      {c.notesPending && <p className="meta">Hachi&apos;s notes on this call are not ready yet.</p>}
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
        </div>
      </div>
    </>
  );
}
