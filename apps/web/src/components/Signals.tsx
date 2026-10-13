import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import '../styles/signals.css';
import {
  buildIndicators,
  compactIndicators,
  INDICATORS,
  reachLevel,
  SEVERITIES,
  SEVERITY,
  type IndicatorKey,
  type ReachInput,
  type Severity,
} from '../signals';
import type { ResidentSignals } from '../types';

const ICON_PATHS: Record<IndicatorKey, ReactNode> = {
  body: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 8v7M7.5 11h9M12 15l-3.5 6M12 15l3.5 6" />
    </>
  ),
  food: <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.2 0-3.5 3-3.5 7.5H17" />,
  sleep: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  mood: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  social: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2A5 5 0 0 1 21 19" />
    </>
  ),
  activity: <path d="M7 16c-1.5 0-2.5-1.8-2.5-4.5S5.5 6 7 6s2.5 2.2 2.5 5-1 5-2.5 5zM5 19.5h4M17 12c1.5 0 2.5-1.8 2.5-4.5S18.5 2 17 2s-2.5 2.2-2.5 5 1 5 2.5 5zM15 15.5h4" />,
  speech: <path d="M4 5h16v11H9.5L5 20v-4H4z" />,
  calls: <path d="M5 3.5h3.5l2 5L8 10a11 11 0 0 0 6 6l1.5-2.5 5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2z" />,
  checked: <path d="M6 3h9l4 4v14H6zM9 13.5l2 2 4-4.5" />,
};

function Icon({ name }: { name: IndicatorKey }) {
  return (
    <svg className="sev-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * A severity mark with a word. `label` replaces the severity's own word, which screen readers still
 * hear first; `detail` is the tooltip and is read after the label.
 */
export function SeverityChip({ severity, label, detail }: { severity: Severity; label?: string; detail?: string }) {
  const s = SEVERITY[severity];
  return (
    <span className={`sev-chip sev-${severity}`} title={detail || undefined}>
      <span className="sev-mark" aria-hidden="true">{s.symbol}</span>
      {label && label !== s.label && <span className="sr-only">{s.label}: </span>}
      <span>{label ?? s.label}</span>
      {detail && <span className="sr-only"> {detail}</span>}
    </span>
  );
}

/** "Reached today" to "No call for 3 days", or blue when the failure was ours. */
export function LastReachedChip({ reach, now }: { reach: ReachInput | undefined; now: Date }) {
  const l = reachLevel(reach, now);
  return <SeverityChip severity={l.severity} label={l.word} detail={l.detail} />;
}

interface BarItem {
  key: string;
  severity: Severity;
  icon?: IndicatorKey;
  text?: string;
  /** Bold first line of the tooltip and the start of what screen readers hear. */
  title: string;
  detail: string;
}

function barItems(signals: ResidentSignals | undefined, now: Date, compact: boolean, shareMood: boolean): BarItem[] {
  const all = buildIndicators(signals, now, { shareMood });
  const item = (i: (typeof all)[number]): BarItem => ({ key: i.key, severity: i.severity, icon: i.key, title: `${i.label}: ${i.word}`, detail: i.detail });
  if (!compact) return all.map(item);
  const { attention, summary } = compactIndicators(all);
  const rest: BarItem[] = summary ? [{ key: 'summary', severity: 'none', text: summary.text, title: summary.text, detail: summary.detail }] : [];
  return [...attention.map(item), ...rest];
}

const STEP: Record<string, (i: number, last: number) => number> = {
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowLeft: (i) => Math.max(i - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * The nine indicators in their fixed order, one tab stop per bar (arrow keys move within it). Each
 * shows its tooltip on hover, focus or tap. `compact` keeps only the indicators worth a look and
 * sums up the rest as "6 fine · 1 no data".
 */
export function IndicatorBar({
  signals,
  now,
  compact = false,
  shareMood = true,
  label = 'At a glance',
}: {
  signals: ResidentSignals | undefined;
  now: Date;
  compact?: boolean;
  shareMood?: boolean;
  label?: string;
}) {
  const items = barItems(signals, now, compact, shareMood);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [hushed, setHushed] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const current = Math.min(active, items.length - 1);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Escape') {
      setOpen(null);
      setHushed(true);
      return;
    }
    const step = Object.hasOwn(STEP, e.key) ? STEP[e.key] : undefined;
    if (!step) return;
    e.preventDefault();
    buttons.current[step(i, items.length - 1)]?.focus();
  };

  return (
    <ul className={`sev-bar${hushed ? ' is-hushed' : ''}`} aria-label={label} onMouseLeave={() => setHushed(false)}>
      {items.map((it, i) => (
        <li key={it.key} className={`sev-item${open === i ? ' is-open' : ''}`}>
          <button
            type="button"
            ref={(el) => {
              buttons.current[i] = el;
            }}
            className={`sev-ind sev-${it.severity}${it.text ? ' sev-summary' : ''}`}
            tabIndex={i === current ? 0 : -1}
            aria-describedby={it.detail ? `${id}-${i}` : undefined}
            onFocus={() => {
              setActive(i);
              setOpen(i);
            }}
            onBlur={() => setOpen((o) => (o === i ? null : o))}
            onClick={() => {
              setOpen(i);
              setHushed(false);
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {it.icon && <Icon name={it.icon} />}
            <span aria-hidden="true">{it.text ?? SEVERITY[it.severity].symbol}</span>
            <span className="sr-only">{it.title}</span>
          </button>
          <span className="sev-tip">
            <strong aria-hidden="true">{it.title}</strong>
            {it.detail && <span id={`${id}-${i}`}> {it.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The colour key and what each of the nine indicators is about, for once per page. */
export function SignalsLegend() {
  return (
    <div className="sev-legend">
      <ul className="sev-legend-colours" aria-label="Colour key">
        {SEVERITIES.map((s) => (
          <li key={s}>
            <SeverityChip severity={s} />
          </li>
        ))}
      </ul>
      <ul className="sev-legend-indicators" aria-label="Indicators">
        {INDICATORS.map((d) => (
          <li key={d.key}>
            <span className="sev-ind sev-none" aria-hidden="true">
              <Icon name={d.key} />
            </span>
            <span>
              <strong>{d.label}</strong> <span className="sev-legend-what">{d.what}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
