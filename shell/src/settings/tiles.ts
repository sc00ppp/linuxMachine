export type SettingsTileId = 'storage' | 'phone' | 'controllers' | 'network' | 'system';

export interface SettingsTileDef {
  /** Also the id passed to useFocusable and (for screen-opening tiles) the SettingsScreen value. */
  id: SettingsTileId;
  title: string;
  glyph: string;
  /** One line, shown only while the tile is focused. */
  blurb: string;
}

/**
 * Controllers doesn't open a room screen — it summons the global
 * Controllers overlay (DESIGN.md §12), same as the X button does from
 * anywhere. Everything else opens a screen inside this room (SettingsRoom.tsx
 * narrows on this id rather than a separate `external` flag, which lets
 * TypeScript prove the remaining branch's id is a valid SettingsScreen).
 */
export const EXTERNAL_TILE_ID: SettingsTileId = 'controllers';

/** The row (DESIGN.md §10, Round 3.5): Storage, Phone, Controllers, Network, System. */
export const SETTINGS_TILES: SettingsTileDef[] = [
  { id: 'storage', title: 'Storage', glyph: '💾', blurb: 'Drives & space' },
  { id: 'phone', title: 'Phone', glyph: '📱', blurb: 'Pairing & remote' },
  { id: 'controllers', title: 'Controllers', glyph: '🎮', blurb: 'Pads & mapping' },
  { id: 'network', title: 'Network', glyph: '📶', blurb: 'Wi-Fi & connection' },
  { id: 'system', title: 'System', glyph: '🛠', blurb: 'About this console' },
];
