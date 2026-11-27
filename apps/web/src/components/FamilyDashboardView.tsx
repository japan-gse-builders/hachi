import { channelList, familyDeliveryList, formatWhen, minutes, topicList } from '../format';
import { familyDate, familyDays, familyStatus, familyTime, familyToday, lastTalkedLevel, missedDays, nextCallLabel, todayCallNote } from '../glance';
import type { Severity } from '../signals';
import type { FamilyDashboard } from '../types';
import { LatestCall, TagList, TagTrends } from './FamilyGlance';
import { FamilyTwoWeeks } from './FamilyTwoWeeks';
import { ResidentAvatar } from './ResidentAvatar';
import { SeverityChip, SeverityMark } from './Signals';

const TODAY: Record<NonNullable<FamilyDashboard['today']>['status'], { label: string; severity: Severity }> = {
  talked: { label: 'Talked with Hachi', severity: 'good' },
  before_call: { label: 'Scheduled for later today', severity: 'none' },
  waiting: { label: 'No call recorded yet', severity: 'none' },
  calling: { label: 'Call in progress', severity: 'none' },
  missed: { label: 'Hachi called but could not get through', severity: 'soon' },
  interrupted: { label: 'Hachi could not complete the call', severity: 'system' },
  no_reply: { label: 'The call connected and Hachi heard no reply', severity: 'soon' },
  paused: { label: 'No call scheduled today', severity: 'none' },
};

function TodayCard({ data, now }: { data: FamilyDashboard; now: Date }) {
  const { resident, staff, timeZone } = data;
  const today = familyToday(data, now);
  const level = TODAY[today.status];
  const date = familyDate(now, timeZone);
  const hasAlert = data.alerts.some((alert) => alert.caseStatus !== 'closed' && familyDate(new Date(alert.sentAt), timeZone) === date);
  const time = today.status === 'talked' || today.status === 'missed' || today.status === 'no_reply' ? today.at : null;

  return (
    <header className="card family-today">
      <div className="resident-heading family-heading">
        <ResidentAvatar id={resident.id} name={resident.name} portrait={resident.portrait} />
        <h1 className="family-name"><span className="family-name-lead">Daily calls with</span> <span>{resident.name}</span></h1>
      </div>
      <div className="family-today-grid">
        <section className={`family-today-result sev-${level.severity}`} aria-labelledby="family-today-heading">
          <h2 id="family-today-heading">Today&apos;s call</h2>
          <p className="family-today-label"><SeverityMark severity={level.severity} />{level.label}</p>
          {time && <p className="meta"><time dateTime={time}>{familyTime(new Date(time), timeZone)}</time></p>}
          {today.status === 'waiting' && <p className="meta">Today&apos;s scheduled time has passed.</p>}
          {hasAlert && <p className="meta">Hachi sent a family alert today.</p>}
        </section>
        <section className="family-next" aria-labelledby="family-next-heading">
          <h2 id="family-next-heading">Next scheduled call</h2>
          <p>{data.nextCallAt ? <time dateTime={data.nextCallAt}>{nextCallLabel(data.nextCallAt, now, timeZone)}</time> : nextCallLabel(null, now, timeZone)}</p>
        </section>
        <section className="family-contact" aria-labelledby="family-care-heading">
          <h2 id="family-care-heading">Care team</h2>
          {staff.name && <p className="meta">{staff.name}</p>}
          {(staff.phone || staff.email) ? (
            <div className="row">
              {staff.phone && <a className="button" href={`tel:${staff.phone}`}>Call the care team</a>}
              {staff.email && <a className={`button${staff.phone ? ' ghost' : ''}`} href={`mailto:${staff.email}`}>Email</a>}
            </div>
          ) : <p>Contact details are unavailable.</p>}
        </section>
      </div>
    </header>
  );
}

export function FamilyDashboardView({ data, now }: { data: FamilyDashboard; now: Date }) {
  const { glance, timeZone } = data;
  const shareMood = glance?.shareMood === true;
  const callsActive = data.nextCallAt !== null;
  const days = glance ? familyDays(glance.days, data.calls, now, callsActive, timeZone) : [];
  const latest = glance?.latest ?? null;
  const latestCall = latest && data.calls.find((c) => c.startedAt === latest.startedAt);
  const latestNotesPending = latestCall?.notesPending === true;
  const status = glance && !latestCall?.noReply
    ? familyStatus({ name: data.resident.name, latest, days, shareMood, callsActive, anyCalls: data.calls.length > 0, latestNotesPending, now })
    : null;
  const reach = latest && !latestCall?.noReply ? lastTalkedLevel(latest.startedAt, missedDays(days), now, timeZone) : null;
  const todayNote = todayCallNote(data.nextCallAt, now, timeZone);

  return (
    <>
      <TodayCard data={data} now={now} />
      <details className="card disclosure family-disclosure">
        <summary>Call history <span className="disclosure-peek">Last 14 days</span></summary>
        <div className="disclosure-body stack">
          {status && (
            <section className="family-recap stack stack-s">
              <h2>{status.title}</h2>
              {status.body && <p>{status.body}</p>}
              {reach && <p className="meta">{reach.word}</p>}
            </section>
          )}
          <div className="family-layout">
            <div className="family-col">
              {glance && <LatestCall latest={latest} now={now} shareMood={shareMood} notesPending={latestNotesPending} timeZone={timeZone} />}
              <section className="card stack" aria-labelledby="notes-heading">
                <h2 id="notes-heading">Notes from each call</h2>
                {data.calls.length === 0 ? <p className="meta">No calls yet.</p> : (
                  <div className="calls">
                    {data.calls.map((c, i) => (
                      <article key={`${c.startedAt}-${i}`}>
                        <p className="meta">
                          {formatWhen(c.startedAt, timeZone)} · {c.noReply ? 'Connected. Hachi heard no reply.' : c.connected ? `Connected${c.durationSec !== null ? ` for ${minutes(c.durationSec)}` : ''}` : "Didn't get through"}
                        </p>
                        {c.notesPending && <p className="meta">Hachi&apos;s notes on this call are still being prepared.</p>}
                        <TagList tags={c.tags ?? []} label={`Topics from the call on ${formatWhen(c.startedAt, timeZone)}`} />
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
                )}
              </section>
            </div>
            {glance && (
              <div className="family-col">
                <FamilyTwoWeeks days={days} shareMood={shareMood} name={data.resident.name} todayNote={todayNote} />
                <TagTrends trends={glance.trends} />
              </div>
            )}
          </div>
        </div>
      </details>

      {data.alerts.length > 0 && (
        <details className="card disclosure family-disclosure">
          <summary>{data.receivesAlerts === false ? 'Alerts sent to the family contact' : 'Family alerts'} <span className="disclosure-peek">{data.alerts.length}</span></summary>
          <div className="disclosure-body">
            <ul className="family-alerts">
              {data.alerts.map((a, i) => (
                <li key={`${a.sentAt}-${i}`}>
                  <span>{formatWhen(a.sentAt, timeZone)} · by {a.deliveries ? familyDeliveryList(a.deliveries) : channelList(a.channels)}</span>
                  <SeverityChip spoken={false} severity={a.caseStatus === 'closed' ? 'good' : 'monitor'} label={`Care team: ${a.caseStatusLabel}`} />
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </>
  );
}
