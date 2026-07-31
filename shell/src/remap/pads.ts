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
  id: string,
  label: string,
  x: number,
  y: number,
  spokenLabel?: string,
): PadButton => {
  const direction = id.split('-').at(-1);
  const horizontal = direction === 'left' || direction === 'right';
  return {
    id,
    label,
    spokenLabel: spokenLabel ?? `D-pad ${direction}`,
    x,
    y,
    shape: 'dpad',
    width: horizontal ? 42 : 32,
    height: horizontal ? 32 : 42,
  };
};

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
  size = 54,
): PadButton => ({
  id,
  label,
  spokenLabel,
  x,
  y,
  shape: 'stick',
  width: size,
  height: size,
});

/** Telephone-style 3x4 keypad shared by the 5200, ColecoVision, and Jaguar. */
const keypad = (x: number, y: number): readonly PadButton[] => [
  pill('keypad-1', '1', 'keypad 1', x - 40, y, 32, 24),
  pill('keypad-2', '2', 'keypad 2', x, y, 32, 24),
  pill('keypad-3', '3', 'keypad 3', x + 40, y, 32, 24),
  pill('keypad-4', '4', 'keypad 4', x - 40, y + 30, 32, 24),
  pill('keypad-5', '5', 'keypad 5', x, y + 30, 32, 24),
  pill('keypad-6', '6', 'keypad 6', x + 40, y + 30, 32, 24),
  pill('keypad-7', '7', 'keypad 7', x - 40, y + 60, 32, 24),
  pill('keypad-8', '8', 'keypad 8', x, y + 60, 32, 24),
  pill('keypad-9', '9', 'keypad 9', x + 40, y + 60, 32, 24),
  pill('keypad-star', '*', 'keypad star', x - 40, y + 90, 32, 24),
  pill('keypad-0', '0', 'keypad 0', x, y + 90, 32, 24),
  pill('keypad-hash', '#', 'keypad hash', x + 40, y + 90, 32, 24),
];

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
  pill('mode', 'MODE', 'Mode', 272, 140, 58, 22),
  pill('start', 'START', 'Start', 344, 140, 68, 22),
  // The six-button pad is the useful superset: XYZ form the smaller upper row.
  face('x', 'X', 'X button', 418, 157, 32),
  face('y', 'Y', 'Y button', 466, 157, 32),
  face('z', 'Z', 'Z button', 514, 157, 32),
  face('a', 'A', 'A button', 418, 207, 42),
  face('b', 'B', 'B button', 466, 207, 42),
  face('c', 'C', 'C button', 514, 207, 42),
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
  stick('control-stick', 'STICK', 'control stick', 310, 236),
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

const gbaButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 220, 70, 68),
  shoulder('r', 'R', 'R shoulder', 400, 70, 68),
  dpad('up', '↑', 235, 201),
  dpad('left', '←', 206, 230),
  dpad('right', '→', 264, 230),
  dpad('down', '↓', 235, 259),
  face('b', 'B', 'B button', 354, 239, 40),
  face('a', 'A', 'A button', 400, 217, 40),
  pill('select', 'SELECT', 'Select', 286, 297, 58, 20),
  pill('start', 'START', 'Start', 350, 297, 58, 20),
];

const ndsButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 210, 58, 66),
  shoulder('r', 'R', 'R shoulder', 410, 58, 66),
  dpad('up', '↑', 220, 196),
  dpad('left', '←', 191, 225),
  dpad('right', '→', 249, 225),
  dpad('down', '↓', 220, 254),
  face('x', 'X', 'X button', 400, 187, 34),
  face('y', 'Y', 'Y button', 366, 221, 34),
  face('a', 'A', 'A button', 434, 221, 34),
  face('b', 'B', 'B button', 400, 255, 34),
  pill('select', 'SELECT', 'Select', 286, 299, 58, 20),
  pill('start', 'START', 'Start', 350, 299, 58, 20),
];

// New Nintendo 3DS is the superset: ZL/ZR and the C Stick remain harmless for
// games built for the original model, while New 3DS titles can use them.
const threeDsButtons: readonly PadButton[] = [
  shoulder('zl', 'ZL', 'ZL shoulder', 198, 42, 50),
  shoulder('zr', 'ZR', 'ZR shoulder', 422, 42, 50),
  shoulder('l', 'L', 'L shoulder', 216, 70, 70),
  shoulder('r', 'R', 'R shoulder', 404, 70, 70),
  stick('circle-pad', 'CIRCLE', 'Circle Pad', 235, 135),
  dpad('up', '↑', 220, 215),
  dpad('left', '←', 191, 244),
  dpad('right', '→', 249, 244),
  dpad('down', '↓', 220, 273),
  stick('c-stick', 'C', 'C Stick', 371, 151, 30),
  face('x', 'X', 'X button', 420, 188, 34),
  face('y', 'Y', 'Y button', 386, 222, 34),
  face('a', 'A', 'A button', 454, 222, 34),
  face('b', 'B', 'B button', 420, 256, 34),
  pill('select', 'SELECT', 'Select', 268, 308, 54, 20),
  face('home', '⌂', 'Home', 330, 307, 24),
  pill('start', 'START', 'Start', 394, 308, 54, 20),
];

const dreamcastButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'left analog trigger', 186, 72, 72),
  shoulder('r', 'R', 'right analog trigger', 434, 72, 72),
  stick('analog-stick', 'STICK', 'analog stick', 176, 144),
  dpad('up', '↑', 184, 206),
  dpad('left', '←', 155, 235),
  dpad('right', '→', 213, 235),
  dpad('down', '↓', 184, 264),
  pill('start', 'START', 'Start', 310, 151, 66, 22),
  face('y', 'Y', 'Y button', 456, 142),
  face('x', 'X', 'X button', 420, 178),
  face('b', 'B', 'B button', 492, 178),
  face('a', 'A', 'A button', 456, 214),
];

const gamecubeButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'left analog trigger', 176, 64, 78),
  shoulder('r', 'R', 'right analog trigger', 444, 64, 78),
  shoulder('z', 'Z', 'Z shoulder', 492, 94, 48),
  stick('control-stick', 'STICK', 'control stick', 170, 145),
  dpad('up', '↑', 214, 208),
  dpad('left', '←', 185, 237),
  dpad('right', '→', 243, 237),
  dpad('down', '↓', 214, 266),
  pill('start', 'START', 'Start/Pause', 310, 151, 60, 22),
  stick('c-stick', 'C', 'C Stick', 348, 244, 46),
  face('y', 'Y', 'Y button', 444, 137, 34),
  face('b', 'B', 'B button', 397, 216, 34),
  face('a', 'A', 'A button', 449, 194, 52),
  face('x', 'X', 'X button', 500, 177, 38),
];

const gameGearButtons: readonly PadButton[] = [
  dpad('up', '↑', 250, 202),
  dpad('left', '←', 221, 231),
  dpad('right', '→', 279, 231),
  dpad('down', '↓', 250, 260),
  face('one', '1', 'button 1', 354, 239, 42),
  face('two', '2', 'button 2', 400, 217, 42),
  pill('start', 'START', 'Start', 334, 295, 62, 20),
];

const masterSystemButtons: readonly PadButton[] = [
  dpad('up', '↑', 160, 158),
  dpad('left', '←', 131, 187),
  dpad('right', '→', 189, 187),
  dpad('down', '↓', 160, 216),
  // Pause is on the console, but games rely on it for menus and pausing.
  pill('pause', 'PAUSE', 'console Pause button', 330, 151, 64, 22),
  face('one', '1', 'button 1 and Start', 455, 210, 44),
  face('two', '2', 'button 2', 515, 210, 44),
];

const saturnButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 180, 82, 74),
  shoulder('r', 'R', 'R shoulder', 440, 82, 74),
  dpad('up', '↑', 155, 154),
  dpad('left', '←', 126, 183),
  dpad('right', '→', 184, 183),
  dpad('down', '↓', 155, 212),
  pill('start', 'START', 'Start', 310, 140, 66, 22),
  face('x', 'X', 'X button', 410, 157, 32),
  face('y', 'Y', 'Y button', 460, 157, 32),
  face('z', 'Z', 'Z button', 510, 157, 32),
  face('a', 'A', 'A button', 410, 207, 42),
  face('b', 'B', 'B button', 460, 207, 42),
  face('c', 'C', 'C button', 510, 207, 42),
];

const atari2600Buttons: readonly PadButton[] = [
  dpad('up', '↑', 178, 154, 'joystick up'),
  dpad('left', '←', 149, 183, 'joystick left'),
  dpad('right', '→', 207, 183, 'joystick right'),
  dpad('down', '↓', 178, 212, 'joystick down'),
  face('fire', 'FIRE', 'fire button', 452, 184, 50),
  // These live on the VCS console, but are game inputs rather than decoration.
  pill('select', 'SELECT', 'console Select switch', 280, 255, 66, 22),
  pill('reset', 'RESET', 'console Reset switch', 354, 255, 66, 22),
];

const atari5200Buttons: readonly PadButton[] = [
  stick('analog-stick', 'STICK', 'analog joystick', 132, 188),
  // Left and right pairs duplicate the controller's two logical fire actions.
  pill('top-fire-left', 'TOP', 'left top fire button', 92, 124, 42, 22),
  pill('bottom-fire-left', 'BOTTOM', 'left bottom fire button', 92, 249, 58, 22),
  pill('top-fire-right', 'TOP', 'right top fire button', 528, 124, 42, 22),
  pill('bottom-fire-right', 'BOTTOM', 'right bottom fire button', 528, 249, 58, 22),
  ...keypad(310, 104),
  pill('start', 'START', 'Start', 256, 250, 54, 22),
  pill('pause', 'PAUSE', 'Pause', 320, 250, 54, 22),
  pill('reset', 'RESET', 'Reset', 384, 250, 54, 22),
];

const atari7800Buttons: readonly PadButton[] = [
  dpad('up', '↑', 178, 154, 'joystick up'),
  dpad('left', '←', 149, 183, 'joystick left'),
  dpad('right', '→', 207, 183, 'joystick right'),
  dpad('down', '↓', 178, 212, 'joystick down'),
  face('one', '1', 'fire button 1', 430, 166, 42),
  face('two', '2', 'fire button 2', 478, 208, 42),
  pill('select', 'SELECT', 'console Select button', 256, 262, 58, 22),
  pill('pause', 'PAUSE', 'console Pause button', 322, 262, 58, 22),
  pill('reset', 'RESET', 'console Reset button', 388, 262, 58, 22),
];

const atariStButtons: readonly PadButton[] = [
  dpad('up', '↑', 178, 154, 'joystick up'),
  dpad('left', '←', 149, 183, 'joystick left'),
  dpad('right', '→', 207, 183, 'joystick right'),
  dpad('down', '↓', 178, 212, 'joystick down'),
  face('fire', 'FIRE', 'fire button', 452, 184, 50),
];

