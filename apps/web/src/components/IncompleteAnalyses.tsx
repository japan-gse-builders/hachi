import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatWhen } from '../format';
import type { IncompleteAnalysis } from '../types';

/**
 * Issue #11: calls the analysis could not finish. Each says what is unchecked and what still ran,
 * and offers to run the analysis again. Deliberately without an urgency badge: a failure on our side
 * is not a finding about the resident.
 */
export function IncompleteAnalysisList({ items, showResident = true }: { items: IncompleteAnalysis[]; showResident?: boolean }) {
  const { token } = useAuth();
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const request = async (item: IncompleteAnalysis, key: string) => {
    setBusy(key);
    setErrors((prev) => ({ ...prev, [key]: '' }));
    try {
      await api(`/api/residents/${item.residentId}/calls/${item.callId}/reanalysis`, await token(), { method: 'POST' });
      setRequested((prev) => ({ ...prev, [key]: true }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Could not ask for this call to be analysed again' }));
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) return null;
  return (
    <ul className="gaps" aria-label="Calls that could not be fully checked">
      {items.map((item) => {
        const key = `${item.residentId}/${item.callId}`;
        const pending = item.reanalysisRequested || requested[key];
        return (
          <li key={key}>
            <p className="row">
              <span className="badge unchecked">Not fully checked</span>
              {showResident && <strong>{item.residentName}</strong>}
              <span className="meta">
                Call on {formatWhen(item.startedAt)} · {item.reasons.join(', ')}
              </span>
            </p>
            <p>{item.notChecked}</p>
            <p className="meta">{item.checked}</p>
            {pending ? (
              <p className="meta" role="status">Asked to analyse again. The result usually appears within about 10 minutes.</p>
            ) : (
              <button className="ghost" type="button" disabled={busy !== null} onClick={() => void request(item, key)}>
                {busy === key ? 'Asking…' : 'Analyse again'}
              </button>
            )}
            {errors[key] && <p className="error" role="alert">{errors[key]}</p>}
          </li>
        );
      })}
    </ul>
  );
}
