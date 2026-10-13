import '../styles/signals.css';
import '../styles/family.css';
import {
  isOneOff,
  latestAreas,
  latestCallLabel,
  STATES,
  trendChange,
  trendCount,
  trendTurn,
  type CellState,
  type FamilyLevel,
  type FamilyStatus,
} from '../glance';
import { SEVERITY, type Severity } from '../signals';
import type { FamilyGlance, TagLabel, TagTrend } from '../types';

/** A severity mark and a word in family language; screen readers hear only the word and the detail. */
export function FamilyChip({ severity, label, detail }: { severity: Severity; label: string; detail?: string }) {
  return (
    <span className={`sev-chip sev-${severity}`} title={detail || undefined}>
      <span className="sev-mark" aria-hidden="true">{SEVERITY[severity].symbol}</span>
      <span>{label}</span>
      {detail && <span className="sr-only"> {detail}</span>}
    </span>
  );
}

export function FamilyCell({ state, label, tall = false }: { state: CellState; label?: string; tall?: boolean }) {
  const s = STATES[state];
  return (
    <span className={`family-cell sev-${s.sev} tone-${s.tone}${tall ? ' is-tall' : ''}`} title={label ?? s.word}>
      <span aria-hidden="true">{s.symbol}</span>
      <span className="sr-only">{label ?? s.word}</span>
    </span>
  );
}

export function FamilyStatusCard({
  name,
  status,
  reach,
  next,
  careTeamPhone,
}: {
  name: string;
  status: FamilyStatus | null;
  reach: FamilyLevel | null;
  next: string;
  careTeamPhone: string;
}) {
  const severity = status?.severity ?? 'none';
  return (
    <section className={`card family-status sev-${severity}`} aria-labelledby="family-name">
      <h1 className="family-name" id="family-name">Daily calls with {name}</h1>
      <div className="family-status-grid">
        {status && (
          <div className="family-state">
            <span className="family-state-mark" aria-hidden="true">{SEVERITY[severity].symbol}</span>
            <div className="stack stack-s">
              <p className="family-state-title">{status.title}</p>
              {status.body && <p className="family-state-body">{status.body}</p>}
            </div>
          </div>
        )}
        <div className="family-status-side">
          <ul className="family-facts" aria-label="Calls">
            {reach && (
              <li>
                <FamilyChip severity={reach.severity} label={reach.word} detail={reach.detail} />
              </li>
            )}
            <li className="family-next">{next}</li>
          </ul>
          {status?.askCareTeam && (
            <a className="button family-ask" href={`tel:${careTeamPhone}`}>Call the care team</a>
          )}
        </div>
      </div>
    </section>
  );
}

/** The latest call's six areas of life, each a colour, a symbol and a word. */
export function LatestCall({ latest, now, shareMood, notesPending }: { latest: FamilyGlance['latest']; now: Date; shareMood: boolean; notesPending: boolean }) {
  return (
    <section className="card family-latest" aria-labelledby="family-latest-heading">
      <h2 id="family-latest-heading">{latest ? latestCallLabel(latest.startedAt, now) : 'Latest call'}</h2>
      {latest ? (
        <ul className="family-areas" aria-label="The latest call, by area of life">
          {latestAreas(latest, shareMood, notesPending).map((a) => {
            const s = STATES[a.state];
            return (
              <li key={a.key} className={`family-area sev-${s.sev} tone-${s.tone}`}>
                <span className={`family-cell sev-${s.sev} tone-${s.tone}`} aria-hidden="true">{s.symbol}</span>
                <span className="family-area-name">{a.label}</span>
                <span className="family-area-word">{s.word}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="meta">No call has connected in the last two weeks.</p>
      )}
    </section>
  );
}

export function FamilyLegend({ states }: { states: readonly CellState[] }) {
  return (
    <ul className="family-legend" aria-label="Key">
      {states.map((s) => (
        <li key={s}>
          <FamilyCell state={s} />
          <span aria-hidden="true">{STATES[s].word}</span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ t }: { t: TagTrend }) {
  const change = trendChange(t);
  const turn = trendTurn(t);
  const tone = t.polarity === 'positive' ? 'good' : 'concern';
  return (
    <li className={isOneOff(t) ? 'is-muted' : undefined}>
      <span className="family-trend-name">
        <FamilyCell state={tone} label={t.polarity === 'positive' ? 'Good sign' : 'Concern'} />
        {t.label}
      </span>
      <span className="family-trend-detail">
        <span className={`family-bars ${tone}`} aria-hidden="true">
          {Array.from({ length: t.lastCalls }, (_, i) => <span key={i} className={i < t.last ? 'on' : undefined} />)}
        </span>
        <span className="meta">
          {turn && (
            <span className={`family-turn sev-${turn === 'worse' ? 'today' : 'good'}`}>
              <span aria-hidden="true">{t.direction === 'more' ? '↑' : '↓'}</span>
              <span className="sr-only">{turn === 'worse' ? 'Worse: ' : 'Better: '}</span>
            </span>
          )}
          {trendCount(t)}
          {change && ` · ${change}`}
        </span>
      </span>
    </li>
  );
}

export function TagTrends({ trends }: { trends: TagTrend[] }) {
  return (
    <section className="card stack family-trends-card" aria-labelledby="family-trends-heading">
      <h2 id="family-trends-heading">What keeps coming up</h2>
      {trends.length === 0 ? (
        <p className="meta">Nothing yet. Topics appear here after a few calls.</p>
      ) : (
        <ul className="family-trends">
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
