import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { speechLevel } from '../signals';
import {
  exclusionLabel,
  formatDay,
  plotChart,
  shortValue,
  SPEECH_FEATURES,
  speechCharts,
  speechOverall,
  speechProgress,
  type FeatureChart,
  type SpeechProgress,
} from '../speech';
import type { SpeechBaseline, SpeechPoint } from '../types';
import { CaseChip } from './CaseChip';

const FALLBACK_WIDTH = 560;
const TIP_WIDTH = 224;

/** The drawing's own width, so the chart is drawn at 1:1 and its text is never scaled down. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setWidth(Math.round(w));
    };
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => measure(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const STEP: Record<string, (i: number, last: number) => number> = {
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowLeft: (i) => Math.max(i - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

function Chart({ chart, name }: { chart: FeatureChart; name: string }) {
  const [box, measured] = useWidth();
  const width = Math.max(measured, 240);
  const plot = plotChart(chart, width, width < 420 ? 200 : 236);
  const last = plot.points.length - 1;
  const [active, setActive] = useState(last);
  const [open, setOpen] = useState<number | null>(null);
  const hits = useRef<(HTMLButtonElement | null)[]>([]);
  const captionId = useId();
  const current = Math.min(active, last);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Escape') {
      setOpen(null);
      return;
    }
    const step = Object.hasOwn(STEP, e.key) ? STEP[e.key] : undefined;
    if (!step) return;
    e.preventDefault();
    hits.current[step(i, last)]?.focus();
  };

  const tip = open === null ? null : plot.points[open];
  const bandLabelInside = plot.band && plot.band.height >= 22;
  const changed = chart.status === 'clear_change' || chart.status === 'slight_change';
  const outside = changed ? speechLevel(chart.status).severity : 'monitor';

  return (
    <figure className={`speech-figure sev-${outside}`} aria-labelledby={captionId}>
      <figcaption id={captionId}>
        <strong>{chart.title}</strong> <span>{chart.headline}</span>
      </figcaption>
      <p className="speech-unit">
        <span>{chart.unit.charAt(0).toUpperCase() + chart.unit.slice(1)}</span>
        <span aria-hidden="true"> · </span>
        <span>{chart.meaning}</span>
      </p>
      <div className="speech-plot" ref={box} onMouseLeave={() => setOpen((o) => (hits.current[o ?? -1] === document.activeElement ? o : null))}>
        <svg className="speech-svg" width={plot.width} height={plot.height} viewBox={`0 0 ${plot.width} ${plot.height}`} aria-hidden="true" focusable="false">
          {plot.yTicks.map((t) => (
            <g key={t.label}>
              <line className="speech-grid" x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
              <text className="speech-tick" x={plot.left - 8} y={t.y} dy="0.35em" textAnchor="end">
                {t.label}
              </text>
            </g>
          ))}
          {plot.band && (
            <>
              <rect className="speech-usual" x={plot.left} y={plot.band.y} width={plot.right - plot.left} height={Math.max(plot.band.height, 2)} />
              <line className="speech-usual-mean" x1={plot.left} x2={plot.right} y1={plot.band.mean} y2={plot.band.mean} />
              <text className="speech-usual-label" x={plot.left + 8} y={bandLabelInside ? plot.band.y + 16 : Math.max(plot.band.y - 6, 12)}>
                Usual for {name}
              </text>
            </>
          )}
          {plot.line && <polyline className="speech-trace" points={plot.line} />}
          {plot.points.map((p, i) => {
            const big = open === i;
            if (!p.counted) return <circle key={p.callId} className="speech-dot-skip" cx={p.x} cy={p.y} r={big ? 7 : 5} />;
            if (p.side) {
              const s = big ? 8 : 6;
              return <rect key={p.callId} className="speech-dot-out" x={p.x - s} y={p.y - s} width={s * 2} height={s * 2} transform={`rotate(45 ${p.x} ${p.y})`} />;
            }
            return <circle key={p.callId} className="speech-dot" cx={p.x} cy={p.y} r={big ? 7.5 : 5.5} />;
          })}
          {plot.xTicks.map((t) => (
            <text key={t.x} className="speech-tick" x={t.x} y={plot.height - 8} textAnchor={t.anchor}>
              {t.label}
            </text>
          ))}
        </svg>
        <div className="speech-hits" role="group" aria-label={`${chart.title}, one button per call. Use the arrow keys to move between calls.`}>
          {plot.points.map((p, i) => (
            <button
              key={p.callId}
              type="button"
              ref={(el) => {
                hits.current[i] = el;
              }}
              className="speech-hit"
              style={{ left: p.hitX, width: p.hitWidth, top: plot.top, height: plot.bottom - plot.top }}
              tabIndex={i === current ? 0 : -1}
              aria-label={p.label}
              onFocus={() => {
                setActive(i);
                setOpen(i);
              }}
              onBlur={() => setOpen((o) => (o === i ? null : o))}
              onMouseEnter={() => setOpen(i)}
              onClick={() => setOpen(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
            />
          ))}
        </div>
        {tip && (
          <div
            className={`speech-tip${tip.side ? ' is-outside' : ''}`}
            aria-hidden="true"
            style={{
              left: Math.min(Math.max(tip.x - TIP_WIDTH / 2, 0), Math.max(plot.width - TIP_WIDTH, 0)),
              top: tip.y - plot.top > 84 ? tip.y - 78 : tip.y + 16,
              width: Math.min(TIP_WIDTH, plot.width),
            }}
          >
            <strong>
              {formatDay(tip.at)} · {tip.shown}
            </strong>
            <span>
              {tip.note ? tip.note.charAt(0).toUpperCase() + tip.note.slice(1) : 'No usual range to compare with'}
              {tip.side && chart.rangeText ? ` (usual ${chart.rangeText})` : ''}
            </span>
          </div>
        )}
      </div>
      <ul className="speech-key" aria-label="Key">
        <li><span className="speech-key-band" aria-hidden="true" />Usual for {name}</li>
        <li><span className="speech-key-dot" aria-hidden="true" />Within usual</li>
        <li><span className="speech-key-out" aria-hidden="true" />Outside usual</li>
        {chart.points.some((p) => !p.counted) && <li><span className="speech-key-skip" aria-hidden="true" />Not counted</li>}
      </ul>
      <p className="meta">{chart.summary}</p>
    </figure>
  );
}

function Progress({ progress, name }: { progress: SpeechProgress; name: string }) {
  const { collected, needed, stalled } = progress;
  const level = speechLevel('no_baseline');
  return (
    <div className="speech-progress">
      <CaseChip severity={level.severity} label={`Usual range: ${collected} of ${needed} calls collected`} />
      <ol className="speech-progress-cells" aria-hidden="true">
        {Array.from({ length: needed }, (_, i) => (
          <li key={i} className={i < collected ? 'is-done' : undefined} />
        ))}
      </ol>
      <p className="meta">
        {stalled
          ? `The usual range is set from calls in ${name}'s first 4 weeks, and too few of those could be used. Until there is one, nothing is compared and no chart is drawn.`
          : `Hachi learns how ${name} usually speaks from the first ${needed} usable calls. Until then there is nothing to compare with, so no chart is drawn. ${needed - collected} more to go.`}
      </p>
    </div>
  );
}

function Numbers({ trend }: { trend: SpeechPoint[] }) {
  return (
    <details className="disclosure">
      <summary>Numbers for each call</summary>
      <div className="table-scroll disclosure-body" role="region" aria-label="Speech numbers for each call" tabIndex={0}>
        <table className="speech-table">
          <thead>
            <tr>
              <th scope="col">Call</th>
              {SPEECH_FEATURES.map((f) => (
                <th key={f.key} scope="col">
                  {f.title} <span className="meta">{f.unit}</span>
                </th>
              ))}
              <th scope="col">Counted</th>
            </tr>
          </thead>
          <tbody>
            {[...trend].reverse().map((p) => (
              <tr key={p.callId}>
                <th scope="row">{formatDay(p.at)}</th>
                {SPEECH_FEATURES.map((f) => {
                  const v = p.features[f.key];
                  return <td key={f.key}>{v === null || v === undefined ? '—' : shortValue(f.key, v)}</td>;
                })}
                <td>{p.usable === false ? `No: ${exclusionLabel(p.exclusionReasons)}` : 'Yes'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * R3: each speech measure against the resident's own usual range, staff only. A chip per measure
 * says where the latest call stands; the chart opens on the first that moved. With no usual range
 * yet it shows how far along the range is instead of a chart, so a few early calls never look alarming.
 */
