/**
 * Geometry and default profiles for the remapping room.
 *
 * Every diagram uses the same 620 × 360 coordinate space. Keeping controls in
 * data lets the visible SVG buttons and the invisible spatial-focus targets
 * share exact centres instead of slowly drifting apart as the art evolves.
 */

export const PAD_VIEWBOX = {
  width: 620,
  height: 360,
} as const;

export type PadArt =
  | 'xbox'
  | 'snes'
  | 'nes'
  | 'genesis'
  | 'n64'
  | 'ps1'
  | 'gb'
  | 'generic';

export type PadButtonShape =
  | 'face'
  | 'pill'
  | 'dpad'
  | 'shoulder'
  | 'stick';

export interface PadButton {
  id: string;
  label: string;
  spokenLabel: string;
  x: number;
  y: number;
  shape: PadButtonShape;
  width?: number;
  height?: number;
}

export interface PadLayout {
  id: PadArt;
  name: string;
  shortName: string;
  art: PadArt;
  buttons: readonly PadButton[];
}

export type PhysicalButtonId =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'lb'
  | 'rb'
  | 'lt'
  | 'rt'
  | 'view'
  | 'menu'
  | 'ls'
  | 'rs'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'guide'
  | 'share';

export type ButtonMapping = Record<string, PhysicalButtonId>;
export type MappingProfiles = Record<string, ButtonMapping>;

const dpad = (
  id: 'up' | 'down' | 'left' | 'right',
  label: string,
  x: number,
  y: number,
): PadButton => ({
  id,
  label,
  spokenLabel: `D-pad ${id}`,
  x,
  y,
  shape: 'dpad',
  width: id === 'left' || id === 'right' ? 42 : 32,
  height: id === 'left' || id === 'right' ? 32 : 42,
});

const face = (
  id: string,
  label: string,
  spokenLabel: string,
  x: number,
  y: number,
  size = 38,
): PadButton => ({
  id,
  label,
  spokenLabel,
  x,
  y,
  shape: 'face',
  width: size,
  height: size,
});

const pill = (
  id: string,
  label: string,
  spokenLabel: string,
  x: number,
  y: number,
  width = 54,
  height = 24,
): PadButton => ({
  id,
  label,
  spokenLabel,
  x,
  y,
  shape: 'pill',
  width,
  height,
});

const shoulder = (
  id: string,
  label: string,
  spokenLabel: string,
  x: number,
  y: number,
  width = 72,
): PadButton => ({
  id,
  label,
  spokenLabel,
  x,
  y,
  shape: 'shoulder',
  width,
  height: 27,
});

const stick = (
  id: string,
  label: string,
  spokenLabel: string,
  x: number,
  y: number,
): PadButton => ({
  id,
  label,
  spokenLabel,
  x,
  y,
  shape: 'stick',
  width: 54,
  height: 54,
});

/** Compact d-pad direction target for the Series disc (fits inside r=30). */
const discDpad = (
  id: 'up' | 'down' | 'left' | 'right',
  label: string,
  x: number,
  y: number,
): PadButton => ({
  id,
  label,
  spokenLabel: `D-pad ${id}`,
  x,
  y,
  shape: 'dpad',
  width: id === 'left' || id === 'right' ? 26 : 22,
  height: id === 'left' || id === 'right' ? 22 : 26,
});

// Positions measured off a front-on Xbox SERIES controller photo (Gold
// Shadow edition), mapped into the 620×360 canvas. The real ABXY cluster is
// tiny and tight; the d-pad is a disc; Share sits below the guide.
const xboxButtons: readonly PadButton[] = [
  shoulder('lt', 'LT', 'left trigger', 195, 42, 52),
  shoulder('lb', 'LB', 'left bumper', 195, 70, 78),
  shoulder('rb', 'RB', 'right bumper', 425, 70, 78),
  shoulder('rt', 'RT', 'right trigger', 425, 42, 52),
  stick('ls', 'L', 'left stick press', 207, 129),
  discDpad('up', '↑', 254, 170),
  discDpad('left', '←', 239, 185),
  discDpad('right', '→', 269, 185),
  discDpad('down', '↓', 254, 200),
  pill('view', '❐', 'View', 278, 127, 22, 22),
  // The nexus button — deliberately unlabeled; a letter here reads as a
  // fifth face button.
  face('guide', '', 'Xbox button', 310, 102, 32),
  pill('menu', '≡', 'Menu', 338, 127, 22, 22),
  face('share', '', 'Share button', 310, 144, 20),
  stick('rs', 'R', 'right stick press', 362, 174),
  face('y', 'Y', 'Y button', 405, 105, 27),
  face('x', 'X', 'X button', 381, 129, 27),
  face('b', 'B', 'B button', 429, 129, 27),
  face('a', 'A', 'A button', 405, 153, 27),
];

