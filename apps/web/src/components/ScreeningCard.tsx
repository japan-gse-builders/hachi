import type { Screening } from '../types';

/**
 * What the set questions add up to. The point of this card is what it refuses to claim: Hachi asks
 * English questions about the same behaviour as the numbered items of Japan's Kihon Checklist, so
 * every domain is shown with how many of its items have an answer at all, and anything the answers
 * cannot settle is shown as unsettled rather than as a result.
 */
export function ScreeningCard({ screening }: { screening: Screening }) {
  const verdict = (meets: boolean | null) => (meets === null ? 'Needs more answers' : meets ? 'Criteria met' : 'Below criteria');
  const tone = (meets: boolean | null) => `badge ${meets === null ? 'action' : meets ? 'urgent' : 'watch'}`;

  return (
    <section className="card stack">
      <h2>Screening questions</h2>
      <p className="meta">
        Hachi asks English questions about the same behaviour as the numbered items of the Kihon Checklist, two per call. This is not a
        Kihon Checklist score and not an assessment.
      </p>

      <table className="screening">
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Answered</th>
            <th scope="col">Flagged</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {screening.domains.map((d) => (
            <tr key={d.domain}>
              <th scope="row">
                {d.label}
                {d.missing.length > 0 && <span className="meta"> · item {d.missing.join(', ')} cannot be asked by phone</span>}
              </th>
              <td>
                {d.answered} of {d.of}
              </td>
              <td>{d.flagged}</td>
              <td>
                <span className={tone(d.meets)}>{verdict(d.meets)}</span>
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">Items 1–20 together</th>
            <td>
              {screening.overall.answered} of {screening.overall.of}
            </td>
            <td>{screening.overall.flagged}</td>
            <td>
              <span className={tone(screening.overall.meets)}>{verdict(screening.overall.meets)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div>
        {screening.instruments.map((i) => (
          <p key={i.instrument}>
            <strong>{i.instrument}</strong> {i.positive === null ? `answered ${i.answered} of ${i.of}, so it cannot be read yet` : `${i.score}, ${i.positive ? 'at or above its cutoff' : 'below its cutoff'}`}
          </p>
        ))}
      </div>

      <div>
        <p className="reason">{screening.loneliness.summary}</p>
        <p className="meta">
          {screening.shareMood
            ? 'The resident agreed their family may be told how they are in themselves.'
            : 'The resident has not agreed to their family being told how they are in themselves, so the family is told nothing about this.'}
        </p>
      </div>
    </section>
  );
}
