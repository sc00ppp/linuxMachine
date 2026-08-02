import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { Dir } from '../core/types';

type FocusableEntry = {
  id: string;
  scope: string;
  element: HTMLElement;
  onAccept?: () => void;
  autoFocus: boolean;
  order: number;
};

type SelectionOrigin = 'memory' | 'auto' | 'fallback' | 'explicit';

const registry = new Map<string, Map<string, FocusableEntry>>();
const scopeMemory = new Map<string, string>();
const subscribers = new Set<() => void>();

let activeScope = 'none';
let focusedEntry: FocusableEntry | null = null;
let selectionOrigin: SelectionOrigin | null = null;
let registrationOrder = 0;
let reconcileVersion = 0;

function entriesFor(scope: string): FocusableEntry[] {
  return [...(registry.get(scope)?.values() ?? [])].sort(
    (a, b) => a.order - b.order,
  );
}

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function setFocusedAttribute(entry: FocusableEntry, focused: boolean) {
  if (focused) {
    entry.element.setAttribute('data-focused', 'true');
  } else {
    // CSS uses the presence selector, so data-focused="false" would still
    // appear focused.
    entry.element.removeAttribute('data-focused');
  }
}

function selectEntry(entry: FocusableEntry, origin: SelectionOrigin) {
  if (activeScope === 'none' || entry.scope !== activeScope) return;

  if (focusedEntry === entry) {
    selectionOrigin = origin;
    if (origin !== 'fallback') scopeMemory.set(activeScope, entry.id);
    return;
  }

  if (focusedEntry) setFocusedAttribute(focusedEntry, false);
  focusedEntry = entry;
  selectionOrigin = origin;
  // A fallback chosen while callback refs are still mounting is provisional:
  // a later autoFocus registration must be allowed to supersede it.
  if (origin !== 'fallback') scopeMemory.set(activeScope, entry.id);
  setFocusedAttribute(entry, true);
  notify();
}

function defaultEntry(scope: string): FocusableEntry | null {
  const entries = entriesFor(scope);
  return entries.find((entry) => entry.autoFocus) ?? entries[0] ?? null;
}

function restoreOrChoose(scope: string) {
  const entries = registry.get(scope);
  const rememberedId = scopeMemory.get(scope);
  const remembered = rememberedId ? entries?.get(rememberedId) : undefined;

  if (remembered) {
    selectEntry(remembered, 'memory');
    return;
  }

  const fallback = defaultEntry(scope);
  if (fallback) selectEntry(fallback, fallback.autoFocus ? 'auto' : 'fallback');
}

function scheduleReconcile(scope: string) {
  const version = ++reconcileVersion;

  // Callback refs for one React commit register in sequence. Deferring the
  // fallback by a microtask gives a remembered element the full commit in
  // which to remount before another control takes its place.
  queueMicrotask(() => {
    if (
      version !== reconcileVersion ||
      activeScope !== scope ||
      focusedEntry
    ) {
      return;
    }
    restoreOrChoose(scope);
  });
}

