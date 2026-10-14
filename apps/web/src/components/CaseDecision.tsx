import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CaseDetail } from '../types';

/**
 * Status first, as one tap; urgency and rank behind "Change urgency or rank", because changing them
 * needs a reason and is the rarer decision. `onSave` sends the change and reloads the case.
 */
export function CaseDecision({ detail, onSave }: { detail: CaseDetail; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const c = detail.case;
  const [status, setStatus] = useState(c.status);
  const [urgency, setUrgency] = useState(c.urgency);
  const [offset, setOffset] = useState(c.staffScoreOffset);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const reasonField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setStatus(c.status);
    setUrgency(c.urgency);
    setOffset(c.staffScoreOffset);
  }, [c.status, c.urgency, c.staffScoreOffset]);

  /** Any edit makes an earlier "saved" untrue for what is now on screen. */
  const edited = () => setSaved('');
  const priorityChanged = urgency !== c.urgency || offset !== c.staffScoreOffset;
  const changed = priorityChanged || status !== c.status;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved('');
    setReasonError('');
    const body: Record<string, unknown> = {};
    if (status !== c.status) body.status = status;
    if (urgency !== c.urgency) body.urgency = urgency;
    if (offset !== c.staffScoreOffset) body.scoreOffset = offset;
    if (reason.trim()) body.reason = reason.trim();
    if (status === 'closed') body.outcome = { anomalyConfirmed: confirmed, ...(note ? { note } : {}) };
    if (!body.status && !body.urgency && body.scoreOffset === undefined) {
      setError('Nothing has changed yet. Choose a status, or change the urgency or rank, then save.');
      return;
    }
    // The API refuses this too; saying so beside the field saves a round trip and keeps the place.
    if ((body.urgency || body.scoreOffset !== undefined) && !body.reason) {
      setReasonError('Give a reason for changing the urgency or rank.');
      reasonField.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave(body);
      setReason('');
      setNote('');
      setPriorityOpen(false);
      setSaved('Changes saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const urgencyLabel = detail.urgencyOptions.find((o) => o.value === urgency)?.label ?? c.urgencyLabel;
  const rank = offset === 0 ? '' : ` · rank ${offset > 0 ? '+' : ''}${offset}`;

  return (
    <form className="card stack case-decision" onSubmit={(e) => void save(e)} aria-labelledby="decision-heading">
      <h2 id="decision-heading">Update this case</h2>
      <fieldset className="case-status">
        <legend className="control-label">Status</legend>
        <div className="case-seg">
          {detail.statusOptions.map((o) => (
            <label key={o.value} className="case-seg-option">
              <input
                type="radio"
                name="case-status"
                value={o.value}
                checked={status === o.value}
                onChange={() => {
                  setStatus(o.value);
                  edited();
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {status === 'closed' && (
        <fieldset className="case-closing">
          <legend className="control-label">Closing this case</legend>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); edited(); }} />
            There was a real concern
          </label>
          <label>
            Note
            <textarea value={note} onChange={(e) => { setNote(e.target.value); edited(); }} rows={2} />
          </label>
        </fieldset>
      )}

      <details className="disclosure case-priority" open={priorityOpen || priorityChanged} onToggle={(e) => setPriorityOpen(e.currentTarget.open)}>
        <summary>
          Change urgency or rank
          <span className="disclosure-peek">
            Now {urgencyLabel}
            {rank}
          </span>
        </summary>
        <div className="stack disclosure-body">
          <label>
            Urgency
            <select value={urgency} aria-describedby="urgency-meaning" onChange={(e) => { setUrgency(e.target.value); edited(); }}>
              {detail.urgencyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p id="urgency-meaning" className="meta">{detail.urgencyOptions.find((o) => o.value === urgency)?.meaning}</p>
          <label>
            <span>Rank within this urgency <span className="hint">−10 to +10, higher comes first</span></span>
            <input type="number" inputMode="numeric" min={-10} max={10} step={1} value={offset} onChange={(e) => { setOffset(Number(e.target.value)); edited(); }} />
          </label>
        </div>
      </details>

      {(changed || reason) && (
        <label>
          <span>Reason <span className="hint">{priorityChanged ? 'needed for an urgency or rank change' : 'optional for a status change'}</span></span>
          <textarea
            ref={reasonField}
            value={reason}
            rows={2}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? 'reason-error' : undefined}
            onChange={(e) => { setReason(e.target.value); setReasonError(''); edited(); }}
          />
        </label>
      )}
      {reasonError && <p id="reason-error" className="field-error">{reasonError}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        <p className="notice-success" role="status">{saved}</p>
      </div>
    </form>
  );
}