const channelFButtons: readonly PadButton[] = [
  dpad('up', '↑', 158, 154, 'hand controller tilt up'),
  dpad('left', '←', 129, 183, 'hand controller tilt left'),
  dpad('right', '→', 187, 183, 'hand controller tilt right'),
  dpad('down', '↓', 158, 212, 'hand controller tilt down'),
  face('twist-left', '↶', 'twist counter-clockwise', 414, 146, 38),
  face('twist-right', '↷', 'twist clockwise', 474, 146, 38),
  face('pull', 'PULL', 'pull controller up', 414, 216, 44),
  face('push', 'PUSH', 'push controller down', 474, 216, 44),
  pill('time', 'TIME', 'console Time button', 226, 272, 48, 20),
  pill('mode', 'MODE', 'console Mode button', 282, 272, 48, 20),
  pill('hold', 'HOLD', 'console Hold button', 338, 272, 48, 20),
  pill('start', 'START', 'console Start button', 394, 272, 48, 20),
];

const colecoVisionButtons: readonly PadButton[] = [
  dpad('up', '↑', 132, 166, 'joystick up'),
  dpad('left', '←', 103, 195, 'joystick left'),
  dpad('right', '→', 161, 195, 'joystick right'),
  dpad('down', '↓', 132, 224, 'joystick down'),
  ...keypad(310, 106),
  pill('left-fire', 'L FIRE', 'left fire button', 454, 151, 62, 24),
  pill('right-fire', 'R FIRE', 'right fire button', 484, 225, 62, 24),
];

const jaguarButtons: readonly PadButton[] = [
  dpad('up', '↑', 126, 154),
  dpad('left', '←', 97, 183),
  dpad('right', '→', 155, 183),
  dpad('down', '↓', 126, 212),
  ...keypad(310, 104),
  pill('pause', 'PAUSE', 'Pause', 276, 250, 58, 22),
  pill('option', 'OPTION', 'Option', 344, 250, 62, 22),
  face('a', 'A', 'A button', 480, 139, 38),
  face('b', 'B', 'B button', 458, 184, 38),
  face('c', 'C', 'C button', 436, 229, 38),
];

const lynxButtons: readonly PadButton[] = [
  dpad('up', '↑', 170, 154),
  dpad('left', '←', 141, 183),
  dpad('right', '→', 199, 183),
  dpad('down', '↓', 170, 212),
  face('a', 'A', 'A button', 452, 161, 42),
  face('b', 'B', 'B button', 452, 219, 42),
  pill('option-1', 'OPT 1', 'Option 1', 278, 260, 58, 22),
  pill('option-2', 'OPT 2', 'Option 2', 344, 260, 58, 22),
  pill('pause', 'PAUSE', 'Pause', 410, 260, 58, 22),
];

const neoGeoButtons: readonly PadButton[] = [
  dpad('up', '↑', 148, 154, 'joystick up'),
  dpad('left', '←', 119, 183, 'joystick left'),
  dpad('right', '→', 177, 183, 'joystick right'),
  dpad('down', '↓', 148, 212, 'joystick down'),
  // The AES stick presents A–D as one arcade row, not a face-button diamond.
  face('a', 'A', 'A button', 346, 191, 38),
  face('b', 'B', 'B button', 396, 191, 38),
  face('c', 'C', 'C button', 446, 191, 38),
  face('d', 'D', 'D button', 496, 191, 38),
  pill('select', 'SELECT', 'Select', 278, 256, 62, 22),
  pill('start', 'START', 'Start', 348, 256, 62, 22),
];

const pcEngineButtons: readonly PadButton[] = [
  dpad('up', '↑', 160, 158),
  dpad('left', '←', 131, 187),
  dpad('right', '→', 189, 187),
  dpad('down', '↓', 160, 216),
  pill('select', 'SELECT', 'Select', 278, 210, 66, 22),
  pill('run', 'RUN', 'Run', 350, 210, 58, 22),
  face('ii', 'II', 'button II', 455, 210, 44),
  face('i', 'I', 'button I', 515, 210, 44),
];

const pokemonMiniButtons: readonly PadButton[] = [
  dpad('up', '↑', 254, 202),
  dpad('left', '←', 225, 231),
  dpad('right', '→', 283, 231),
  dpad('down', '↓', 254, 260),
  face('b', 'B', 'B button', 354, 239, 40),
  face('a', 'A', 'A button', 398, 218, 40),
  shoulder('c', 'C', 'C shoulder', 392, 72, 58),
];

const virtualBoyButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L trigger', 170, 76, 72),
  shoulder('r', 'R', 'R trigger', 450, 76, 72),
  dpad('up', '↑', 142, 154, 'left D-pad up'),
  dpad('left', '←', 113, 183, 'left D-pad left'),
  dpad('right', '→', 171, 183, 'left D-pad right'),
  dpad('down', '↓', 142, 212, 'left D-pad down'),
  dpad('right-up', '↑', 352, 154, 'right D-pad up'),
  dpad('right-left', '←', 323, 183, 'right D-pad left'),
  dpad('right-right', '→', 381, 183, 'right D-pad right'),
  dpad('right-down', '↓', 352, 212, 'right D-pad down'),
  face('b', 'B', 'B button', 462, 216, 38),
  face('a', 'A', 'A button', 508, 180, 38),
  pill('select', 'SELECT', 'Select', 250, 270, 60, 22),
  pill('start', 'START', 'Start', 316, 270, 60, 22),
];

