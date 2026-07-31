import type { Channel } from './types';

/** Dashed "coming soon" sockets rendered after the last channel in the row. */
export const TRAILING_SOCKETS = 3;

/** v1 channel row (DESIGN.md §10), ordered by `slot`. */
export const CHANNELS: Channel[] = [
  {
    id: 'continue',
    title: 'Continue',
    accent: '#e8b84b',
    glyph: '✦',
    slot: 0,
    emptyHint: 'Nothing yet — play something!',
  },
  { id: 'games', title: 'Games', accent: '#f0655a', glyph: '🎮', slot: 1, view: 'games' },
  { id: 'movies', title: 'Movies & TV', accent: '#e89a3c', glyph: '🎬', slot: 2, view: 'movies' },
  { id: 'youtube', title: 'YouTube', accent: '#e53935', glyph: '▶', slot: 3, view: 'youtube' },
  // Ambient channels (DESIGN.md §14) — the Wii Weather/News spirit.
  { id: 'weather', title: 'Weather', accent: '#5b9bd5', glyph: '⛅', slot: 4, view: 'weather' },
  { id: 'news', title: 'News', accent: '#c96a4a', glyph: '📰', slot: 5, view: 'news' },
  { id: 'situation', title: 'Situation', accent: '#7f6ac4', glyph: '🛰', slot: 6, view: 'situation' },
  { id: 'settings', title: 'Settings', accent: '#4e8e8b', glyph: '⚙', slot: 7, view: 'settings' },
];

export const channelById = (id: string): Channel | undefined =>
  CHANNELS.find((c) => c.id === id);
