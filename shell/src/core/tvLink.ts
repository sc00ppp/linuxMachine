import { createLink } from '../link/transport';
import { CHANNELS } from './channels';
import { useConsoleStore } from './store';
import { focusManager } from '../focus';
import type { ConsoleInput } from './types';

/**
 * The TV's side of the daemon link (integrator-owned).
 *
 * - Publishes UI snapshots on the ring-buffered `state` channel whenever the
 *   store or the focused element changes, so a (re)connecting phone can
 *   mirror the row instantly.
 * - Applies `input` events from the phone through the SAME handler local
 *   gamepad/keyboard input uses — the phone is just another controller.
 * - Shows incoming `text` as a lightweight on-screen toast until real text
 *   fields exist (YouTube search etc.).
 *
 * The daemon may simply not be running during pure-UI development; the
 * transport quietly keeps retrying in the background, which is exactly the
 * behavior we want on the real console too.
 */

const DAEMON_URL = 'ws://127.0.0.1:43919/ws';

const VALID_INPUT_TYPES = new Set(['nav', 'accept', 'back', 'home', 'menu']);
const VALID_DIRS = new Set(['up', 'down', 'left', 'right']);

function asConsoleInput(payload: unknown): ConsoleInput | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== 'string' || !VALID_INPUT_TYPES.has(p.type)) return null;
  if (p.type === 'nav') {
    return typeof p.dir === 'string' && VALID_DIRS.has(p.dir)
      ? ({ type: 'nav', dir: p.dir } as ConsoleInput)
      : null;
  }
  return { type: p.type } as ConsoleInput;
}

/** Minimal glass toast for incoming phone text; replaced by real fields later. */
function showTextToast(text: string, commit: boolean): void {
  const id = 'tv-text-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'glass';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '7rem',
      transform: 'translateX(-50%)',
      padding: '0.8rem 1.6rem',
      borderRadius: '999px',
      font: '600 1.4rem var(--font-ui)',
      color: 'var(--text)',
      zIndex: '10000',
      pointerEvents: 'none',
      maxWidth: '70vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(el);
  }
  el.textContent = text.length ? text : '…';
  el.style.opacity = '1';
  window.clearTimeout(Number(el.dataset.hideTimer));
  el.dataset.hideTimer = String(
    window.setTimeout(
      () => {
        el.style.transition = 'opacity 300ms ease';
        el.style.opacity = '0';
      },
      commit ? 2500 : 4000,
    ),
  );
}

export function startTvLink(onInput: (e: ConsoleInput) => void): () => void {
  const link = createLink({ url: DAEMON_URL, role: 'tv' });

  const unsubInput = link.subscribe('input', (e) => {
    const input = asConsoleInput(e.payload);
    if (input) onInput(input);
  });

  const unsubText = link.subscribe('text', (e) => {
    const p = e.payload as { text?: unknown; commit?: unknown };
    if (typeof p?.text === 'string') showTextToast(p.text, p.commit === true);
  });

  // --- state publishing ----------------------------------------------------

  let lastJson = '';
  const publish = () => {
    const s = useConsoleStore.getState();
    const snapshot = {
      mode: s.mode,
      view: s.view,
      gamesLevel: s.gamesLevel,
      focusedId: focusManager.focusedId(),
      runningChannel: s.runningChannel,
      runningTitle: s.runningTitle,
      shelfOpen: s.shelfOpen,
      channels: CHANNELS.map((c) => ({
        id: c.id,
        title: c.title,
        accent: c.accent,
        glyph: c.glyph,
      })),
    };
    const json = JSON.stringify(snapshot);
    if (json === lastJson) return;
    lastJson = json;
    link.send('state', snapshot);
  };

  const unsubStore = useConsoleStore.subscribe(publish);
  // Focus changes never touch the store, and the focus engine has no
  // subscription surface — a cheap diffing poll keeps the mirror honest.
  const focusPoll = window.setInterval(publish, 250);
  publish();

  return () => {
    unsubInput();
    unsubText();
    unsubStore();
    window.clearInterval(focusPoll);
    link.close();
  };
}
