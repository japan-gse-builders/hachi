import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../account';
import { api } from '../api';
import { useAuth } from '../auth';
import { LoadError, Loading } from '../components/States';
import { TeamNav } from '../components/TeamNav';
import { formatWhen } from '../format';
import { actorName, atLeast, describeAudit, type AuditEntry } from '../orgs';
import { useDocumentTitle } from '../title';

type Page = { entries: AuditEntry[]; next: string | null };

/** Who did what in this organization, newest first. For admins: it names people and residents. */
export function ActivityPage() {
  useDocumentTitle('Activity');
  const { token } = useAuth();
  const { current } = useAccount();
  const allowed = atLeast(current?.role, 'admin');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      try {
        const page = await api<Page>(`/api/organization/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`, await token());
        setEntries((prev) => (before && prev ? [...prev, ...page.entries] : page.entries));
        setNext(page.next);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the activity');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  return (
    <div className="stack page">
      <header className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="meta">Changes to members, settings, patients and cases in {current?.orgName ?? 'this organization'}.</p>
        </div>
      </header>
      <TeamNav />
      {!allowed && <p className="card">Only admins can see the activity log.</p>}
      {allowed && error && <LoadError message={error} onRetry={() => void load()} />}
      {allowed && !entries && !error && <Loading label="Loading activity…" />}
      {entries && (
        <section className="card stack" aria-label="Activity">
          {entries.length === 0 ? (
            <p className="meta">Nothing yet.</p>
          ) : (
            <ol className="activity-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <span>{describeAudit(e)}</span>
                  <span className="meta">{actorName(e.actor)} · {formatWhen(e.at)}</span>
                </li>
              ))}
            </ol>
          )}
          {next && (
            <p>
              <button type="button" className="ghost" disabled={busy} onClick={() => void load(next)}>{busy ? 'Loading…' : 'Show older'}</button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