const wiiButtons: readonly PadButton[] = [
  // Nunchuk controls occupy the left half; Wii Remote controls the right.
  stick('nunchuk-stick', 'STICK', 'Nunchuk control stick', 150, 155),
  face('nunchuk-c', 'C', 'Nunchuk C button', 122, 230, 34),
  face('nunchuk-z', 'Z', 'Nunchuk Z button', 170, 248, 38),
  dpad('up', '↑', 380, 111, 'Wii Remote D-pad up'),
  dpad('left', '←', 351, 140, 'Wii Remote D-pad left'),
  dpad('right', '→', 409, 140, 'Wii Remote D-pad right'),
  dpad('down', '↓', 380, 169, 'Wii Remote D-pad down'),
  shoulder('b', 'B', 'Wii Remote B trigger', 486, 92, 54),
  face('a', 'A', 'Wii Remote A button', 450, 190, 42),
  pill('minus', '−', 'Minus', 372, 224, 30, 22),
  face('home', '⌂', 'Home', 410, 224, 24),
  pill('plus', '+', 'Plus', 448, 224, 30, 22),
  face('one', '1', 'button 1', 398, 275, 34),
  face('two', '2', 'button 2', 448, 275, 34),
];

// The current Triforce shelf is Mario Kart Arcade GP 2, whose real cabinet is
// a wheel and pedal set rather than a GameCube pad despite the shared chipset.
const triforceButtons: readonly PadButton[] = [
  stick('steering', 'WHEEL', 'steering wheel', 180, 180, 72),
  shoulder('brake', 'BRAKE', 'brake pedal', 382, 92, 76),
  shoulder('accelerator', 'GAS', 'accelerator pedal', 472, 92, 76),
  face('item', 'ITEM', 'Item button', 420, 184, 50),
  face('versus-cancel', 'VS', 'Versus Game Cancel button', 486, 224, 42),
];

const dualShock2Buttons: readonly PadButton[] = [
  shoulder('l2', 'L2', 'L2 shoulder', 168, 58, 72),
  shoulder('r2', 'R2', 'R2 shoulder', 452, 58, 72),
  shoulder('l1', 'L1', 'L1 shoulder', 196, 88, 80),
  shoulder('r1', 'R1', 'R1 shoulder', 424, 88, 80),
  dpad('up', '↑', 158, 151),
  dpad('left', '←', 129, 180),
  dpad('right', '→', 187, 180),
  dpad('down', '↓', 158, 209),
  pill('select', 'SELECT', 'Select', 276, 174, 58, 20),
  pill('start', 'START', 'Start', 344, 174, 58, 20),
  face('triangle', '△', 'Triangle', 462, 143),
  face('square', '□', 'Square', 426, 179),
  face('circle', '○', 'Circle', 498, 179),
  face('cross', '×', 'Cross', 462, 215),
  stick('l3', 'L3', 'left stick and L3', 264, 241),
  stick('r3', 'R3', 'right stick and R3', 356, 241),
];

const dualShock3Buttons: readonly PadButton[] = [
  ...dualShock2Buttons,
  face('ps', 'PS', 'PS button', 310, 285, 28),
];

const pspButtons: readonly PadButton[] = [
  shoulder('l', 'L', 'L shoulder', 168, 91, 72),
  shoulder('r', 'R', 'R shoulder', 452, 91, 72),
  dpad('up', '↑', 172, 151),
  dpad('left', '←', 143, 180),
  dpad('right', '→', 201, 180),
  dpad('down', '↓', 172, 209),
  stick('analog-nub', 'STICK', 'analog nub', 238, 252, 44),
  face('triangle', '△', 'Triangle', 466, 143, 34),
  face('square', '□', 'Square', 432, 177, 34),
  face('circle', '○', 'Circle', 500, 177, 34),
  face('cross', '×', 'Cross', 466, 211, 34),
  pill('home', 'HOME', 'Home', 278, 267, 52, 20),
  pill('select', 'SELECT', 'Select', 338, 267, 54, 20),
  pill('start', 'START', 'Start', 400, 267, 54, 20),
];

const switchButtons: readonly PadButton[] = [
  shoulder('zl', 'ZL', 'ZL trigger', 195, 42, 52),
  shoulder('l', 'L', 'L shoulder', 195, 70, 78),
  shoulder('r', 'R', 'R shoulder', 425, 70, 78),
  shoulder('zr', 'ZR', 'ZR trigger', 425, 42, 52),
  stick('left-stick', 'LS', 'left stick button', 207, 129),
  discDpad('up', '↑', 254, 170),
  discDpad('left', '←', 239, 185),
  discDpad('right', '→', 269, 185),
  discDpad('down', '↓', 254, 200),
  pill('minus', '−', 'Minus', 278, 127, 22, 22),
  face('home', '⌂', 'Home', 310, 102, 32),
  pill('plus', '+', 'Plus', 338, 127, 22, 22),
  face('capture', '', 'Capture', 310, 144, 20),
  stick('right-stick', 'RS', 'right stick button', 362, 174),
  face('x', 'X', 'X button', 405, 105, 27),
  face('y', 'Y', 'Y button', 381, 129, 27),
  face('a', 'A', 'A button', 429, 129, 27),
  face('b', 'B', 'B button', 405, 153, 27),
];

const wiiUButtons: readonly PadButton[] = [
  shoulder('zl', 'ZL', 'ZL trigger', 195, 42, 52),
  shoulder('l', 'L', 'L shoulder', 195, 70, 78),
  shoulder('r', 'R', 'R shoulder', 425, 70, 78),
  shoulder('zr', 'ZR', 'ZR trigger', 425, 42, 52),
  stick('left-stick', 'LS', 'left stick button', 207, 129),
  discDpad('up', '↑', 254, 170),
  discDpad('left', '←', 239, 185),
  discDpad('right', '→', 269, 185),
  discDpad('down', '↓', 254, 200),
  pill('minus', '−', 'Minus/Select', 278, 127, 22, 22),
  face('home', '⌂', 'Home', 310, 108, 30),
  pill('plus', '+', 'Plus/Start', 338, 127, 22, 22),
  stick('right-stick', 'RS', 'right stick button', 362, 174),
  face('x', 'X', 'X button', 405, 105, 27),
  face('y', 'Y', 'Y button', 381, 129, 27),
  face('a', 'A', 'A button', 429, 129, 27),
  face('b', 'B', 'B button', 405, 153, 27),
];

