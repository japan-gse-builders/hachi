import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { callTimeZoneLabel } from '../schedule';
import { hasCallConsent } from '../privacy';
import type { Resident } from '../types';

export function DailyCallSchedule({ resident, canEdit, token, onSaved }: {
  resident: Resident;
  canEdit: boolean;
  token: () => Promise<string>;
  onSaved: (resident: Resident) => void;
}) {
  const [time, setTime] = useState(resident.callTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setTime(resident.callTime); }, [resident.id, resident.callTime]);
  const zone = callTimeZoneLabel(resident.timeZone);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || busy || time === resident.callTime) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const updated = await api<Resident>(`/api/residents/${encodeURIComponent(resident.id)}`, await token(), {
        method: 'PATCH', body: JSON.stringify({ callTime: time }),
      });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the call time. Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <section id="daily-call-schedule" className="card stack daily-call-schedule" aria-labelledby="schedule-heading">
      <h2 id="schedule-heading">Daily call schedule</h2>
      <p className="meta">{canEdit ? 'Choose a daily check-in time for' : 'Daily check-in time for'} {resident.preferredName || resident.name}. Each patient has their own schedule.</p>
      {canEdit ? (
        <form className="stack" onSubmit={(e) => void submit(e)}>
          <label htmlFor="daily-call-time">Call every day at
            <input id="daily-call-time" name="callTime" type="time" step={60} required value={time} disabled={busy}
              aria-describedby="schedule-time-zone" onChange={(e) => { setTime(e.target.value); setError(''); setSaved(false); }} />
          </label>
          <p id="schedule-time-zone" className="hint">{zone}</p>
          <div className="row">
            <button type="submit" disabled={busy || !time || time === resident.callTime}>{busy ? 'Saving…' : 'Save call time'}</button>
            {time !== resident.callTime && <button type="button" className="ghost" disabled={busy}
              onClick={() => { setTime(resident.callTime); setError(''); }}>Cancel</button>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {saved && <p className="notice-success" role="status">Call time saved.</p>}
        </form>
      ) : (
        <>
          <p className="schedule-time"><strong>{resident.callTime}</strong> <span className="meta">{zone}</span></p>
          <p className="meta">The assigned staff member or an admin can change this schedule.</p>
        </>
      )}
      {resident.synthetic && <p className="notice" role="note">This is a demo patient; no real calls are placed.</p>}
      {!hasCallConsent(resident.callConsent) && <p className="notice" role="note">First-use approval is needed before calls can start.</p>}
      {!resident.active && <p className="notice" role="note">Calls are paused. This time will be used when calls resume.</p>}
    </section>
  );
}
