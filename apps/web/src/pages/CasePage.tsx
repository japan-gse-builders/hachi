import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ResidentAvatar } from '../components/ResidentAvatar';
import { CallNowButton } from '../components/CallNowButton';
import { ScreeningCard } from '../components/ScreeningCard';
import { SpeechTrendCard } from '../components/SpeechTrendCard';
import { audioAt, callStatusLabel, clock, deliveryLabel, eventLabel, formatWhen, minutes, speakerLabel, topicList, urgencyTone } from '../format';
import { staffTagLine } from '../glance';
import type { CaseDetail } from '../types';

export function CasePage() {
  const { id = '' } = useParams();
  const { token } = useAuth();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('open');
  const [urgency, setUrgency] = useState('');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(true);
  const [note, setNote] = useState('');

  const load = async () => {
    const data = await api<CaseDetail>(`/api/cases/${id}?locale=en`, await token());
    setDetail(data);
    setStatus(data.case.status);
    setUrgency(data.case.urgency);
    setOffset(data.case.staffScoreOffset);
  };

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this case'));
    // The case id is the only input. load closes over the latest token function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!detail) return;
    const body: Record<string, unknown> = {};
    if (status !== detail.case.status) body.status = status;
    if (urgency !== detail.case.urgency) body.urgency = urgency;
    if (offset !== detail.case.staffScoreOffset) body.scoreOffset = offset;
    if (reason.trim()) body.reason = reason.trim();
    if (status === 'closed') body.outcome = { anomalyConfirmed: confirmed, ...(note ? { note } : {}) };
    if (!body.status && !body.urgency && body.scoreOffset === undefined) return;
    try {
      await api(`/api/cases/${id}`, await token(), { method: 'PATCH', body: JSON.stringify(body) });
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  if (!detail) return error ? <p className="error">{error}</p> : <p>Loading…</p>;
  const call = detail.calls.find((c) => c.transcript?.length);
  const evidence = detail.detections.flatMap((d) => d.evidence);

  return (
    <div className="stack case">
      <section className={`card ${detail.case.urgency === 'emergency' ? 'card-emergency' : ''}`}>
        <p className="row">
          <span className={`badge ${urgencyTone(detail.case.urgency)}`}>{detail.case.urgencyLabel}</span>
          {/* One case on the screen, so what the level asks for is written out rather than hidden in a tooltip. */}
          <span className="meta">{detail.case.urgencyMeaning}</span>
        </p>
        <div className="resident-heading">
          <ResidentAvatar id={detail.resident.id} name={detail.resident.name} />
          <h1>{detail.resident.name}</h1>
        </div>
        {detail.resident.synthetic && <p className="meta">Synthetic demo resident, not a real person</p>}
        <p className="reason">{detail.case.reason}</p>
        <p className="meta">{detail.case.ruleName} · since {formatWhen(detail.case.firstDetectedAt)} · {detail.resident.phone}</p>
        {detail.resident.householdNotes && <p className="meta">{detail.resident.householdNotes}</p>}
        {/* The next step after reading a case is often to hear from them again (issue #13). */}
        {(detail.resident.callable ?? !detail.resident.synthetic) && (
          <CallNowButton residentId={detail.resident.id} name={detail.resident.preferredName || detail.resident.name} phone={detail.resident.phone} />
        )}
      </section>

      {/* On a laptop the evidence and the decision sit side by side with the case's own records. */}
      <div className="card stack case-column case-evidence">
        <section className="card">
          <h2>About this person</h2>
          <dl className="person-context">
            <div><dt>Household</dt><dd>{detail.resident.vulnerability.livesAlone ? 'Lives alone' : 'Lives with others'}{detail.resident.householdNotes ? ` · ${detail.resident.householdNotes}` : ''}</dd></div>
            <div><dt>Support</dt><dd>{detail.resident.vulnerability.hasCloseSupporter ? 'Has a close supporter' : 'No close supporter recorded'}</dd></div>
            <div><dt>Care needs</dt><dd>{detail.resident.vulnerability.needsCare ? 'Needs care' : 'No care needs recorded'}</dd></div>
            <div><dt>Recorded conditions</dt><dd>{detail.resident.vulnerability.chronicConditions.join(', ') || 'None recorded'}</dd></div>
            <div><dt>Assigned staff</dt><dd>{detail.resident.staff ? <>{detail.resident.staff.name} · <a href={`tel:${detail.resident.staff.phone}`}>{detail.resident.staff.phone}</a>{detail.resident.staff.email && <> · <a href={`mailto:${detail.resident.staff.email}`}>{detail.resident.staff.email}</a></>}</> : 'Not available'}</dd></div>
          </dl>
        </section>
        <section className="card">
          <h2 className="eyebrow">What was said</h2>
          {detail.detections.filter((d) => d.noResponse).map((d, i) => (
            <p key={`no-response-${i}`}>{d.summary} This is an observation of silence; there is no resident quote.</p>
          ))}
          {evidence.map((e, i) => (
            <blockquote className="quote" key={`${e.callId}-${i}`}>
              {/* The quote is what makes the case checkable, so it reads before the rule that found it. */}
              <p className="quote-words">“{e.quote}”</p>
              <p className="meta">
                In their own words · {clock(e.startMs)} into the call
                {detail.resident.synthetic ? ' · Synthetic demo resident, not a real person' : ''}
              </p>
              {e.audioUrl && (
                <audio controls preload="metadata" src={audioAt(e.audioUrl, e.startMs)}>
                  <track kind="captions" />
                </audio>
              )}
            </blockquote>
          ))}
          {call && (
            <div className="transcript">
              {call.transcript!.map((t, i) => (
                <p key={i} className={t.speaker === 'agent' ? 'agent' : ''}>
                  <strong>{speakerLabel(t.speaker, detail.resident.name)}: </strong>
                  {t.text}
                </p>
              ))}
            </div>
          )}
        </section>
  
        {detail.speechTrend.length > 0 && <SpeechTrendCard trend={detail.speechTrend} baseline={detail.speechBaseline} />}

        {detail.screening && <ScreeningCard screening={detail.screening} />}
  
        <form className="card stack" onSubmit={(e) => void save(e)}>
          <h2>Update this case</h2>
          {error && <p className="error">{error}</p>}
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {detail.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>Urgency
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {detail.urgencyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p className="meta">{detail.urgencyOptions.find((o) => o.value === urgency)?.meaning}</p>
          <label>Rank adjustment within this urgency (−10 to +10, higher comes first)
            <input type="number" min={-10} max={10} step={1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
          </label>
          <label>Reason (required when changing urgency or rank)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </label>
          {status === 'closed' && (
            <>
              <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />There was a real concern</label>
              <label>Note<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></label>
            </>
          )}
          <button type="submit">Save</button>
        </form>
      </div>

      <div className="card stack case-column case-records">
        <section className="card">
          <h2 className="eyebrow">Notifications</h2>
          {detail.case.notifications.length === 0 && <p className="meta">No notifications were sent for this case.</p>}
          {detail.case.notifications.map((n, i) => (
            <p key={i} className="meta">{formatWhen(n.sentAt)} · {n.recipient} · {n.channel} · {n.address} · {deliveryLabel(n.delivery)}</p>
          ))}
        </section>
  
        <section className="card">
          <h2 className="eyebrow">Calls</h2>
          <div className="calls">
            {detail.calls.map((c) => (
              <article key={c.id}>
                <p className="meta">
                  {formatWhen(c.startedAt)} · {callStatusLabel(c.status)}{c.durationSec !== null ? ` · ${minutes(c.durationSec)}` : ''}
                  {c.trigger === 'staff' ? ' · Called at staff request' : ''}
                </p>
                {c.wellbeing && c.wellbeing.tags.length > 0 && (
                  <ul className="tag-list" aria-label="Wellbeing tags with the turn each came from">
                    {c.wellbeing.tags.map((t) => (
                      <li key={t.id} className={`tag ${t.polarity} ${t.basis}`} title={t.quote ?? undefined}>{staffTagLine(t)}</li>
                    ))}
                  </ul>
                )}
                {c.summary && (
                  <>
                    <p><strong>Health.</strong> {c.summary.health}</p>
                    <p><strong>Meals.</strong> {c.summary.meals}</p>
                    {c.summary.topics.length > 0 && <p><strong>Topics.</strong> {topicList(c.summary.topics)}</p>}
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
  
        {detail.events.length > 0 && (
          <section className="card">
            <h2 className="eyebrow">History</h2>
            {detail.events.map((event, i) => (
              <p key={i} className="meta">
                {formatWhen(event.at)} · {eventLabel(event.type)}
                {event.from !== undefined && event.to !== undefined ? ` · ${String(event.from)} → ${String(event.to)}` : ''}
                {event.reason ? ` · ${event.reason}` : ''}
              </p>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
