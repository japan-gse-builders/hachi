import { SEVERITY, type Severity } from '../signals';

/**
 * Looks like `SeverityChip`, for a word that is not itself a level of worry (a status, a fact, a
 * delivery), so screen readers hear the word alone rather than "Monitor: In progress".
 */
export function CaseChip({ severity, label, detail }: { severity: Severity; label: string; detail?: string }) {
  return (
    <span className={`sev-chip sev-${severity}`} title={detail || undefined}>
      <span className="sev-mark" aria-hidden="true">
        {SEVERITY[severity].symbol}
      </span>
      <span>{label}</span>
      {detail && <span className="sr-only"> {detail}</span>}
    </span>
  );
}