const originalXboxButtons: readonly PadButton[] = [
  shoulder('lt', 'LT', 'left trigger', 195, 42, 52),
  shoulder('rt', 'RT', 'right trigger', 425, 42, 52),
  stick('left-stick', 'LS', 'left stick and click', 207, 129),
  discDpad('up', '↑', 254, 170),
  discDpad('left', '←', 239, 185),
  discDpad('right', '→', 269, 185),
  discDpad('down', '↓', 254, 200),
  pill('back', 'BACK', 'Back', 280, 127, 42, 20),
  pill('start', 'START', 'Start', 338, 127, 46, 20),
  stick('right-stick', 'RS', 'right stick and click', 362, 190),
  face('y', 'Y', 'Y button', 405, 105, 27),
  face('x', 'X', 'X button', 381, 129, 27),
  face('b', 'B', 'B button', 429, 129, 27),
  face('a', 'A', 'A button', 405, 153, 27),
  face('white', 'WHITE', 'White button', 456, 178, 30),
  face('black', 'BLACK', 'Black button', 488, 150, 30),
];

const xbox360Buttons: readonly PadButton[] = [
  shoulder('lt', 'LT', 'left trigger', 195, 42, 52),
  shoulder('lb', 'LB', 'left bumper', 195, 70, 78),
  shoulder('rb', 'RB', 'right bumper', 425, 70, 78),
  shoulder('rt', 'RT', 'right trigger', 425, 42, 52),
  stick('left-stick', 'LS', 'left stick and click', 207, 129),
  discDpad('up', '↑', 254, 170),
  discDpad('left', '←', 239, 185),
  discDpad('right', '→', 269, 185),
  discDpad('down', '↓', 254, 200),
  pill('back', 'BACK', 'Back', 278, 127, 42, 20),
  face('guide', '', 'Xbox Guide button', 310, 102, 32),
  pill('start', 'START', 'Start', 340, 127, 46, 20),
  stick('right-stick', 'RS', 'right stick and click', 362, 174),
  face('y', 'Y', 'Y button', 405, 105, 27),
  face('x', 'X', 'X button', 381, 129, 27),
  face('b', 'B', 'B button', 429, 129, 27),
  face('a', 'A', 'A button', 405, 153, 27),
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

const makePadLayout = (
  art: PadArt,
  name: string,
  shortName: string,
  buttons: readonly PadButton[],
): PadLayout => ({ id: art, name, shortName, art, buttons });

const snesLayout = makePadLayout(
  'snes',
  'Super Nintendo Controller',
  'SNES',
  snesButtons,
);
const nesLayout = makePadLayout(
  'nes',
  'Nintendo Entertainment System Controller',
  'NES',
  nesButtons,
);
const genesisLayout = makePadLayout(
  'genesis',
  'Sega Genesis 6 Button Control Pad',
  'Genesis · 6 button',
  genesisButtons,
);
const n64Layout = makePadLayout(
  'n64',
  'Nintendo 64 Controller',
  'N64',
  n64Buttons,
);
const ps1Layout = makePadLayout(
  'ps1',
  'Original PlayStation Controller',
  'PS1',
  ps1Buttons,
);
const gameBoyLayout = makePadLayout('gb', 'Game Boy', 'Game Boy', gbButtons);
const gbaLayout = makePadLayout(
  'gb',
  'Game Boy Advance',
  'Game Boy Advance',
  gbaButtons,
);
const ndsLayout = makePadLayout('gb', 'Nintendo DS', 'Nintendo DS', ndsButtons);
const threeDsLayout = makePadLayout(
  'gb',
  'New Nintendo 3DS',
  'Nintendo 3DS',
  threeDsButtons,
);
const dreamcastLayout = makePadLayout(
  'generic',
  'Sega Dreamcast Controller',
  'Dreamcast',
  dreamcastButtons,
);
const gamecubeLayout = makePadLayout(
  'generic',
  'Nintendo GameCube Controller',
  'GameCube',
  gamecubeButtons,
);
const gameGearLayout = makePadLayout(
  'gb',
  'Sega Game Gear',
  'Game Gear',
  gameGearButtons,
);
const masterSystemLayout = makePadLayout(
  'nes',
  'Sega Master System Control Pad',
  'Master System',
  masterSystemButtons,
);
const saturnLayout = makePadLayout(
  'genesis',
  'Sega Saturn Control Pad',
  'Saturn',
  saturnButtons,
);
const atari2600Layout = makePadLayout(
  'generic',
  'Atari 2600 Joystick',
  'Atari 2600',
  atari2600Buttons,
);
const atari5200Layout = makePadLayout(
  'generic',
  'Atari 5200 Controller',
  'Atari 5200',
  atari5200Buttons,
);
const atari7800Layout = makePadLayout(
  'generic',
  'Atari 7800 Pro-Line Controller',
  'Atari 7800',
  atari7800Buttons,
);
const atariStLayout = makePadLayout(
  'generic',
  'Atari ST Joystick',
  'Atari ST',
  atariStButtons,
);
const channelFLayout = makePadLayout(
  'generic',
  'Fairchild Channel F Hand Controller',
  'Channel F',
  channelFButtons,
);
const colecoVisionLayout = makePadLayout(
  'generic',
  'ColecoVision Controller',
  'ColecoVision',
  colecoVisionButtons,
);
const jaguarLayout = makePadLayout(
  'generic',
  'Atari Jaguar Controller',
  'Jaguar',
  jaguarButtons,
);
const lynxLayout = makePadLayout(
  'generic',
  'Atari Lynx',
  'Atari Lynx',
  lynxButtons,
);
const neoGeoLayout = makePadLayout(
  'generic',
  'Neo Geo AES Joystick',
  'Neo Geo',
  neoGeoButtons,
);
const pcEngineLayout = makePadLayout(
  'nes',
  'PC Engine Control Pad',
  'PC Engine',
  pcEngineButtons,
);
const pokemonMiniLayout = makePadLayout(
  'gb',
  'Pokémon mini',
  'Pokémon mini',
  pokemonMiniButtons,
);
const dualShock2Layout = makePadLayout(
  'ps1',
  'PlayStation 2 DualShock 2',
  'PlayStation 2',
  dualShock2Buttons,
);
const dualShock3Layout = makePadLayout(
  'ps1',
  'PlayStation 3 DualShock 3',
  'PlayStation 3',
  dualShock3Buttons,
);
const pspLayout = makePadLayout(
  'generic',
  'PlayStation Portable',
  'PSP',
  pspButtons,
);
const switchLayout = makePadLayout(
  'xbox',
  'Nintendo Switch Pro Controller',
  'Switch',
  switchButtons,
);
const virtualBoyLayout = makePadLayout(
  'generic',
  'Virtual Boy Controller',
  'Virtual Boy',
  virtualBoyButtons,
);
const wiiLayout = makePadLayout(
  'generic',
  'Wii Remote and Nunchuk',
  'Wii',
  wiiButtons,
);
const wiiULayout = makePadLayout(
  'xbox',
  'Wii U GamePad',
  'Wii U',
  wiiUButtons,
);
const triforceLayout = makePadLayout(
  'generic',
  'Mario Kart Arcade GP 2 Cabinet',
  'Triforce Arcade',
  triforceButtons,
);
const originalXboxLayout = makePadLayout(
  'xbox',
  'Original Xbox Controller S',
  'Original Xbox',
  originalXboxButtons,
);
const xbox360Layout = makePadLayout(
  'xbox',
  'Xbox 360 Controller',
  'Xbox 360',
  xbox360Buttons,
);

export const PAD_LAYOUTS: Readonly<Record<string, PadLayout>> = {
  '3ds': threeDsLayout,
  atari2600: atari2600Layout,
  atari5200: atari5200Layout,
  atari7800: atari7800Layout,
  atarist: atariStLayout,
  channelf: channelFLayout,
  colecovision: colecoVisionLayout,
  dreamcast: dreamcastLayout,
  gamecube: gamecubeLayout,
  gamegear: gameGearLayout,
  gb: gameBoyLayout,
  gbc: gameBoyLayout,
  gba: gbaLayout,
  jaguar: jaguarLayout,
  jaguarcd: jaguarLayout,
  lynx: lynxLayout,
  mastersystem: masterSystemLayout,
  genesis: genesisLayout,
  megadrive: genesisLayout,
  n64: n64Layout,
  n64dd: n64Layout,
  nds: ndsLayout,
  neogeo: neoGeoLayout,
  nes: nesLayout,
  pcengine: pcEngineLayout,
  pokemini: pokemonMiniLayout,
  ps1: ps1Layout,
  psx: ps1Layout,
  ps2: dualShock2Layout,
  ps3: dualShock3Layout,
  psp: pspLayout,
  saturn: saturnLayout,
  sega32x: genesisLayout,
  segacd: genesisLayout,
  snes: snesLayout,
  supergrafx: pcEngineLayout,
  switch: switchLayout,
  triforce: triforceLayout,
  virtualboy: virtualBoyLayout,
  wii: wiiLayout,
  wiiu: wiiULayout,
  xbox: originalXboxLayout,
  xbox360: xbox360Layout,
};

export const GENERIC_LAYOUT: PadLayout = {
  id: 'generic',
  name: 'Classic Controller',
  shortName: 'Generic',
  art: 'generic',
  buttons: genericButtons,
};

export const REMAP_PLATFORM_IDS = [
  '3ds',
  'atari2600',
  'atari5200',
  'atari7800',
  'atarist',
  'channelf',
  'colecovision',
  'dreamcast',
  'gamecube',
  'gamegear',
  'gb',
  'gba',
  'jaguar',
  'jaguarcd',
  'lynx',
  'mastersystem',
  'genesis',
  'n64',
  'n64dd',
  'nds',
  'neogeo',
  'nes',
  'pcengine',
  'pokemini',
  'ports',
  'ps2',
  'ps3',
  'psp',
  'ps1',
  'saturn',
  'sega32x',
  'segacd',
  'snes',
  'supergrafx',
  'switch',
  'triforce',
  'virtualboy',
  'wii',
  'wiiu',
  'windows',
  'xbox',
  'xbox360',
] as const;

const DPAD_MAPPING = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
} satisfies ButtonMapping;