export function SpeechTrendCard({ trend, baseline, name = 'them' }: { trend: SpeechPoint[]; baseline: SpeechBaseline | null | undefined; name?: string }) {
  const charts = speechCharts(trend, baseline).filter((c) => c.points.length > 0);
  const progress = speechProgress(trend, baseline);
  const overall = speechLevel(speechOverall(charts));
  const moved = charts.filter((c) => c.outsideNow);
  const [pick, setPick] = useState<string | null>(moved[0]?.key ?? null);
  const chosen = charts.find((c) => c.key === pick) ?? null;
  const headingId = useId();
  const chartId = useId();

  return (
    <section className="card stack case-speech" aria-labelledby={headingId}>
      <div className="cluster case-card-head">
        <h2 id={headingId}>Speech over time</h2>
        <CaseChip severity={overall.severity} label={overall.word} detail={overall.detail} />
      </div>
      {!progress && (
        <p>
          {moved.length
            ? `Changed in the latest call: ${moved.map((c) => c.title).join(', ')}.`
            : baseline
              ? 'The latest call is within the usual range for every measure.'
              : 'No usual range yet.'}
          {baseline && (
            <span className="meta">
              {' '}
              Usual range from {baseline.callCount} calls, {formatDay(baseline.from)} to {formatDay(baseline.to)}.
            </span>
          )}
        </p>
      )}
      {progress ? (
        <Progress progress={progress} name={name} />
      ) : (
        <>
          <ul className="speech-picks" aria-label="Measures. Choose one to see it over time.">
            {charts.map((c) => {
              const l = speechLevel(c.status);
              return (
                <li key={c.key}>
                  <button type="button" className="speech-pick" aria-pressed={pick === c.key} aria-controls={chartId} onClick={() => setPick(pick === c.key ? null : c.key)}>
                    <CaseChip severity={l.severity} label={`${c.title}: ${l.word.toLowerCase()}`} detail={c.headline} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div id={chartId}>{chosen ? <Chart key={chosen.key} chart={chosen} name={name} /> : <p className="meta">Choose a measure to see it call by call.</p>}</div>
        </>
      )}
      <Numbers trend={trend} />
    </section>
  );
}