function register(entry: FocusableEntry): () => void {
  let scopeEntries = registry.get(entry.scope);
  if (!scopeEntries) {
    scopeEntries = new Map();
    registry.set(entry.scope, scopeEntries);
  }

  const replaced = scopeEntries.get(entry.id);
  if (replaced && replaced !== entry) {
    setFocusedAttribute(replaced, false);
    if (focusedEntry === replaced) focusedEntry = null;
  }
  scopeEntries.set(entry.id, entry);

  if (entry.scope === activeScope) {
    const rememberedId = scopeMemory.get(entry.scope);

    if (rememberedId === entry.id) {
      selectEntry(entry, 'memory');
    } else if (!rememberedId && entry.autoFocus) {
      // autoFocus may register after a provisional first element.
      if (!focusedEntry || selectionOrigin === 'fallback') {
        selectEntry(entry, 'auto');
      }
    } else if (!focusedEntry && !rememberedId) {
      selectEntry(entry, 'fallback');
    } else if (!focusedEntry) {
      scheduleReconcile(entry.scope);
    }
  }

  return () => {
    const currentScopeEntries = registry.get(entry.scope);
    if (currentScopeEntries?.get(entry.id) !== entry) return;

    currentScopeEntries.delete(entry.id);
    if (currentScopeEntries.size === 0) registry.delete(entry.scope);
    setFocusedAttribute(entry, false);

    if (focusedEntry === entry) {
      // React normally unmounts the old scope before App's effect switches
      // scopes, so record even a provisional default at this boundary.
      scopeMemory.set(entry.scope, entry.id);
      focusedEntry = null;
      selectionOrigin = null;
      notify();
      if (activeScope === entry.scope) scheduleReconcile(entry.scope);
    }
  };
}