// A modern pad cannot mirror a 12-key grid literally. This projects its 3x4
// shape onto three shoulder/face rows plus View/Share/Menu along the bottom;
// games with overlays will still need a title-specific profile.
const KEYPAD_MAPPING = {
  'keypad-1': 'lb',
  'keypad-2': 'y',
  'keypad-3': 'rb',
  'keypad-4': 'x',
  'keypad-5': 'a',
  'keypad-6': 'b',
  'keypad-7': 'lt',
  'keypad-8': 'ls',
  'keypad-9': 'rt',
  'keypad-star': 'view',
  'keypad-0': 'share',
  'keypad-hash': 'menu',
} satisfies ButtonMapping;

const snesMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  start: 'menu',
  // Preserve the diamond: Nintendo B is bottom (Xbox A), A is right (Xbox B).
  y: 'x',
  b: 'a',
  a: 'b',
  x: 'y',
  l: 'lb',
  r: 'rb',
} satisfies ButtonMapping;
const nesMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  start: 'menu',
  // Keep Nintendo's A/B muscle memory instead of matching the printed letters.
  b: 'a',
  a: 'b',
} satisfies ButtonMapping;
const genesisMapping = {
  ...DPAD_MAPPING,
  mode: 'view',
  start: 'menu',
  // ABC follow the lower arc. XYZ use the upper face plus bumpers.
  a: 'x',
  b: 'a',
  c: 'b',
  x: 'lb',
  y: 'y',
  z: 'rb',
} satisfies ButtonMapping;
const n64Mapping = {
  ...DPAD_MAPPING,
  start: 'menu',
  b: 'x',
  a: 'a',
  'control-stick': 'ls',
  // The four C directions are one right-stick control on the physical diagram.
  'c-up': 'rs',
  'c-left': 'rs',
  'c-right': 'rs',
  'c-down': 'rs',
  l: 'lb',
  r: 'rb',
  z: 'lt',
} satisfies ButtonMapping;
const ps1Mapping = {
  ...DPAD_MAPPING,
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
} satisfies ButtonMapping;
const gameBoyMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  start: 'menu',
  b: 'a',
  a: 'b',
} satisfies ButtonMapping;
const gbaMapping = {
  ...gameBoyMapping,
  l: 'lb',
  r: 'rb',
} satisfies ButtonMapping;
const ndsMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  start: 'menu',
  y: 'x',
  b: 'a',
  a: 'b',
  x: 'y',
  l: 'lb',
  r: 'rb',
} satisfies ButtonMapping;
const threeDsMapping = {
  ...ndsMapping,
  'circle-pad': 'ls',
  'c-stick': 'rs',
  zl: 'lt',
  zr: 'rt',
  home: 'guide',
} satisfies ButtonMapping;
const dreamcastMapping = {
  ...DPAD_MAPPING,
  'analog-stick': 'ls',
  l: 'lt',
  r: 'rt',
  start: 'menu',
  y: 'y',
  x: 'x',
  b: 'b',
  a: 'a',
} satisfies ButtonMapping;
const gamecubeMapping = {
  ...DPAD_MAPPING,
  'control-stick': 'ls',
  'c-stick': 'rs',
  l: 'lt',
  r: 'rt',
  z: 'rb',
  start: 'menu',
  // GameCube A is the primary centre button; B/X/Y then follow their positions.
  a: 'a',
  b: 'x',
  x: 'b',
  y: 'y',
} satisfies ButtonMapping;
const gameGearMapping = {
  ...DPAD_MAPPING,
  one: 'a',
  two: 'b',
  start: 'menu',
} satisfies ButtonMapping;
const masterSystemMapping = {
  ...DPAD_MAPPING,
  one: 'a',
  two: 'b',
  pause: 'menu',
} satisfies ButtonMapping;
const saturnMapping = {
  ...DPAD_MAPPING,
  start: 'menu',
  // As on Genesis, keep the two three-button rows rather than alphabetizing.
  a: 'x',
  b: 'a',
  c: 'b',
  x: 'lb',
  y: 'y',
  z: 'rb',
  l: 'lt',
  r: 'rt',
} satisfies ButtonMapping;
const atari2600Mapping = {
  ...DPAD_MAPPING,
  fire: 'a',
  select: 'view',
  reset: 'share',
} satisfies ButtonMapping;
const atari5200Mapping = {
  'analog-stick': 'ls',
  // The lower fire button is the commonly used primary action.
  'top-fire-left': 'b',
  'top-fire-right': 'b',
  'bottom-fire-left': 'a',
  'bottom-fire-right': 'a',
  ...KEYPAD_MAPPING,
  start: 'menu',
  pause: 'view',
  reset: 'share',
} satisfies ButtonMapping;
const atari7800Mapping = {
  ...DPAD_MAPPING,
  one: 'a',
  two: 'b',
  select: 'view',
  pause: 'menu',
  reset: 'share',
} satisfies ButtonMapping;
const atariStMapping = {
  ...DPAD_MAPPING,
  fire: 'a',
} satisfies ButtonMapping;
const channelFMapping = {
  ...DPAD_MAPPING,
  'twist-left': 'lb',
  'twist-right': 'rb',
  pull: 'b',
  push: 'a',
  time: 'view',
  mode: 'x',
  hold: 'y',
  start: 'menu',
} satisfies ButtonMapping;
const colecoVisionMapping = {
  ...DPAD_MAPPING,
  ...KEYPAD_MAPPING,
  'left-fire': 'a',
  'right-fire': 'b',
} satisfies ButtonMapping;
const jaguarMapping = {
  ...DPAD_MAPPING,
  ...KEYPAD_MAPPING,
  pause: 'menu',
  option: 'view',
  // The Jaguar's diagonal A/B/C bank reads top-to-bottom as Y/B/A on Xbox.
  a: 'y',
  b: 'b',
  c: 'a',
} satisfies ButtonMapping;
const lynxMapping = {
  ...DPAD_MAPPING,
  a: 'a',
  b: 'b',
  'option-1': 'x',
  'option-2': 'y',
  pause: 'menu',
} satisfies ButtonMapping;
const neoGeoMapping = {
  ...DPAD_MAPPING,
  // Bend the four-button arcade row clockwise around the Xbox diamond.
  a: 'a',
  b: 'x',
  c: 'y',
  d: 'b',
  select: 'view',
  start: 'menu',
} satisfies ButtonMapping;
const pcEngineMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  run: 'menu',
  ii: 'a',
  i: 'b',
} satisfies ButtonMapping;
const pokemonMiniMapping = {
  ...DPAD_MAPPING,
  b: 'a',
  a: 'b',
  c: 'rb',
} satisfies ButtonMapping;
const virtualBoyMapping = {
  ...DPAD_MAPPING,
  // Xbox has no second D-pad, so the right one is an aggregate right-stick bind.
  'right-up': 'rs',
  'right-down': 'rs',
  'right-left': 'rs',
  'right-right': 'rs',
  b: 'a',
  a: 'b',
  l: 'lb',
  r: 'rb',
  select: 'view',
  start: 'menu',
} satisfies ButtonMapping;
const wiiMapping = {
  ...DPAD_MAPPING,
  'nunchuk-stick': 'ls',
  'nunchuk-c': 'lb',
  'nunchuk-z': 'lt',
  b: 'rt',
  a: 'a',
  minus: 'view',
  home: 'guide',
  plus: 'menu',
  // Sideways Wii Remote games conventionally use 2 as the primary action.
  one: 'b',
  two: 'a',
} satisfies ButtonMapping;
const triforceMapping = {
  steering: 'ls',
  brake: 'lt',
  accelerator: 'rt',
  item: 'a',
  'versus-cancel': 'b',
} satisfies ButtonMapping;
const dualShock2Mapping = {
  ...DPAD_MAPPING,
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
  l3: 'ls',
  r3: 'rs',
} satisfies ButtonMapping;
const dualShock3Mapping = {
  ...dualShock2Mapping,
  ps: 'guide',
} satisfies ButtonMapping;
const pspMapping = {
  ...DPAD_MAPPING,
  'analog-nub': 'ls',
  triangle: 'y',
  square: 'x',
  circle: 'b',
  cross: 'a',
  l: 'lb',
  r: 'rb',
  home: 'guide',
  select: 'view',
  start: 'menu',
} satisfies ButtonMapping;
const switchMapping = {
  ...DPAD_MAPPING,
  'left-stick': 'ls',
  'right-stick': 'rs',
  zl: 'lt',
  l: 'lb',
  r: 'rb',
  zr: 'rt',
  minus: 'view',
  home: 'guide',
  plus: 'menu',
  capture: 'share',
  y: 'x',
  b: 'a',
  a: 'b',
  x: 'y',
} satisfies ButtonMapping;
const wiiUMapping = {
  ...DPAD_MAPPING,
  'left-stick': 'ls',
  'right-stick': 'rs',
  zl: 'lt',
  l: 'lb',
  r: 'rb',
  zr: 'rt',
  minus: 'view',
  home: 'guide',
  plus: 'menu',
  y: 'x',
  b: 'a',
  a: 'b',
  x: 'y',
} satisfies ButtonMapping;
const originalXboxMapping = {
  ...DPAD_MAPPING,
  lt: 'lt',
  rt: 'rt',
  'left-stick': 'ls',
  'right-stick': 'rs',
  back: 'view',
  start: 'menu',
  y: 'y',
  x: 'x',
  b: 'b',
  a: 'a',
  white: 'lb',
  black: 'rb',
} satisfies ButtonMapping;
const xbox360Mapping = {
  ...DPAD_MAPPING,
  lt: 'lt',
  lb: 'lb',
  rb: 'rb',
  rt: 'rt',
  'left-stick': 'ls',
  'right-stick': 'rs',
  back: 'view',
  guide: 'guide',
  start: 'menu',
  y: 'y',
  x: 'x',
  b: 'b',
  a: 'a',
} satisfies ButtonMapping;
const genericMapping = {
  ...DPAD_MAPPING,
  select: 'view',
  start: 'menu',
  x: 'x',
  y: 'y',
  a: 'a',
  b: 'b',
  l: 'lb',
  r: 'rb',
} satisfies ButtonMapping;

