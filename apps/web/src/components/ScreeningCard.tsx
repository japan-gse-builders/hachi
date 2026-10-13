import { useId } from 'react';
import { instrumentLine, itemList } from '../format';
import type { Severity } from '../signals';
import type { Screening } from '../types';
import { CaseChip } from './CaseChip';

const verdict = (meets: boolean | null) => (meets === null ? 'Needs more answers' : meets ? 'Criteria met' : 'Below criteria');
const severity = (meets: boolean | null): Severity => (meets === null ? 'none' : meets ? 'today' : 'good');

/**
 * What the set questions add up to. The point of this card is what it refuses to claim: Hachi asks
 * English questions about the same behaviour as the numbered items of Japan's Kihon Checklist, so
 * every domain is shown with how many of its items have an answer at all, and anything the answers
 * cannot settle is shown as unsettled rather than as a result.
 *
 * The same answers then appear a second time as each instrument's own result. Staff here work to
 * the Kihon domains, but the resident speaks English and may have a doctor who reads PHQ-2 and
 * STEADI instead, and neither frame can be derived from the other.
 *
 * Closed, it says only how far the answers have got and which areas meet their criteria.
 */
export function ScreeningCard({ screening }: { screening: Screening }) {
  const headingId = useId();
  const { overall } = screening;
  const met = screening.domains.filter((d) => d.criterion !== 0 && d.meets === true);
  const share = overall.of ? Math.round((overall.answered / overall.of) * 100) : 0;
  const tone = (meets: boolean | null) => `badge ${meets === null ? 'action' : meets ? 'urgent' : 'watch'}`;

  return (
    <section className="card stack case-screening" aria-labelledby={headingId}>
      <div className="cluster case-card-head">
        <h2 id={headingId}>Screening questions</h2>
        <CaseChip
          severity={severity(overall.meets)}
          label={overall.meets === null ? 'Not enough answers yet' : verdict(overall.meets)}
          detail="Items 1 to 20 together."
        />
      </div>
      <div className="case-meter">
        <span className="case-meter-bar" aria-hidden="true">
          <span style={{ inlineSize: `${share}%` }} />
        </span>
        <span>
          <strong>
            {overall.answered} of {overall.of}
          </strong>{' '}
          answered{overall.flagged ? ` · ${overall.flagged} flagged` : ''}
        </span>
      </div>
      {met.length > 0 && (
        <ul className="cluster case-chips" aria-label="Areas that meet their criteria">
          {met.map((d) => (
            <li key={d.domain}>
              <CaseChip severity="today" label={`${d.label}: criteria met`} detail={`${d.flagged} flagged of ${d.answered} answered.`} />
            </li>
          ))}
        </ul>
      )}

      <details className="disclosure">
        <summary>
          Each area and the instruments
          <span className="disclosure-peek peek-when-closed">{screening.loneliness.summary}</span>
        </summary>
        <div className="stack disclosure-body">
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
                      {d.criterion === 0 ? <span className="meta">No criterion of its own</span> : <span className={tone(d.meets)}>{verdict(d.meets)}</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Items 1–20 together</th>
                  <td>
                    {overall.answered} of {overall.of}
                  </td>
                  <td>{overall.flagged}</td>
                  <td>
                    <span className={tone(overall.meets)}>{verdict(overall.meets)}</span>
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
              {screening.shareMood ? 'Family updates about mood and loneliness are approved.' : 'Family updates about mood and loneliness are not approved.'}
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
