import { instrumentLine, itemList } from '../format';
import type { Screening } from '../types';

/**
 * What the set questions add up to. The point of this card is what it refuses to claim: Hachi asks
 * English questions about the same behaviour as the numbered items of Japan's Kihon Checklist, so
 * every domain is shown with how many of its items have an answer at all, and anything the answers
 * cannot settle is shown as unsettled rather than as a result.
 *
 * The same answers then appear a second time as each instrument's own result. Staff here work to
 * the Kihon domains, but the resident speaks English and may have a doctor who reads PHQ-2 and
 * STEADI instead, and neither frame can be derived from the other.
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

      <div className="table-scroll" role="region" aria-label="Screening question results" tabIndex={0}>
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
                  {d.missing.length > 0 && <span className="meta"> · {itemList(d.missing)} cannot be asked by phone</span>}
                </th>
                <td>
                  {d.answered} of {d.of}
                </td>
                <td>{d.flagged}</td>
                <td>
                  {/* A domain the checklist gives no rule to will never settle, so it is not called pending. */}
                  {d.criterion === 0 ? (
                    <span className="meta">No criterion of its own</span>
                  ) : (
                    <span className={tone(d.meets)}>{verdict(d.meets)}</span>
                  )}
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
      </div>

      <div>
        <h3>The instruments' own results</h3>
        <p className="meta">
          The same answers read the other way round: what each published instrument makes of its own items, on its own cutoff. This is
          the frame the resident's own doctor is likely to recognise.
        </p>
        {screening.instruments.map((i) => (
          <p key={i.instrument}>
            <strong>{i.instrument}</strong> {instrumentLine(i)}
          </p>
        ))}
      </div>

      <div>
        <p className="reason">{screening.loneliness.summary}</p>
        <p className="meta">
          {screening.shareMood
            ? 'Family updates about mood and loneliness are approved.'
            : 'Family updates about mood and loneliness are not approved.'}
        </p>
      </div>
    </section>
  );
}