export const XBOX_LAYOUT: PadLayout = {
  id: 'xbox',
  name: 'Xbox Wireless Controller',
  shortName: 'Xbox',
  art: 'xbox',
  buttons: xboxButtons,
};

const snesButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 184, 96, 84),
  shoulder('r', 'R', 'R shoulder', 436, 96, 84),
  dpad('up', '↑', 166, 161),
  dpad('left', '←', 137, 190),
  dpad('right', '→', 195, 190),
  dpad('down', '↓', 166, 219),
  pill('select', 'SELECT', 'Select', 270, 229, 66, 23),
  pill('start', 'START', 'Start', 350, 229, 66, 23),
  face('x', 'X', 'X button', 472, 145),
  face('y', 'Y', 'Y button', 436, 181),
  face('a', 'A', 'A button', 508, 181),
  face('b', 'B', 'B button', 472, 217),
];

const nesButtons: readonly PadButton[] = [
  dpad('up', '↑', 160, 158),
  dpad('left', '←', 131, 187),
  dpad('right', '→', 189, 187),
  dpad('down', '↓', 160, 216),
  // Select/Start and B/A share one lower row on the real NES-004 face.
  pill('select', 'SELECT', 'Select', 278, 210, 72, 24),
  pill('start', 'START', 'Start', 356, 210, 72, 24),
  face('b', 'B', 'B button', 455, 210, 44),
  face('a', 'A', 'A button', 515, 210, 44),
];

const genesisButtons: readonly PadButton[] = [
  dpad('up', '↑', 161, 154),
  dpad('left', '←', 132, 183),
  dpad('right', '→', 190, 183),
  dpad('down', '↓', 161, 212),
  pill('start', 'START', 'Start', 310, 140, 72, 24),
  face('a', 'A', 'A button', 418, 207, 42),
  face('b', 'B', 'B button', 466, 184, 42),
  face('c', 'C', 'C button', 514, 161, 42),
];

const n64Buttons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 180, 82, 84),
  shoulder('r', 'R', 'R shoulder', 440, 82, 84),
  dpad('up', '↑', 176, 152),
  dpad('left', '←', 147, 180),
  dpad('right', '→', 205, 180),
  dpad('down', '↓', 176, 208),
  pill('start', 'START', 'Start', 310, 150, 60, 24),
  // B sits up-left of the big A, both left of the C cluster (per hardware).
  face('b', 'B', 'B button', 384, 182, 38),
  face('a', 'A', 'A button', 420, 214, 44),
  face('c-up', '▲', 'C up', 466, 132, 32),
  face('c-left', '◀', 'C left', 434, 162, 32),
  face('c-right', '▶', 'C right', 498, 162, 32),
  face('c-down', '▼', 'C down', 466, 192, 32),
  // The Z trigger lives on the back of the centre prong.
  shoulder('z', 'Z', 'Z trigger', 310, 308, 52),
];

// Original SCPH-1080 pad: no analog sticks — that's the DualShock, later.
const ps1Buttons: readonly PadButton[] = [
  shoulder('l2', 'L2', 'L2 shoulder', 168, 64, 72),
  shoulder('r2', 'R2', 'R2 shoulder', 452, 64, 72),
  shoulder('l1', 'L1', 'L1 shoulder', 196, 92, 80),
  shoulder('r1', 'R1', 'R1 shoulder', 424, 92, 80),
  dpad('up', '↑', 158, 160),
  dpad('left', '←', 129, 189),
  dpad('right', '→', 187, 189),
  dpad('down', '↓', 158, 218),
  pill('select', 'SELECT', 'Select', 276, 190, 60, 20),
  pill('start', 'START', 'Start', 344, 190, 60, 20),
  face('triangle', '△', 'Triangle', 462, 152),
  face('square', '□', 'Square', 426, 188),
  face('circle', '○', 'Circle', 498, 188),
  face('cross', '×', 'Cross', 462, 224),
];

const gbButtons: readonly PadButton[] = [
  dpad('up', '↑', 260, 202),
  dpad('left', '←', 231, 231),
  dpad('right', '→', 289, 231),
  dpad('down', '↓', 260, 260),
  face('b', 'B', 'B button', 354, 239, 42),
  face('a', 'A', 'A button', 398, 218, 42),
  pill('select', 'SELECT', 'Select', 290, 294, 62, 20),
  pill('start', 'START', 'Start', 356, 294, 62, 20),
];

const genericButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'left shoulder', 174, 92, 82),
  shoulder('r', 'R', 'right shoulder', 446, 92, 82),
  dpad('up', '↑', 165, 161),
  dpad('left', '←', 136, 190),
  dpad('right', '→', 194, 190),
  dpad('down', '↓', 165, 219),
  pill('select', 'SELECT', 'Select', 274, 224, 66, 22),
  pill('start', 'START', 'Start', 346, 224, 66, 22),
  face('x', 'X', 'X button', 472, 145),
  face('y', 'Y', 'Y button', 436, 181),
  face('a', 'A', 'A button', 508, 181),
  face('b', 'B', 'B button', 472, 217),
];

