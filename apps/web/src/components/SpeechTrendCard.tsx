import { useId } from 'react';
import { speechLine } from '../format';
import { CHART, exclusionLabel, formatDay, layout, speechCharts, type FeatureChart } from '../speech';
import type { SpeechBaseline, SpeechPoint } from '../types';

function Chart({ chart }: { chart: FeatureChart }) {
  const id = useId();
  const { band, points, line } = layout(chart);
  const first = chart.points[0]!;
  const last = chart.points.at(-1)!;
  return (
    <figure className="speech-chart">
      <figcaption>
        <strong>{chart.title}</strong>
        {chart.outsideNow && <span className="badge action">Outside usual range</span>}
      </figcaption>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={`${chart.title} over recent calls`} aria-describedby={id}>
        {band && (
          <>
            <rect className="speech-band" x={0} y={band.y} width={CHART.width} height={band.height} />
            <line className="speech-mean" x1={0} x2={CHART.width} y1={band.mean} y2={band.mean} />
          </>
        )}
        {line && <polyline className="speech-line" points={line} />}
        {points.map((p) =>
          !p.counted ? (
            <circle key={p.callId} className="speech-excluded" cx={p.x} cy={p.y} r={3.5}><title>{p.label}</title></circle>
          ) : p.side ? (
            <rect key={p.callId} className="speech-outside" x={p.x - 4} y={p.y - 4} width={8} height={8}><title>{p.label}</title></rect>
          ) : (
            <circle key={p.callId} className="speech-point" cx={p.x} cy={p.y} r={3.5}><title>{p.label}</title></circle>
          ),
        )}
      </svg>
      <p className="speech-axis meta" aria-hidden="true">
        <span>{formatDay(first.at)}</span>
        <span>{formatDay(last.at)}</span>
      </p>
      <p id={id} className="meta">{chart.summary}</p>
    </figure>
  );
}

/** R3: each speech feature over recent calls against the resident's own usual range. Staff only. */
export function SpeechTrendCard({ trend, baseline }: { trend: SpeechPoint[]; baseline: SpeechBaseline | null | undefined }) {
  const charts = speechCharts(trend, baseline);
  const moved = charts.filter((c) => c.outsideNow).map((c) => c.title);
  return (
    <section className="card stack">
      <h2>Speech over time</h2>
      <p>
        {moved.length ? `Outside the usual range in the latest call: ${moved.join(', ')}.` : baseline ? 'The latest call is within the usual range for every measure.' : 'No usual range yet.'}
        {baseline && <span className="meta"> Usual range from {baseline.callCount} calls, {formatDay(baseline.from)} to {formatDay(baseline.to)}.</span>}
      </p>
      <p className="meta speech-legend">Shaded band: usual range · dashed line: usual average · ● counted call · ■ outside the usual range · ○ not counted (for example a cold)</p>
      <div className="speech-charts">
        {charts.filter((c) => c.points.length > 0).map((c) => <Chart key={c.key} chart={c} />)}
      </div>
      <details>
        <summary>Numbers for each call</summary>
        {trend.map((point) => (
          <p key={point.callId} className="meta">
            {formatDay(point.at)} · {speechLine(point.features)}
            {point.usable === false ? ` · not counted: ${exclusionLabel(point.exclusionReasons)}` : ''}
          </p>
        ))}
      </details>
    </section>
  );
}
