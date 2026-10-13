import { useId, useState } from 'react';
import { callStatusLabel, minutes, topicList } from '../format';
import { LIFE_DOMAINS, STATES, staffTagLine } from '../glance';
import { domainLevel, SEVERITY, type Severity } from '../signals';
import type { CaseDetail, DomainState } from '../types';
import { CaseChip } from './CaseChip';

type Call = CaseDetail['calls'][number];

/** A week of calls is enough to compare with; the rest are a click away. */
const SHOWN = 7;

const CALL_SEVERITY: Record<string, Severity> = { completed: 'good', no_answer: 'soon', failed: 'system' };

const TZ = 'Asia/Tokyo';
const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export function callDay(iso: string, now: Date): string {
  const at = new Date(iso);
  const day = localDay(at);
  if (day === localDay(now)) return 'Today';
  if (day === localDay(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(at);
}

const callTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** Tags first: the same words call after call, so rows can be compared down the list. */
function oneLine(c: Call): string {
  const tags = c.wellbeing?.tags ?? [];
  if (tags.length) return [...tags.filter((t) => t.polarity === 'concern'), ...tags.filter((t) => t.polarity !== 'concern')].map((t) => t.label).join(' · ');
  if (c.wellbeing?.headline) return c.wellbeing.headline;
  if (c.summary) return c.summary.meals || c.summary.health;
  return c.status === 'completed' ? 'No notes for this call.' : '';
}

/** The six life areas for one call, in the order the indicator bar uses. */
export function CaseDomainDots({ domains }: { domains: Record<string, DomainState> | undefined }) {
  const marks = LIFE_DOMAINS.map((d) => {
    const state = domains && Object.hasOwn(domains, d.key) ? domains[d.key] : undefined;
    return { ...d, level: domainLevel(state) };
  });
  return (
    <span className="case-dots" role="img" aria-label={marks.map((m) => `${m.label}: ${m.level.word}`).join(', ')}>
      {marks.map((m) => (
        <span key={m.key} className={`case-dot sev-${m.level.severity}`} title={`${m.label}: ${m.level.word}`} aria-hidden="true">
          {SEVERITY[m.level.severity].symbol === '–' ? '' : SEVERITY[m.level.severity].symbol}
        </span>
      ))}
    </span>
  );
}

function CallRow({ call, now, quoted }: { call: Call; now: Date; quoted: boolean }) {
  const severity = CALL_SEVERITY[call.status] ?? 'none';
  const line = oneLine(call);
  const tags = call.wellbeing?.tags ?? [];
  return (
    <details className="case-call">
      <summary>
        <span className="case-call-when">
          <strong>{callDay(call.startedAt, now)}</strong> <span className="meta">{callTime(call.startedAt)}</span>
        </span>
        <CaseChip severity={severity} label={callStatusLabel(call.status)} />
        {call.wellbeing ? <CaseDomainDots domains={call.wellbeing.domains} /> : <span className="case-dots" aria-hidden="true" />}
        <span className="case-call-line">
          {quoted && <span className="case-call-flag">Quoted · </span>}
          {call.trigger === 'staff' && <span className="case-call-flag">Staff call · </span>}
          {line}
        </span>
        <span className="case-call-length meta">{minutes(call.durationSec)}</span>
      </summary>
      <div className="case-call-body">
        {call.trigger === 'staff' && <p className="meta">Called at staff request{call.requestedBy ? ` by ${call.requestedBy}` : ''}.</p>}
        {call.wellbeing?.headline && tags.length > 0 && <p>{call.wellbeing.headline}</p>}
        {tags.length > 0 && (
          <ul className="tag-list" aria-label="What came up, with the turn each came from">
            {tags.map((t) => (
              <li key={t.id} className={`tag ${t.polarity} ${t.basis}`} title={t.quote ? `${staffTagLine(t)}: “${t.quote}”` : staffTagLine(t)}>
                {t.label}
                {t.basis === 'inferred' && <span className="sr-only"> (inferred)</span>}
              </li>
            ))}
          </ul>
        )}
        {call.summary && (
          <dl className="case-call-notes">
            <div><dt>Health</dt><dd>{call.summary.health}</dd></div>
            <div><dt>Meals</dt><dd>{call.summary.meals}</dd></div>
            {call.summary.topics.length > 0 && <div><dt>Topics</dt><dd>{topicList(call.summary.topics)}</dd></div>}
          </dl>
        )}
        {!call.summary && !tags.length && <p className="meta">{call.status === 'completed' ? 'No notes for this call.' : `${callStatusLabel(call.status)}: nothing was said.`}</p>}
        {quoted && <p className="meta"><a href="#said-heading">The quoted words and the whole conversation are under What was said.</a></p>}
      </div>
    </details>
  );
}

/** One line per call, newest first: when, whether it got through, the six areas and what came up. */
export function CaseCalls({ calls, now, quotedCallIds }: { calls: Call[]; now: Date; quotedCallIds: ReadonlySet<string> }) {
  const headingId = useId();
  const [all, setAll] = useState(false);
  const sorted = [...calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const shown = all ? sorted : sorted.slice(0, SHOWN);
  const talked = calls.filter((c) => c.status === 'completed').length;

  return (
    <section className="card stack case-calls" aria-labelledby={headingId}>
      <div className="cluster case-card-head">
        <h2 id={headingId}>Calls</h2>
        <span className="meta">
          Talked in {talked} of {calls.length}
        </span>
      </div>
      {calls.length === 0 ? (
        <p className="meta">No calls yet.</p>
      ) : (
        <>
          <p className="case-dots-key meta" aria-hidden="true">
            Squares, left to right: {LIFE_DOMAINS.map((d) => d.label).join(', ')}. {STATES.concern.symbol} worth a call, {STATES.mixed.symbol} some concern, {STATES.good.symbol} good, hollow not talked about.
          </p>
          <ol className="case-call-list">
            {shown.map((c) => (
              <li key={c.id}>
                <CallRow call={c} now={now} quoted={quotedCallIds.has(c.id)} />
              </li>
            ))}
          </ol>
          {sorted.length > SHOWN && (
            <p>
              <button type="button" className="subtle" aria-expanded={all} onClick={() => setAll(!all)}>
                {all ? `Show the latest ${SHOWN} only` : `Show all ${sorted.length} calls`}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
