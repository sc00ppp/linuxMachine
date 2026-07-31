import { channelById } from '../core/channels';

export interface StorageCategory {
  id: string;
  label: string;
  gb: number;
  /** Hex accent driving the segment + legend dot. */
  color: string;
}

export interface StorageDrive {
  id: string;
  label: string;
  kind: 'SSD' | 'HDD';
  totalGb: number;
  freeGb: number;
  /** Used-space breakdown; `categories[].gb` sums to `totalGb - freeGb`. */
  categories: StorageCategory[];
}

// Categories that map onto an existing channel reuse that channel's exact
// accent (DESIGN.md §11 "category colors from channel accents") — Games and
// Movies & TV are colored identically here and on the channel wall. Fall
// back to the known hex only if core/channels.ts is ever missing an entry;
// this keeps the module resilient rather than throwing at import time.
const GAMES_COLOR = channelById('games')?.accent ?? '#f0655a';
const MOVIES_COLOR = channelById('movies')?.accent ?? '#e89a3c';

// Categories with no channel counterpart get their own swatch, defined here
// as the single source of truth for storage data — same footing as
// core/channels.ts is for the channel row.
const SYSTEM_COLOR = '#6f93a8';
const MUSIC_COLOR = '#8f7fe0';
const OTHER_COLOR = '#8a8394';

/**
 * Fake-but-plausible storage snapshot (CONTRACTS.md Round 3.5). The shape
 * mirrors what the daemon can eventually report over the `state` channel —
 * a future worker swaps this constant for a live subscription without
 * touching StorageScreen.tsx, which only reads `StorageDrive[]`.
 */
export const STORAGE_DRIVES: StorageDrive[] = [
  {
    id: 'c',
    label: 'Local Disk (C:)',
    kind: 'SSD',
    totalGb: 223,
    freeGb: 165,
    categories: [{ id: 'system', label: 'System', gb: 58, color: SYSTEM_COLOR }],
  },
  {
    id: 'd',
    label: 'Games Drive (D:)',
    kind: 'HDD',
    totalGb: 1800,
    freeGb: 612,
    categories: [
      { id: 'games', label: 'Games', gb: 512, color: GAMES_COLOR },
      { id: 'movies', label: 'Movies & TV', gb: 401, color: MOVIES_COLOR },
      { id: 'music', label: 'Music', gb: 143, color: MUSIC_COLOR },
      { id: 'other', label: 'Other', gb: 132, color: OTHER_COLOR },
    ],
  },
];

export const STORAGE_SCAN_NOTE = 'Estimated from the last scan · 4 minutes ago';

/** `223` → "223 GB", `1800` → "1.8 TB". Drops the decimal when it's a whole number. */
export function formatGb(gb: number): string {
  if (gb >= 1000) {
    const tb = gb / 1000;
    return `${tb % 1 === 0 ? tb.toFixed(0) : tb.toFixed(1)} TB`;
  }
  return `${Math.round(gb)} GB`;
}
