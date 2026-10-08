import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Resident } from '../types';

export function ResidentsPage() {
  const { token } = useAuth();
  const [residents, setResidents] = useState<Resident[] | null>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<Record<string, string>>({});
  useEffect(() => {
    void token()
      .then((t) => api<{ residents: Resident[] }>('/api/residents', t))
      .then((data) => setResidents(data.residents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load residents'));
  }, [token]);

  // USR-04: a JSON file of {"calls": [{startedAt, endedAt, transcript}]} for demos and baselines.
  const importCalls = async (residentId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const show = (message: string) => setImported((prev) => ({ ...prev, [residentId]: message }));
    try {
      const body = JSON.stringify(JSON.parse(await file.text()));
      const result = await api<{ imported: number; usableForBaseline: number }>(
        `/api/residents/${residentId}/calls/import`,
        await token(),
        { method: 'POST', body },
      );
      show(`Imported ${result.imported} calls, ${result.usableForBaseline} usable for the speech baseline.`);
    } catch (err) {
      show(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Import failed');
    }
  };

  /**
   * Recorded from what the resident said, so it is a thing staff tick after a conversation rather
   * than a setting. Until it is ticked, the family is told nothing about how the resident is in
   * themselves, however well meant that would be.
   */
  const setConsent = async (residentId: string, shareMood: boolean) => {
    setResidents((prev) => prev?.map((r) => (r.id === residentId ? { ...r, consent: { ...r.consent, shareMood } } : r)) ?? prev);
    try {
      const saved = await api<Resident>(`/api/residents/${residentId}`, await token(), {
        method: 'PATCH',
        body: JSON.stringify({ shareMood }),
      });
      setResidents((prev) => prev?.map((r) => (r.id === residentId ? saved : r)) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    }
  };

  return (
    <div className="stack tiles">
      <div className="row">
        <h1>Residents</h1>
        <Link className="button" to="/staff/residents/new">Add resident</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {residents?.map((r) => (
        <article className="card" key={r.id}>
          <h2>{r.name}</h2>
          <p className="meta">{[r.preferredName, r.phone, `daily call ${r.callTime}`, r.active ? 'active' : 'inactive'].filter(Boolean).join(' · ')}</p>
          <p className="meta">Resident {r.id}</p>
          <label className="check">
            <input type="checkbox" checked={Boolean(r.consent?.shareMood)} onChange={(e) => void setConsent(r.id, e.target.checked)} />
            Agreed their family may be told how they are in themselves
          </label>
          <label className="file">Import past calls (JSON)
            <input type="file" accept="application/json,.json" onChange={(e) => void importCalls(r.id, e)} />
            <span className="button ghost">Choose a file</span>
          </label>
          {imported[r.id] && <p className="meta" role="status">{imported[r.id]}</p>}
        </article>
      ))}
    </div>
  );
}
