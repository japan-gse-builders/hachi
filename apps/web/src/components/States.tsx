import '../styles/loading.css';

type Layout = 'queue' | 'tiles' | 'detail' | 'narrow';

const Block = ({ h, w }: { h: number; w?: string }) => <span className="skeleton-block" aria-hidden="true" style={{ height: h, width: w }} />;

function Tile() {
  return (
    <span className="skeleton-card">
      <Block h={24} w="30%" />
      <Block h={28} w="60%" />
      <Block h={18} />
      <Block h={18} w="80%" />
    </span>
  );
}

/**
 * Stands in for a page while it loads, in the page's own shape so nothing jumps when data arrives.
 * It appears only after a short delay, so a fast response never flashes it.
 */
export function Loading({ layout = 'narrow', label = 'Loading…' }: { layout?: Layout; label?: string }) {
  return (
    <div className={`skeleton skeleton-${layout}`} role="status">
      <span className="sr-only">{label}</span>
      <span className="skeleton-body" aria-hidden="true">
        {layout === 'queue' && (
          <span className="skeleton-row">
            {[0, 1, 2].map((i) => <span key={i} className="skeleton-card"><Block h={18} w="50%" /><Block h={40} w="25%" /></span>)}
          </span>
        )}
        {(layout === 'queue' || layout === 'tiles') && (
          <span className="skeleton-grid">{[0, 1, 2, 3, 4, 5].map((i) => <Tile key={i} />)}</span>
        )}
        {layout === 'detail' && (
          <>
            <span className="skeleton-card"><Block h={24} w="20%" /><Block h={40} w="45%" /><Block h={18} w="70%" /></span>
            <span className="skeleton-columns"><Tile /><Tile /></span>
          </>
        )}
        {layout === 'narrow' && <Tile />}
      </span>
    </div>
  );
}

/**
 * Holds the place of a box that loads after the page around it, in roughly its final size,
 * so nothing below it moves when it arrives. Only for boxes that nearly always appear.
 */
export function LoadingCard({ label, lines = 2, action = false }: { label: string; lines?: number; action?: boolean }) {
  return (
    <section className="card skeleton skeleton-slot" aria-busy="true" aria-label={label}>
      <Block h={28} w="55%" />
      {Array.from({ length: lines }, (_, i) => <Block key={i} h={20} w={i === lines - 1 ? '70%' : undefined} />)}
      {action && <Block h={48} w="min(100%, 12rem)" />}
    </section>
  );
}

/**
 * A load that failed says what happened and offers the way back, rather than leaving a dead page.
 * `compact` is one line for a box beside the main content, so a failure there does not shout over the page.
 */
export function LoadError({ message, onRetry, compact = false }: { message: string; onRetry?: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <p className="error load-error-compact" role="alert">
        <span>{message}</span>
        {onRetry && <button type="button" className="ghost" onClick={onRetry}>Try again</button>}
      </p>
    );
  }
  return (
    <div className="error stack" role="alert">
      <p><strong>This could not be loaded.</strong> {message}</p>
      {onRetry && <p><button type="button" className="ghost" onClick={onRetry}>Try again</button></p>}
    </div>
  );
}
