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

  return (
    <div className="stack">
      <div className="row">
        <h2>Residents</h2>
        <Link className="button" to="/staff/residents/new">Add resident</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {residents?.map((r) => (
        <article className="card" key={r.id}>
          <h2>{r.name}</h2>
          <p className="meta">{[r.preferredName, r.phone, `daily call ${r.callTime}`, r.active ? 'active' : 'inactive'].filter(Boolean).join(' · ')}</p>
          <p className="meta">Resident {r.id}</p>
          <label>Import past calls (JSON)
            <input type="file" accept="application/json,.json" onChange={(e) => void importCalls(r.id, e)} />
          </label>
          {imported[r.id] && <p className="meta" role="status">{imported[r.id]}</p>}
        </article>
      ))}
    </div>
  );
}