export const PAD_LAYOUTS: Readonly<Record<string, PadLayout>> = {
  snes: {
    id: 'snes',
    name: 'Super Nintendo Controller',
    shortName: 'SNES',
    art: 'snes',
    buttons: snesButtons,
  },
  nes: {
    id: 'nes',
    name: 'Nintendo Entertainment System Controller',
    shortName: 'NES',
    art: 'nes',
    buttons: nesButtons,
  },
  genesis: {
    id: 'genesis',
    name: 'Sega Genesis Control Pad',
    shortName: 'Genesis',
    art: 'genesis',
    buttons: genesisButtons,
  },
  n64: {
    id: 'n64',
    name: 'Nintendo 64 Controller',
    shortName: 'N64',
    art: 'n64',
    buttons: n64Buttons,
  },
  ps1: {
    id: 'ps1',
    name: 'PlayStation DualShock',
    shortName: 'PS1',
    art: 'ps1',
    buttons: ps1Buttons,
  },
  gb: {
    id: 'gb',
    name: 'Game Boy',
    shortName: 'Game Boy',
    art: 'gb',
    buttons: gbButtons,
  },
};

export const GENERIC_LAYOUT: PadLayout = {
  id: 'generic',
  name: 'Classic Controller',
  shortName: 'Generic',
  art: 'generic',
  buttons: genericButtons,
};

export const REMAP_PLATFORM_IDS = [
  'snes',
  'nes',
  'genesis',
  'n64',
  'ps1',
  'gb',
] as const;

export const DEFAULT_MAPPINGS: Readonly<Record<string, ButtonMapping>> = {
  snes: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    select: 'view',
    start: 'menu',
    y: 'x',
    b: 'a',
    a: 'b',
    x: 'y',
    l: 'lb',
    r: 'rb',
  },
  nes: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    select: 'view',
    start: 'menu',
    b: 'x',
    a: 'a',
  },
  genesis: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    start: 'menu',
    a: 'x',
    b: 'a',
    c: 'b',
  },
  n64: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    start: 'menu',
    b: 'x',
    a: 'a',
    'c-up': 'y',
    'c-left': 'lb',
    'c-right': 'rb',
    'c-down': 'b',
    l: 'lb',
    r: 'rb',
    z: 'lt',
  },
  ps1: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    select: 'view',
    start: 'menu',
    triangle: 'y',
    square: 'x',
    circle: 'b',
    cross: 'a',
    l1: 'lb',
    r1: 'rb',
    l2: 'lt',
    r2: 'rt',
  },
  gb: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    select: 'view',
    start: 'menu',
    b: 'x',
    a: 'a',
  },
  generic: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    select: 'view',
    start: 'menu',
    x: 'x',
    y: 'y',
    a: 'a',
    b: 'b',
    l: 'lb',
    r: 'rb',
  },
};

export function padLayoutFor(platformId: string): PadLayout {
  return PAD_LAYOUTS[platformId] ?? GENERIC_LAYOUT;
}

export function defaultMappingFor(platformId: string): ButtonMapping {
  const source = DEFAULT_MAPPINGS[platformId] ?? DEFAULT_MAPPINGS.generic;
  return { ...source };
}

export function createDefaultProfiles(): MappingProfiles {
  return Object.fromEntries(
    Object.entries(DEFAULT_MAPPINGS).map(([id, mapping]) => [
      id,
      { ...mapping },
    ]),
  );
}

export function physicalButtonById(
  id: PhysicalButtonId | undefined,
): PadButton | undefined {
  return XBOX_LAYOUT.buttons.find((button) => button.id === id);
}

const STANDARD_GAMEPAD_BUTTONS: readonly PhysicalButtonId[] = [
  'a',
  'b',
  'x',
  'y',
  'lb',
  'rb',
  'lt',
  'rt',
  'view',
  'menu',
  'ls',
  'rs',
  'up',
  'down',
  'left',
  'right',
  'guide',
  // Series controllers expose Share as index 17 in Chromium.
  'share',
];

export function physicalButtonFromGamepadIndex(
  index: number,
): PhysicalButtonId | undefined {
  return STANDARD_GAMEPAD_BUTTONS[index];
}

const KEYBOARD_TO_XBOX: Readonly<Record<string, PhysicalButtonId>> = {
  Enter: 'a',
  Backspace: 'b',
  KeyX: 'x',
  KeyY: 'y',
  KeyC: 'y',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyQ: 'lb',
  KeyE: 'rb',
  Tab: 'view',
};

export function physicalButtonFromKeyboard(
  code: string,
): PhysicalButtonId | undefined {
  return KEYBOARD_TO_XBOX[code];
}