export const DEFAULT_MAPPINGS: Readonly<Record<string, ButtonMapping>> = {
  '3ds': threeDsMapping,
  atari2600: atari2600Mapping,
  atari5200: atari5200Mapping,
  atari7800: atari7800Mapping,
  atarist: atariStMapping,
  channelf: channelFMapping,
  colecovision: colecoVisionMapping,
  dreamcast: dreamcastMapping,
  gamecube: gamecubeMapping,
  gamegear: gameGearMapping,
  gb: gameBoyMapping,
  gbc: gameBoyMapping,
  gba: gbaMapping,
  jaguar: jaguarMapping,
  jaguarcd: jaguarMapping,
  lynx: lynxMapping,
  mastersystem: masterSystemMapping,
  genesis: genesisMapping,
  megadrive: genesisMapping,
  n64: n64Mapping,
  n64dd: n64Mapping,
  nds: ndsMapping,
  neogeo: neoGeoMapping,
  nes: nesMapping,
  pcengine: pcEngineMapping,
  pokemini: pokemonMiniMapping,
  ps1: ps1Mapping,
  psx: ps1Mapping,
  ps2: dualShock2Mapping,
  ps3: dualShock3Mapping,
  psp: pspMapping,
  saturn: saturnMapping,
  sega32x: genesisMapping,
  segacd: genesisMapping,
  snes: snesMapping,
  supergrafx: pcEngineMapping,
  switch: switchMapping,
  triforce: triforceMapping,
  virtualboy: virtualBoyMapping,
  wii: wiiMapping,
  wiiu: wiiUMapping,
  xbox: originalXboxMapping,
  xbox360: xbox360Mapping,
  generic: genericMapping,
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
