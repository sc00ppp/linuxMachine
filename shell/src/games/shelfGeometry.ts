/**
 * How tall the boxes on one console's shelf should be.
 *
 * Boxes are sized by height so each cover can keep its own width (see the
 * "True-shape boxes" section of BoxArt.css). That leaves one number to pick —
 * the row height — and picking it badly is very visible: too tall and two
 * covers fill the screen, too short and the shelf reads as thumbnails.
 *
 * The obvious source is the per-console ratio table in core/consoles.ts, and
 * that was the first attempt. It doesn't hold up. The table is a median over
 * whatever the scrape happened to fetch, several systems are missing from it
 * entirely (PlayStation covers are wide box wraps at ~1.17; the fallback
 * table guessed a portrait 0.70, which made every box half again too tall),
 * and a console whose art is a mix of front covers and full wraps has no
 * single honest ratio anyway.
 *
 * So this measures instead. Covers report their real proportions as they
 * decode, and the shelf sizes itself from the median of what actually
 * arrived. The table is still the opening guess — it has to be, since nothing
 * has loaded on first paint — but it stops mattering within a few images.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Gaps in `.games-grid`, in rem. Kept in step with GamesRoom.css. */
const COLUMN_GAP_REM = 1.8;
const ROW_GAP_REM = 1.9;

/**
 * Enough samples to be a median rather than an accident, few enough that the
 * shelf settles on the first screenful instead of drifting as you scroll.
 */
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 24;

/**
 * Ignore a new median within this fraction of the current one. Every change
 * reflows the whole shelf, and a shelf that keeps twitching by 2% as images
 * decode looks broken in a way that a slightly-off height does not.
 */
const RESIZE_THRESHOLD = 0.08;

/** Box height bounds in rem: legible at ten feet, never taller than a shelf. */
const MIN_HEIGHT_REM = 11;
const MAX_HEIGHT_REM = 24;

/**
 * How many boxes to aim for across one row, by shape. Wide box wraps (Atari,
 * N64, PlayStation) need fewer or they become postage stamps in the vertical
 * direction; tall cases (DS, Switch, PSP) fit more.
 */
function columnsFor(aspect: number): number {
  if (aspect >= 1.9) return 4;
  if (aspect >= 1.25) return 5;
  if (aspect >= 0.85) return 5;
  return 6;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface ShelfGeometry {
  /** Inline value for `--box-h`, in px so it tracks the real grid width. */
  boxHeight: string;
  /**
   * One row's full pitch in px (cell height + row gap). The virtualizer needs
   * a number, not a CSS string — it is the only reason it can tell which rows
   * are on screen without measuring any of them.
   */
  rowHeight: number;
  /** Column count the shape implies — still drives `--box-cols`. */
  columns: number;
  /** Attach to the grid element so it can be measured. */
  gridRef: (el: HTMLDivElement | null) => void;
  /** Every BoxArt reports its cover's true proportions here once decoded. */
  onCoverMeasured: (aspect: number) => void;
}

/**
 * @param consoleId  Resets the measurement when you walk to another machine.
 * @param fallbackAspect  The table's guess, used until covers report in.
 */
export function useShelfGeometry(
  consoleId: string,
  fallbackAspect: number,
): ShelfGeometry {
  const [measured, setMeasured] = useState<number | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const samples = useRef<number[]>([]);
  const gridEl = useRef<HTMLDivElement | null>(null);

  // A different console is a different set of covers; carrying samples across
  // would size a Game Boy shelf from PlayStation wraps.
  useEffect(() => {
    samples.current = [];
    setMeasured(null);
  }, [consoleId]);

  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridEl.current = el;
    if (el) setGridWidth(el.getBoundingClientRect().width);
  }, []);

  // The grid is capped at a max-width but rarely reaches it — a 1280 window
  // and a 1920 TV give very different row widths, and the box height has to
  // follow, or the same shelf shows six across on one and two on the other.
  useLayoutEffect(() => {
    const el = gridEl.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setGridWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [consoleId]);

  const onCoverMeasured = useCallback((aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const collected = samples.current;
    if (collected.length >= MAX_SAMPLES) return;
    collected.push(aspect);
    if (collected.length < MIN_SAMPLES) return;

    const next = median(collected);
    setMeasured((current) => {
      if (current === null) return next;
      return Math.abs(next - current) / current > RESIZE_THRESHOLD ? next : current;
    });
  }, []);

  const aspect = measured ?? fallbackAspect;
  const columns = columnsFor(aspect);

  const rootFontSize =
    typeof window === 'undefined'
      ? 16
      : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const gapPx = COLUMN_GAP_REM * rootFontSize;

  // Work backwards from the width one column would have had, then convert it
  // to a height through the shelf's own aspect. Before the grid has been
  // measured, fall back to a plain rem height so the first paint is sane.
  const columnWidth =
    gridWidth > 0 ? (gridWidth - gapPx * (columns - 1)) / columns : 0;
  const heightPx = columnWidth > 0 ? columnWidth / Math.max(aspect, 0.2) : 0;
  const clamped = Math.min(
    Math.max(heightPx, MIN_HEIGHT_REM * rootFontSize),
    MAX_HEIGHT_REM * rootFontSize,
  );

  const cellHeight = heightPx > 0 ? Math.round(clamped) : (MAX_HEIGHT_REM - 3) * rootFontSize;

  return {
    boxHeight: `${cellHeight}px`,
    rowHeight: cellHeight + ROW_GAP_REM * rootFontSize,
    columns,
    gridRef,
    onCoverMeasured,
  };
}
