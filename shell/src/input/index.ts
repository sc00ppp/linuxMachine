import type { ConsoleInput, Dir } from '../core/types';

const INITIAL_REPEAT_MS = 350;
const REPEAT_MS = 120;
const STICK_THRESHOLD = 0.5;

type HeldNav = {
  timeoutId: ReturnType<typeof setTimeout>;
  intervalId: ReturnType<typeof setInterval> | null;
};

type GamepadState = {
  dirs: Record<Dir, boolean>;
  accept: boolean;
  back: boolean;
  home: boolean;
  menu: boolean;
};

const DIRECTIONS: readonly Dir[] = ['up', 'down', 'left', 'right'];

function keyboardInput(code: string, key: string): ConsoleInput | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return { type: 'nav', dir: 'up' };
    case 'ArrowDown':
    case 'KeyS':
      return { type: 'nav', dir: 'down' };
    case 'ArrowLeft':
    case 'KeyA':
      return { type: 'nav', dir: 'left' };
    case 'ArrowRight':
    case 'KeyD':
      return { type: 'nav', dir: 'right' };
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      return { type: 'accept' };
    case 'Escape':
    case 'Backspace':
      return { type: 'back' };
    case 'KeyH':
    case 'Home':
    case 'F1':
      return { type: 'home' };
    case 'KeyX':
      return { type: 'menu' };
  }

  // `code` gives layout-independent WASD in browsers. Falling back to `key`
  // also covers synthetic events and older embedded WebViews that omit it.
  switch (key.toLowerCase()) {
    case 'arrowup':
    case 'w':
      return { type: 'nav', dir: 'up' };
    case 'arrowdown':
    case 's':
      return { type: 'nav', dir: 'down' };
    case 'arrowleft':
    case 'a':
      return { type: 'nav', dir: 'left' };
    case 'arrowright':
    case 'd':
      return { type: 'nav', dir: 'right' };
    case 'enter':
    case ' ':
    case 'spacebar':
      return { type: 'accept' };
    case 'escape':
    case 'backspace':
      return { type: 'back' };
    case 'h':
    case 'home':
    case 'f1':
      return { type: 'home' };
    case 'x':
      return { type: 'menu' };
    default:
      return null;
  }
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return true;
  }

  if (!(target instanceof HTMLInputElement)) return false;

  // Buttons, sliders, and similar controls are not text-entry surfaces.
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(target.type);
}

function buttonDown(gamepad: Gamepad, index: number): boolean {
  const button = gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value > 0.5));
}

function readGamepad(gamepad: Gamepad): GamepadState {
  const horizontal = gamepad.axes[0] ?? 0;
  const vertical = gamepad.axes[1] ?? 0;

  return {
    dirs: {
      up: buttonDown(gamepad, 12) || vertical <= -STICK_THRESHOLD,
      down: buttonDown(gamepad, 13) || vertical >= STICK_THRESHOLD,
      left: buttonDown(gamepad, 14) || horizontal <= -STICK_THRESHOLD,
      right: buttonDown(gamepad, 15) || horizontal >= STICK_THRESHOLD,
    },
    accept: buttonDown(gamepad, 0),
    back: buttonDown(gamepad, 1),
    // Some browsers/controllers omit Guide, so Start remains an intentional
    // equivalent rather than merely a fallback.
    home: buttonDown(gamepad, 16) || buttonDown(gamepad, 9),
    // X on the standard (Xbox) layout — the Controllers overlay button.
    menu: buttonDown(gamepad, 2),
  };
}

function emptyGamepadState(): GamepadState {
  return {
    dirs: { up: false, down: false, left: false, right: false },
    accept: false,
    back: false,
    home: false,
    menu: false,
  };
}

