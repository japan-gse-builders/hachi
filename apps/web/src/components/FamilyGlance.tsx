import type { ReactNode } from 'react';
import {
  cellState,
  dayLabel,
  dayOfMonth,
  domainState,
  glanceHeadline,
  isOneOff,
  latestCallLabel,
  LEGEND,
  LIFE_DOMAINS,
  STATES,
  trendChange,
  trendCount,
  worthAsking,
  type CellState,
} from '../glance';
import type { FamilyGlance, TagLabel, TagTrend } from '../types';

function Cell({ state, title }: { state: CellState; title?: string }) {
  const s = STATES[state];
  return (
    <span className={`glance-cell state-${s.tone}`} title={title ?? s.word}>
      <span aria-hidden="true">{s.symbol}</span>
      <span className="sr-only">{s.word}</span>
    </span>
  );
}

/** Headline and the latest call's six life domains. */
export function LatestCall({ latest, now, shareMood = false }: { latest: FamilyGlance['latest']; now: Date; shareMood?: boolean }) {
  return (
    <div className="stack glance-latest">
      {latest && <p className="meta">{latestCallLabel(latest.startedAt, now)}</p>}
      <p className="glance-headline">{glanceHeadline(latest)}</p>
      {worthAsking(latest) && <p>Some things came up that may be worth asking about next time you talk.</p>}
      {latest && (
        <ul className="glance-today" aria-label="The latest call, by area of life">
          {LIFE_DOMAINS.filter((d) => d.key !== 'mood' || shareMood).map((d) => {
            const state = domainState(latest.domains, d.key);
            return (
              <li key={d.key}>
                <span className={`glance-cell state-${STATES[state].tone}`} aria-hidden="true">{STATES[state].symbol}</span>
                <span className="glance-domain">{d.label}</span>
                <span className="glance-word">{STATES[state].word}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <ul className="glance-legend" aria-label="Key">
      {LEGEND.map((s) => (
        <li key={s}>
          <span className={`glance-cell state-${STATES[s].tone}`} aria-hidden="true">{STATES[s].symbol}</span>
          {STATES[s].word}
        </li>
      ))}
    </ul>
  );
}

/** Rows are areas of life, columns are days; a dashed cell is a day without a call that connected. */
export function TwoWeekGrid({ days, shareMood = false, legend }: { days: FamilyGlance['days']; shareMood?: boolean; legend?: ReactNode }) {
  const first = days[0];
  const last = days.at(-1);
  return (
    <section className="card stack">
      <h2>The last two weeks at a glance</h2>
      {legend}
      <div className="table-scroll glance-scroll" role="region" aria-label="Two-week call history" tabIndex={0}>
        <table className="glance-grid">
          <caption className="meta">
            {first && last ? `One column per day, ${dayLabel(first.date)} to ${dayLabel(last.date)}.` : ''} "Not talked about" does not mean all is well.
          </caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Area</span></th>
              {days.map((d) => (
                <th scope="col" key={d.date}>
                  <span aria-hidden="true">{dayOfMonth(d.date)}</span>
                  <span className="sr-only">{dayLabel(d.date)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIFE_DOMAINS.filter((dom) => dom.key !== 'mood' || shareMood).map((dom) => (
              <tr key={dom.key}>
                <th scope="row">{dom.label}</th>
                {days.map((d) => {
                  const state = cellState(d, dom.key);
                  return (
                    <td key={d.date}>
                      <Cell state={state} title={`${dom.label}, ${dayLabel(d.date)}: ${STATES[state].word}`} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Trend({ t }: { t: TagTrend }) {
  const change = trendChange(t);
  const tone = t.polarity === 'positive' ? 'good' : 'concern';
  return (
    <li className={isOneOff(t) ? 'muted' : undefined}>
      <span className="glance-trend-name">
        <span className={`glance-cell state-${tone}`} aria-hidden="true">{STATES[tone].symbol}</span>
        {t.label}
        <span className="sr-only">{t.polarity === 'positive' ? ' (good sign)' : ' (concern)'}</span>
      </span>
      <span className="glance-trend-detail">
        <span className="glance-bars" aria-hidden="true">
          {Array.from({ length: t.lastCalls }, (_, i) => <span key={i} className={i < t.last ? `on ${tone}` : undefined} />)}
        </span>
        <span className="meta">
          {trendCount(t)}
          {change && ` · ${change}`}
        </span>
      </span>
    </li>
  );
}

export function TagTrends({ trends }: { trends: TagTrend[] }) {
  return (
    <section className="card stack">
      <h2>What keeps coming up</h2>
      {trends.length === 0 ? (
        <p className="meta">Nothing yet. Topics appear here after a few calls.</p>
      ) : (
        <ul className="glance-trends">
          {trends.map((t) => <Trend key={t.id} t={t} />)}
        </ul>
      )}
    </section>
  );
}

export function TagList({ tags, label }: { tags: TagLabel[]; label: string }) {
  if (!tags.length) return null;
  return (
    <ul className="tag-list" aria-label={label}>
      {tags.map((t) => (
        <li key={t.id} className={`tag ${t.polarity}`}>
          <span aria-hidden="true">{t.polarity === 'positive' ? '✓ ' : '! '}</span>
          {t.label}
        </li>
      ))}
    </ul>
  );
}
