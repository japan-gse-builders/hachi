import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { audioAt, callStatusLabel, clock, eventLabel, formatWhen, minutes, speakerLabel, speechLine, urgencyTone } from '../format';
import type { CaseDetail } from '../types';

const STATUSES = [
  ['open', 'Not started'],
  ['in_progress', 'In progress'],
  ['closed', 'Done'],
] as const;

const URGENCIES = [
  ['emergency', 'Emergency'],
  ['urgent', 'Urgent'],
  ['action', 'Follow-up'],
  ['watch', 'Watch'],
] as const;

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
    <div className="stack">
      <section className={`card ${detail.case.urgency === 'emergency' ? 'card-emergency' : ''}`}>
        <span className={`badge ${urgencyTone(detail.case.urgency)}`}>{detail.case.urgencyLabel}</span>
        <h2>{detail.resident.name}</h2>
        <p className="reason">{detail.case.reason}</p>
        <p className="meta">{detail.case.ruleName} · since {formatWhen(detail.case.firstDetectedAt)} · {detail.resident.phone}</p>
        {detail.resident.householdNotes && <p className="meta">{detail.resident.householdNotes}</p>}
      </section>

      <section className="card">
        <h2>What was said</h2>
        {evidence.map((e, i) => (
          <blockquote className="quote" key={`${e.callId}-${i}`}>
            <p>“{e.quote}”</p>
            <p className="meta">{clock(e.startMs)}</p>
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

      <section className="card">
        <h2>Notifications</h2>
        {detail.case.notifications.length === 0 && <p className="meta">No notifications were sent for this case.</p>}
        {detail.case.notifications.map((n, i) => (
          <p key={i} className="meta">{formatWhen(n.sentAt)} · {n.recipient} · {n.channel} · {n.address}</p>
        ))}
      </section>

      {detail.speechTrend.length > 0 && (
        <section className="card">
          <h2>Speech over time</h2>
          {detail.speechTrend.map((point) => (
            <p key={point.callId} className="meta">{formatWhen(point.at)} · {speechLine(point.features)}</p>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Calls</h2>
        <div className="calls">
          {detail.calls.map((c) => (
            <article key={c.id}>
              <p className="meta">{formatWhen(c.startedAt)} · {callStatusLabel(c.status)}{c.durationSec !== null ? ` · ${minutes(c.durationSec)}` : ''}</p>
              {c.summary && (
                <>
                  <p><strong>Health.</strong> {c.summary.health}</p>
                  <p><strong>Meals.</strong> {c.summary.meals}</p>
                  {c.summary.topics.length > 0 && <p><strong>Topics.</strong> {c.summary.topics.join(', ')}</p>}
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      <form className="card stack" onSubmit={(e) => void save(e)}>
        <h2>Update this case</h2>
        {error && <p className="error">{error}</p>}
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Urgency
          <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            {URGENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
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

      {detail.events.length > 0 && (
        <section className="card">
          <h2>History</h2>
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
  );
}
