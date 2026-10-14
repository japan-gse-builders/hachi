import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

const SEVERITY_ICONS: Record<Severity, ReactNode> = {
  emergency: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3h.01" /></>,
  today: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  soon: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 11h16m-11 5h6" /></>,
  monitor: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  good: <path d="m5 12 4 4L19 6" />,
  system: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.8.3-.8 1.1-.8 2.1m0 3h.01" /></>,
  none: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
};

/** A simple line icon. The neighboring label supplies its accessible name. */
export function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span className={`sev-mark sev-${severity}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">{SEVERITY_ICONS[severity]}</svg>
    </span>
  );
}

/**
 * A severity mark with a word. `label` replaces the severity's own word; `detail` is the tooltip and
 * is read after the label. Screen readers hear `spoken` before the label, by default the severity's
 * own word when `label` replaces it. Pass `spoken={false}` when the label is a status, a fact or
 * already a level ("In progress", "Approval needed", "Urgent"), or a word of your own to say instead.
 */
export function SeverityChip({ severity, label, detail, spoken }: { severity: Severity; label?: string; detail?: string; spoken?: string | false }) {
  const s = SEVERITY[severity];
  const prefix = spoken === false ? '' : (spoken ?? (label && label !== s.label ? s.label : ''));
  return (
    <span className={`sev-chip sev-${severity}`} title={detail || undefined}>
      <SeverityMark severity={severity} />
      {prefix && <span className="sr-only">{prefix}: </span>}
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

const EDGE = 8;

/**
 * Starts a tooltip at its trigger, shifted back inside the card and the window when it would run
 * off the end, and no wider than the room there is. Call it once the tip is displayed.
 */
export function placeTip(item: HTMLElement) {
  const tip = item.querySelector<HTMLElement>('.sev-tip');
  if (!tip || !tip.offsetWidth) return;
  const at = item.getBoundingClientRect();
  const card = item.closest('.card')?.getBoundingClientRect();
  const left = Math.max(card?.left ?? 0, 0) + EDGE;
  const right = Math.min(card?.right ?? Infinity, document.documentElement.clientWidth) - EDGE;
  tip.style.setProperty('--tip-room', `${Math.max(right - left, 0)}px`);
  const width = tip.offsetWidth;
  const shift = Math.max(left - at.left, Math.min(0, right - width - at.left));
  tip.style.setProperty('--tip-shift', `${Math.round(shift)}px`);
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
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const item = open === null ? null : list.current?.children[open];
    if (item instanceof HTMLElement) placeTip(item);
  }, [open]);

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
    <ul ref={list} className={`sev-bar${hushed ? ' is-hushed' : ''}`} aria-label={label} onMouseLeave={() => setHushed(false)}>
      {items.map((it, i) => (
        <li key={it.key} className={`sev-item${open === i ? ' is-open' : ''}`} onMouseEnter={(e) => placeTip(e.currentTarget)}>
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

const INDICATOR_STATES: readonly { severity: Severity; label: string; detail: string }[] = [
  { severity: 'good', label: 'Good', detail: 'A positive sign, usual speech, or a completed check.' },
  { severity: 'system', label: 'Not checked', detail: 'A call failed on our side or its analysis is incomplete.' },
  { severity: 'none', label: 'No data', detail: 'Not discussed, not shared, or not enough data yet.' },
  { severity: 'today', label: 'Concern', detail: 'A concern was reported, or two daily calls were missed.' },
  { severity: 'soon', label: 'Some concern', detail: 'Mixed signs, a speech change, or one missed daily call.' },
  { severity: 'monitor', label: 'Slight change', detail: 'Speech differs slightly from their usual pattern.' },
  { severity: 'emergency', label: 'Not reached', detail: 'Three or more daily calls were missed.' },
];

/** The indicator key uses the bar's own colors and symbols, rather than case urgency icons. */
export function SignalsLegend({ showIndicators = true, levels }: { showIndicators?: boolean; levels?: readonly Severity[] } = {}) {
  // Keep the three basic states as a reference, plus any concern colors used by this page's bar.
  const states = INDICATOR_STATES.filter((s) => !levels || ['good', 'system', 'none'].includes(s.severity) || levels.includes(s.severity));
  return (
    <div className="sev-legend">
      {showIndicators ? <ul className="sev-legend-states" aria-label="Indicator color key">
        {states.map((s) => (
          <li key={s.severity}>
            <span className={`sev-ind sev-${s.severity} sev-legend-swatch`} aria-hidden="true">{SEVERITY[s.severity].symbol}</span>
            <span><strong>{s.label}</strong><span className="sev-legend-what">{s.detail}</span></span>
          </li>
        ))}
      </ul> : <ul className="sev-legend-colors" aria-label="Color key">
        {SEVERITIES.map((s) => (
          <li key={s}>
            <SeverityChip severity={s} />
          </li>
        ))}
      </ul>}
      {showIndicators && <ul className="sev-legend-indicators" aria-label="Indicators">
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
      </ul>}
    </div>
  );
}