/** Starts keyboard + Gamepad API listeners. Returns a stop function. */
export function startInput(handler: (e: ConsoleInput) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let stopped = false;
  let animationFrameId: number | null = null;
  const heldNav = new Map<string, HeldNav>();
  const heldKeyboardCodes = new Set<string>();
  const gamepadStates = new Map<number, GamepadState>();

  const emit = (input: ConsoleInput) => {
    if (!stopped) handler(input);
  };

  const releaseNav = (source: string) => {
    const held = heldNav.get(source);
    if (!held) return;

    clearTimeout(held.timeoutId);
    if (held.intervalId !== null) clearInterval(held.intervalId);
    heldNav.delete(source);
  };

  const pressNav = (source: string, dir: Dir) => {
    if (heldNav.has(source) || stopped) return;

    // Timers are armed before dispatch so cleanup remains correct even when a
    // handler synchronously changes screens or calls the returned stop method.
    const held: HeldNav = {
      intervalId: null,
      timeoutId: setTimeout(() => {
        if (stopped || !heldNav.has(source)) return;
        emit({ type: 'nav', dir });
        held.intervalId = setInterval(() => {
          if (!stopped && heldNav.has(source)) emit({ type: 'nav', dir });
        }, REPEAT_MS);
      }, INITIAL_REPEAT_MS),
    };

    heldNav.set(source, held);
    emit({ type: 'nav', dir });
  };

  const releaseKeyboard = () => {
    for (const code of heldKeyboardCodes) releaseNav(`keyboard:${code}`);
    heldKeyboardCodes.clear();
  };

  const releaseGamepad = (index: number) => {
    for (const dir of DIRECTIONS) releaseNav(`gamepad:${index}:${dir}`);
    gamepadStates.delete(index);
  };

  const releaseAllGamepads = () => {
    for (const index of [...gamepadStates.keys()]) releaseGamepad(index);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTextInput(event.target)) return;

    const input = keyboardInput(event.code, event.key);
    if (!input) return;

    event.preventDefault();
    const sourceKey = event.code || event.key;
    if (heldKeyboardCodes.has(sourceKey)) return;
    heldKeyboardCodes.add(sourceKey);

    if (input.type === 'nav') {
      pressNav(`keyboard:${sourceKey}`, input.dir);
    } else {
      emit(input);
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const sourceKey = event.code || event.key;
    if (!heldKeyboardCodes.delete(sourceKey)) return;

    const input = keyboardInput(event.code, event.key);
    if (input?.type === 'nav') releaseNav(`keyboard:${sourceKey}`);

    // A key that began outside a text field still has to be released even if
    // focus moved into one while it was held.
    if (!isTextInput(event.target)) event.preventDefault();
  };

  const onBlur = () => {
    releaseKeyboard();
    releaseAllGamepads();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onBlur();
  };

  const pollGamepads = () => {
    if (stopped) return;

    let gamepads: (Gamepad | null)[] = [];
    try {
      gamepads = Array.from(navigator.getGamepads());
    } catch {
      // A privacy mode or embedded browser may expose the API but deny access.
      // Keep keyboard input alive and try the gamepad API again next frame.
    }

    const connectedIndices = new Set<number>();

    for (const gamepad of gamepads) {
      if (!gamepad) continue;

      connectedIndices.add(gamepad.index);
      const previous = gamepadStates.get(gamepad.index) ?? emptyGamepadState();
      const current = readGamepad(gamepad);

      for (const dir of DIRECTIONS) {
        const source = `gamepad:${gamepad.index}:${dir}`;
        if (current.dirs[dir] && !previous.dirs[dir]) {
          pressNav(source, dir);
        } else if (!current.dirs[dir] && previous.dirs[dir]) {
          releaseNav(source);
        }
      }

      if (current.accept && !previous.accept) emit({ type: 'accept' });
      if (current.back && !previous.back) emit({ type: 'back' });
      if (current.home && !previous.home) emit({ type: 'home' });
      if (current.menu && !previous.menu) emit({ type: 'menu' });

      gamepadStates.set(gamepad.index, current);
    }

    for (const index of [...gamepadStates.keys()]) {
      if (!connectedIndices.has(index)) releaseGamepad(index);
    }

    animationFrameId = window.requestAnimationFrame(pollGamepads);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (typeof navigator !== 'undefined' && 'getGamepads' in navigator) {
    animationFrameId = window.requestAnimationFrame(pollGamepads);
  }

  return () => {
    if (stopped) return;
    stopped = true;

    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
    }

    releaseKeyboard();
    releaseAllGamepads();
    for (const source of [...heldNav.keys()]) releaseNav(source);
  };
}
