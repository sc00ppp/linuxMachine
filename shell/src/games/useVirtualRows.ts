/**
 * Row virtualization for the library shelf.
 *
 * A big console's library is not a big list, it is an enormous one: NES alone
 * renders 1,477 boxes — 20,504 DOM nodes and 1,303 `<img>` elements in a grid
 * 68,757px tall. Chromium will build that, but every focus hop then costs a
 * style recalc over the whole tree, and the room visibly stutters. Nothing in
 * the motion work helps, because the frames are being spent before any
 * animation starts.
 *
 * So only the rows near the viewport are mounted, and the rest of the shelf's
 * height is held open by padding on the grid. Padding rather than absolute
 * positioning because the grid stays a real CSS grid: columns keep aligning,
 * the gap keeps working, and the rendered slice is always row-aligned so
 * items land in the column they belong to.
 *
 * This is only possible because every cell is the same size. It is the
 * concrete reason the shelf went back to a uniform per-console cell instead
 * of letting each cover keep its own width: with ragged rows there is no
 * `rowHeight`, so there is no way to know which rows are on screen without
 * measuring all of them — which is the very work being avoided.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Rows kept mounted beyond the viewport, above and below.
 *
 * Not a scroll-smoothness tuning knob — it is what keeps the focus engine
 * working. Focus moves a row at a time and can only target a registered
 * element, so the row you are about to move onto has to already exist. Four
 * rows is roughly a screen of slack in each direction, which covers a d-pad
 * held down at the 120ms repeat rate.
 */
const OVERSCAN_ROWS = 4;

export interface VirtualRows {
  /** First item index to render (inclusive), always on a row boundary. */
  startIndex: number;
  /** Last item index to render (exclusive). */
  endIndex: number;
  /** Height to hold open above the rendered slice, in px. */
  padTop: number;
  /** Height to hold open below it, in px. */
  padBottom: number;
  /** Attach to the scrolling pane. */
  scrollerRef: (el: HTMLDivElement | null) => void;
}

export interface VirtualRowsOptions {
  itemCount: number;
  columns: number;
  /** One row's full pitch: cell height plus the row gap, in px. */
  rowHeight: number;
  /**
   * Item that must be mounted on the first paint — the game you backed out
   * of. Without this the shelf would mount its first rows, fail to find the
   * remembered box, and drop focus to the top of the library.
   */
  anchorIndex?: number;
  /** Changing this resets the shelf to the top (a new console, a new sort). */
  resetKey?: string;
}

export function useVirtualRows({
  itemCount,
  columns,
  rowHeight,
  anchorIndex = 0,
  resetKey = '',
}: VirtualRowsOptions): VirtualRows {
  /**
   * The scrolling pane, held in STATE rather than a ref.
   *
   * A ref would be the obvious choice and it silently does not work here.
   * `GamesRoom` mounts on the console picker, where no shelf exists, so an
   * effect keyed on anything else runs once against a null ref, returns
   * early, and — its dependencies never changing — never runs again. The pane
   * appears a level later and nothing is listening to it. State makes the
   * element itself a dependency, so the listener attaches the moment the
   * shelf exists.
   */
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const safeColumns = Math.max(1, columns);
  const safeRowHeight = Math.max(1, rowHeight);
  const totalRows = Math.ceil(itemCount / safeColumns);

  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    setScroller(el);
  }, []);

  useEffect(() => {
    if (!scroller) return;

    const sync = () => {
      setScrollTop(scroller.scrollTop);
      setViewportHeight(scroller.clientHeight);
    };

    // Passive: this only reads scrollTop, and blocking the scroll thread is
    // exactly the problem being solved.
    const onScroll = () => setScrollTop(scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(sync);
      observer.observe(scroller);
    }

    sync();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [scroller]);

  // A new console or a new sort order invalidates the scroll position — and
  // then jumps to whichever row the remembered game sits on, so backing out
  // of a detail page lands you where you were rather than at the top.
  useLayoutEffect(() => {
    if (!scroller) return;
    const anchorRow = Math.floor(Math.max(anchorIndex, 0) / safeColumns);
    const top = anchorRow * safeRowHeight;
    scroller.scrollTop = top;
    setScrollTop(top);
    // anchorIndex is deliberately not a dependency: it is where we came in,
    // not something to chase as focus moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, resetKey, safeColumns, safeRowHeight]);

  // Before the first measurement, render a screenful rather than nothing —
  // otherwise the shelf paints empty for a frame and the autofocus has no
  // element to land on.
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : safeRowHeight * 4;

  const firstVisibleRow = Math.floor(scrollTop / safeRowHeight);
  const visibleRowCount = Math.ceil(effectiveViewport / safeRowHeight) + 1;

  const startRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRowCount + OVERSCAN_ROWS);

  const startIndex = startRow * safeColumns;
  const endIndex = Math.min(itemCount, endRow * safeColumns);

  return {
    startIndex,
    endIndex,
    padTop: startRow * safeRowHeight,
    padBottom: Math.max(0, (totalRows - endRow) * safeRowHeight),
    scrollerRef,
  };
}