function updateEntry(
  entry: FocusableEntry,
  updates: Pick<FocusableEntry, 'onAccept' | 'autoFocus'>,
) {
  entry.onAccept = updates.onAccept;
  const becameAutoFocus = !entry.autoFocus && updates.autoFocus;
  entry.autoFocus = updates.autoFocus;

  if (
    becameAutoFocus &&
    entry.scope === activeScope &&
    (!focusedEntry || selectionOrigin === 'fallback') &&
    !scopeMemory.has(entry.scope)
  ) {
    selectEntry(entry, 'auto');
  }
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function isFocused(scope: string, id: string): boolean {
  return (
    activeScope === scope &&
    focusedEntry?.scope === scope &&
    focusedEntry.id === id
  );
}

type RectMetrics = {
  centerX: number;
  centerY: number;
  rect: DOMRect;
};

function metrics(entry: FocusableEntry): RectMetrics {
  const rect = entry.element.getBoundingClientRect();
  return {
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    rect,
  };
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return Math.min(firstEnd, secondEnd) >= Math.max(firstStart, secondStart);
}

function directionalDelta(
  origin: RectMetrics,
  candidate: RectMetrics,
  dir: Dir,
): { primary: number; perpendicular: number } | null {
  const dx = candidate.centerX - origin.centerX;
  const dy = candidate.centerY - origin.centerY;

  switch (dir) {
    case 'up':
      return dy < 0 ? { primary: -dy, perpendicular: Math.abs(dx) } : null;
    case 'down':
      return dy > 0 ? { primary: dy, perpendicular: Math.abs(dx) } : null;
    case 'left':
      return dx < 0 ? { primary: -dx, perpendicular: Math.abs(dy) } : null;
    case 'right':
      return dx > 0 ? { primary: dx, perpendicular: Math.abs(dy) } : null;
  }
}

function isInBeam(
  origin: RectMetrics,
  candidate: RectMetrics,
  dir: Dir,
): boolean {
  if (dir === 'up' || dir === 'down') {
    return rangesOverlap(
      origin.rect.left,
      origin.rect.right,
      candidate.rect.left,
      candidate.rect.right,
    );
  }

  return rangesOverlap(
    origin.rect.top,
    origin.rect.bottom,
    candidate.rect.top,
    candidate.rect.bottom,
  );
}

function candidateInDirection(
  current: FocusableEntry,
  dir: Dir,
): FocusableEntry | null {
  const origin = metrics(current);
  const candidates = entriesFor(activeScope)
    .filter((entry) => entry !== current)
    .map((entry) => {
      const candidateMetrics = metrics(entry);
      const delta = directionalDelta(origin, candidateMetrics, dir);
      if (!delta) return null;

      return {
        entry,
        inBeam: isInBeam(origin, candidateMetrics, dir),
        primary: delta.primary,
        perpendicular: delta.perpendicular,
        distance: Math.hypot(
          candidateMetrics.centerX - origin.centerX,
          candidateMetrics.centerY - origin.centerY,
        ),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );

  if (candidates.length === 0) return null;

  const beamCandidates = candidates.filter((candidate) => candidate.inBeam);
  const pool = beamCandidates.length > 0 ? beamCandidates : candidates;

  pool.sort((a, b) => {
    if (beamCandidates.length > 0) {
      return (
        a.primary - b.primary ||
        a.perpendicular - b.perpendicular ||
        a.distance - b.distance ||
        a.entry.order - b.entry.order
      );
    }

    return (
      a.distance - b.distance ||
      a.primary - b.primary ||
      a.perpendicular - b.perpendicular ||
      a.entry.order - b.entry.order
    );
  });

  return pool[0]?.entry ?? null;
}

export function useFocusable(opts: {
  id: string;
  scope: string;
  onAccept?: () => void;
  autoFocus?: boolean;
}): { ref: (el: HTMLElement | null) => void; focused: boolean } {
  const registrationRef = useRef<{
    entry: FocusableEntry;
    unregister: () => void;
  } | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      registrationRef.current?.unregister();
      registrationRef.current = null;

      if (!element) return;

      const entry: FocusableEntry = {
        id: opts.id,
        scope: opts.scope,
        element,
        onAccept: opts.onAccept,
        autoFocus: opts.autoFocus ?? false,
        order: registrationOrder++,
      };
      registrationRef.current = { entry, unregister: register(entry) };
    },
    [opts.id, opts.scope],
  );

  useLayoutEffect(() => {
    const entry = registrationRef.current?.entry;
    if (!entry) return;
    updateEntry(entry, {
      onAccept: opts.onAccept,
      autoFocus: opts.autoFocus ?? false,
    });
  }, [opts.autoFocus, opts.onAccept]);

  const focused = useSyncExternalStore(
    subscribe,
    () => isFocused(opts.scope, opts.id),
    () => false,
  );

  return { ref, focused };
}

/** Direction of the most recent successful `move`, for arrival motion. */
let lastMoveDir: Dir | null = null;

export const focusManager = {
  setScope(scope: string): void {
    lastMoveDir = null;
    if (scope === activeScope) {
      if (!focusedEntry && scope !== 'none') restoreOrChoose(scope);
      return;
    }

    reconcileVersion++;
    if (focusedEntry) scopeMemory.set(activeScope, focusedEntry.id);
    if (focusedEntry) setFocusedAttribute(focusedEntry, false);
    focusedEntry = null;
    selectionOrigin = null;
    activeScope = scope;

    if (scope !== 'none') restoreOrChoose(scope);
    notify();
  },

  getScope(): string {
    return activeScope;
  },

  move(dir: Dir): boolean {
    if (activeScope === 'none') return false;

    if (!focusedEntry) {
      const initial = defaultEntry(activeScope);
      if (!initial) return false;
      lastMoveDir = null;
      selectEntry(initial, initial.autoFocus ? 'auto' : 'fallback');
      return true;
    }

    const candidate = candidateInDirection(focusedEntry, dir);
    if (!candidate) return false;
    lastMoveDir = dir;
    selectEntry(candidate, 'explicit');
    return true;
  },

  /**
   * Which way the cursor was travelling when it landed where it is.
   *
   * Components use this to lean into the movement — a tile that swings from
   * the side focus came from reads as something being pushed, rather than as
   * a highlight teleporting. Null when focus arrived some other way (a scope
   * restore, an explicit `focusId`), where there is no direction to lean.
   */
  lastDirection(): Dir | null {
    return lastMoveDir;
  },

  accept(): void {
    focusedEntry?.onAccept?.();
  },

  focusedId(): string | null {
    return focusedEntry?.id ?? null;
  },

  focusId(id: string): void {
    lastMoveDir = null;
    if (activeScope === 'none') return;
    const entry = registry.get(activeScope)?.get(id);
    if (entry) selectEntry(entry, 'explicit');
  },
};
