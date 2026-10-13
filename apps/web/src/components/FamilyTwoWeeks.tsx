import { cellState, dayLabel, dayOfMonth, LEGEND, LIFE_DOMAINS, STATES, type CellState, type FamilyDay } from '../glance';
import { FamilyCell, FamilyLegend } from './FamilyGlance';

type Area = (typeof LIFE_DOMAINS)[number];

function range(days: readonly FamilyDay[]): string {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return '';
  return first === last ? dayLabel(first.date) : `${dayLabel(first.date)} – ${dayLabel(last.date)}`;
}

/** A day without a call that got through is one tall cell down every area, not six identical ones. */
function DayTable({ days, areas, todayNote }: { days: readonly FamilyDay[]; areas: readonly Area[]; todayNote: string }) {
  const at = (d: FamilyDay) => (d.isToday ? `Today, ${dayLabel(d.date)}` : dayLabel(d.date));
  const cls = (d: FamilyDay, end: boolean) => [d.isToday && 'is-today', d.isToday && end && 'is-end'].filter(Boolean).join(' ') || undefined;
  return (
    <table className="family-grid">
      <caption>{range(days)}</caption>
      <colgroup>
        <col className="family-grid-label" />
        {days.map((d) => <col key={d.date} />)}
      </colgroup>
      <thead>
        <tr>
          <td />
          {days.map((d) => (
            <th scope="col" key={d.date} className={cls(d, false)}>
              {d.isToday && <span className="family-today-tab">Today</span>}
              <span aria-hidden="true">{dayOfMonth(d.date)}</span>
              <span className="sr-only">{d.isToday ? `, ${dayLabel(d.date)}` : dayLabel(d.date)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {areas.map((a, row) => (
          <tr key={a.key}>
            <th scope="row">{a.label}</th>
            {days.map((d) => {
              if (d.kind !== 'reached') {
                if (row > 0) return null;
                const note = d.isToday && d.kind === 'notyet' && todayNote ? ` ${todayNote}` : '';
                return (
                  <td key={d.date} rowSpan={areas.length} className={['family-gap', cls(d, true)].filter(Boolean).join(' ')}>
                    <FamilyCell state={d.kind} label={`${at(d)}: ${STATES[d.kind].word}.${note}`} tall />
                  </td>
                );
              }
              const state = cellState(d, a.key);
              return (
                <td key={d.date} className={cls(d, row === areas.length - 1)}>
                  <FamilyCell state={state} label={`${a.label}, ${at(d)}: ${STATES[state].word}`} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Rows are areas of life, columns are days, today outlined at the end. Narrow cards get the two
 * weeks as two rows of seven; only one of the two layouts is ever displayed.
 */
export function FamilyTwoWeeks({ days, shareMood, name, todayNote }: { days: readonly FamilyDay[]; shareMood: boolean; name: string; todayNote: string }) {
  const areas = LIFE_DOMAINS.filter((d) => d.key !== 'mood' || shareMood);
  const weeks = [days.slice(0, -7), days.slice(-7)].filter((w) => w.length > 0);
  const seen = new Set<CellState>(days.flatMap((d) => areas.map((a) => cellState(d, a.key))));
  const legend = LEGEND.filter((s) => ['good', 'mixed', 'concern', 'unmentioned'].includes(s) || seen.has(s));
  const today = days.at(-1);
  return (
    <section className="card family-weeks" aria-labelledby="family-weeks-heading">
      <h2 id="family-weeks-heading">The last two weeks at a glance</h2>
      <div className="family-grid-wide">
        <DayTable days={days} areas={areas} todayNote={todayNote} />
      </div>
      <div className="family-grid-split">
        {weeks.map((w) => <DayTable key={w[0]!.date} days={w} areas={areas} todayNote={todayNote} />)}
      </div>
      {today?.isToday && today.kind === 'notyet' && todayNote && <p className="family-today-note">{todayNote}</p>}
      <FamilyLegend states={legend} />
      <p className="meta">
        &quot;Not talked about&quot; does not mean all is well.{!shareMood && ` Mood is shared only if ${name} agrees, so it is not shown.`}
      </p>
    </section>
  );
}
