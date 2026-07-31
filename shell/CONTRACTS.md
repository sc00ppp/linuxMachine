# Module contracts — Phase 1 interaction prototype

You are one of several workers building modules of this React app in parallel.
**Read `../DESIGN.md` first** (visual language, motion, sound personality).
`../ARCHITECTURE.md` is background; this prototype is the browser-run TV shell
only (no daemon, no phone yet).

## Hard rules

1. **Only create/edit files inside the directory you own.** Everything else —
   `src/core/`, `src/App.tsx`, `src/main.tsx`, configs — is read-only context.
2. TypeScript strict; React 19 function components; plain CSS files imported
   by your components (no CSS-in-JS, no Tailwind). One CSS file per component
   is fine.
3. Use the design tokens (CSS custom properties) listed below — never
   hard-code palette colors. Channel accents arrive at runtime via
   `--accent` set inline by whoever renders the element.
4. Respect `prefers-reduced-motion: reduce` (skip/shorten animations).
5. Sizes in `rem` so `--ui-scale` works. Target is a 1920×1080 TV viewport;
   root font-size is 16px × scale. Text must be readable from a couch —
   minimum ~1.25rem for labels.
6. Dependencies available: react, react-dom, zustand. **Add nothing else.**
7. All motion timings/easings come from `src/motion/tuning.ts` (`tuning`).
   Web Animations API (`el.animate`) for choreographed motion; CSS
   transitions for micro-interactions.

## Layout & ownership

```
shell/src/
  core/      types.ts, channels.ts, store.ts   [INTEGRATOR — read-only]
  motion/    tuning.ts [read-only]; transitions.ts + support  [WORKER: motion]
  input/     index.ts + support                [WORKER: input+focus]
  focus/     index.tsx + support               [WORKER: input+focus]
  sound/     index.ts + support                [WORKER: sound]
  styles/    tokens.css, global.css            [WORKER: theme]
  home/      HomeScreen.tsx + support          [WORKER: home]
  appsim/    AppSim.tsx + support              [WORKER: overlay]
  overlay/   HomeShelf.tsx + support           [WORKER: overlay]
```

`src/App.tsx` (already written) shows exactly how modules are wired — match it.

## Design tokens (theme worker defines these names; everyone consumes them)

```
--bg-0        deepest background        (≈ #17151f)
--bg-1        raised background         (≈ #1e1b26)
--text        warm off-white            (≈ #f2eee8)
--text-dim    secondary text
--accent      per-element channel color (set inline where rendered)
--radius-tile tile corner radius
--radius-card card/shelf corner radius
--shadow-soft ambient shadow
--font-ui     'Nunito Variable', system rounded fallbacks
--ui-scale    1 | 1.25 | 1.5 | 1.75 (root font-size multiplier)
```

## Contracts by module

### `src/input/index.ts` — semantic input

```ts
import type { ConsoleInput } from '../core/types';
/** Starts keyboard + Gamepad API listeners. Returns a stop function. */
export function startInput(handler: (e: ConsoleInput) => void): () => void;
```

- Keyboard: arrows/WASD → nav; Enter/Space → accept; Escape/Backspace → back;
  `h`/`Home`/`F1` → home.
- Gamepad (standard mapping, rAF polling): d-pad 12–15 + left stick (0.5
  threshold) → nav; A(0) accept; B(1) back; Guide(16) **and** Start(9) → home.
- Fire on button-DOWN immediately (latency = feel). Held nav repeats: 350 ms
  initial delay, then every 120 ms. No repeat for accept/back/home.
- Ignore keyboard events when `event.target` is a text input.

### `src/focus/index.tsx` — spatial focus engine

```ts
import type { Dir } from '../core/types';

export function useFocusable(opts: {
  id: string;
  scope: string;              // 'home' | 'shelf' | future scopes
  onAccept?: () => void;
  autoFocus?: boolean;        // focus when scope activates w/ no memory
}): { ref: (el: HTMLElement | null) => void; focused: boolean };

export const focusManager: {
  setScope(scope: string): void;   // 'none' disables focus entirely
  getScope(): string;
  move(dir: Dir): boolean;         // false = edge (no candidate) — caller bumps
  accept(): void;                  // invoke focused element's onAccept
  focusedId(): string | null;
  focusId(id: string): void;
};
```

- Geometric navigation: among registered elements of the active scope, pick
  the best candidate in direction `dir` from the focused rect (direction beam
  first — overlapping perpendicular projection — then Euclidean fallback).
- **Per-scope focus memory**: leaving a scope and returning restores the last
  focused id (this is how "return Home lands on the same tile" works). Memory
  survives unmount/remount of the elements.
- No React context needed if a module-level registry is simpler — your call.
- Registered elements get `data-focused="true"` when focused (CSS hooks) and
  the hook returns `focused` for React use.

### `src/sound/index.ts` — WebAudio synth, no assets

```ts
export type SfxName =
  | 'tick' | 'edge' | 'accept' | 'back'
  | 'launch' | 'homecoming' | 'shelfOpen' | 'shelfClose' | 'pair';
export const sound: {
  init(): void;                 // idempotent; call from a user gesture
  play(name: SfxName): void;
  startAmbient(): void;         // quiet evolving pad bed
  stopAmbient(): void;
  duck(on: boolean): void;      // lower ambient under previews/apps
  setVolume(v: number): void;   // 0..1 master
};
```

Personality (DESIGN.md §7): warm mallets — marimba/kalimba territory. `tick` =
soft woody blip; `edge` = duller, quieter thud; `accept` = two quick warm
notes; `launch` = rising warm whoosh + chime; `homecoming` = that chime
inverted; `pair` = two-note handshake. Synthesize everything (osc + filtered
noise + exponential decay envelopes). Keep levels gentle; master ~-12 dB.

### `src/styles/` — tokens.css + global.css

- Define every token above; cozy-dusk palette per DESIGN.md §1 (subtle
  navy→plum vertical gradient body background, faint film-grain overlay via an
  SVG feTurbulence data-URI, gentle edge vignette).
- Global resets, `--font-ui` stack (font files are already imported in
  main.tsx via @fontsource-variable/nunito — just reference the family),
  `.console-root` fills the viewport, hides cursor after 3 s idle
  (`html.cursor-idle *` pattern or similar), text antialiasing.
- Root font-size: `calc(16px * var(--ui-scale, 1))`.
- A `prefers-reduced-motion` block that zeroes animation/transition durations.

### `src/motion/transitions.ts` — launch/return choreography

```ts
/** Zoom a tile up to cover the screen; resolves when covered. */
export function playLaunch(tileEl: HTMLElement, accent: string): Promise<void>;
/** Reverse: fullscreen shrinks back into the tile; resolves when landed. */
export function playReturn(tileEl: HTMLElement, accent: string): Promise<void>;
```

- Technique (vAMP-derived): clone the tile into a `position: fixed` overlay
  layer, animate the clone's transform/borderRadius from tile rect →
  fullscreen (WAAPI, `tuning.launchZoomMs/launchZoomEase`); simultaneously
  collapse Home chrome — any element tagged `data-collapse="x" | "y" | "fade"`
  measures itself and animates margin/size/opacity away
  (`tuning.chromeAwayMs`). `playReturn` runs the exact reverse
  (`returnShrinkMs/returnShrinkEase`, chrome back after `chromeBackDelayMs`).
- Clean up all clones/inline styles on settle. Reduced motion → quick fades.
- Also export `collapseChrome(root)/restoreChrome(root)` if useful internally.

### `src/home/HomeScreen.tsx` — the channel wall (DESIGN.md §2–3)

- 4×2 grid of big 16:10 squircle tiles, centered, from `CHANNELS`
  (`core/channels.ts`); slots without a channel render as faint dashed
  "empty socket" tiles (not focusable).
- Tiles: `useFocusable({ id: channel.id, scope: 'home', onAccept })`. Focused
  tile scales ~1.08 with a soft `--accent` glow (CSS via `[data-focused]`),
  label below the tile brightens. Continue tile shows its `emptyHint` state.
- **Launch flow** on accept: `sound.play('launch')` → `await
  playLaunch(tileEl, accent)` → `useConsoleStore.getState().launchApp(id)`.
- **Return flow**: on mount, if `returningChannel` is set, render immediately,
  locate that tile, `sound.play('homecoming')` + `await playReturn(tileEl,
  accent)` → `finishReturn()`. Focus memory handles landing on the right tile.
- Chrome (all tagged `data-collapse`): top bar — live clock, fake wifi +
  controller status glyphs, small avatar chip (fade to ~0.3 opacity after 5 s
  idle); bottom bar — button hints (Ⓐ Open  Ⓑ Back  ⌂ Home); centered page
  dot (single page v1).
- Hold focus 1.5 s → context strip fades in under the grid (one line, e.g.
  "5 games · last played Breath of the Wild" — fake data per channel is fine).
- Ambient: call `sound.startAmbient()` on mount, `duck(true)` while launching.

### `src/overlay/HomeShelf.tsx` + `src/appsim/AppSim.tsx`

- **AppSim**: fullscreen fake application proving the loop. Accent-colored
  calm animated background (slow drifting blobs/gradient using the running
  channel's accent — read `runningChannel` from the store + `channelById`),
  big channel title, small hint text "Press H — Home". No input handling
  (App.tsx owns it).
- **HomeShelf** (DESIGN.md §4): backdrop dims + blurs the app
  (`backdrop-filter`); a compact shelf card slides up from the bottom third
  (`tuning.shelfOpenMs/shelfEase`). Center: current-app card (accent strip,
  title) with two actions — **Resume** (`closeShelf()` + `sound.play('shelfClose')`)
  and **Quit to Home** (`sound.play('back')` + `requestReturn()`). Flanks:
  quick-action chips — Volume, Controllers, Phone, Sleep — focusable but v1
  they just pulse (popEase) and no-op.
- All shelf controls `useFocusable({ scope: 'shelf', ... })`; Resume gets
  `autoFocus`. Shelf must look identical over any app — that's the point.

## Round 2 — Games room, Controllers overlay, Remap room

Same hard rules as above. New read-only integrator files: `src/core/platforms.ts`
(console catalog — PC/Steam is just another console) and the extended
`src/core/store.ts` (view/controllersOpen/remapPlatform/remapListening) and
`src/App.tsx` (routing + input priority — read it; App owns ALL back/menu
handling, your components never handle back themselves).

Design context: DESIGN.md §11 (Console Room), §12 (Controllers overlay,
Wii Home spirit), §13 (remap room). Glass material: use the `.glass` /
`.glass--strong` utility classes or the `--glass-*` tokens (styles/glass.css).

### `src/games/GamesRoom.tsx` + support — [WORKER: games]

Full-screen in-shell room replacing the wall (`view === 'games'`).

- Layout: **left rail** of consoles from `PLATFORMS`, grouped under small
  maker headers in `MAKERS` order, each entry = glyph + name, focusable
  (`scope: 'games'`, ids like `rail-<platformId>`); **main area** = box-art
  grid (3 rows max, scrolls) of the selected console's `games`, each a card
  with an accent-gradient fake cover + title on it, focusable
  (ids `game-<i>`).
- Selecting (focusing) a rail entry switches the grid AND retints the room:
  a large soft accent wash behind the main area (reuse the FocusGlow idea or
  a simple transitioned radial — subtle, cozy-dusk rules apply).
- Accept on a game card: `sound.play('launch')` → `await playLaunch(cardEl,
  platform.accent)` → `launchApp('games', gameTitle)` (store signature).
- Enter animation: drill-in (slide + fade from the wall, `tuning.drillInMs`/
  `drillInEase`); B/back is handled by App (closeView) — no back handling here.
- Chrome: slim header ("Games" + selected console name, accent-tinted) tagged
  `data-collapse="y"`, so launches collapse it; a bottom hint line (Ⓐ Play
  Ⓑ Back) reusing the hint pill look.

### `src/controllers/ControllersOverlay.tsx` + support — [WORKER: controllers]

Wii-Home-style glass overlay (DESIGN.md §12), summonable over ANYTHING
(wall, games room, running app) — rendered by App while `controllersOpen`.

- A dimmed (NOT fully opaque — what's beneath must stay visible) backdrop +
  a centered glass panel. Enter animation like the shelf
  (`tuning.shelfOpenMs`/`shelfEase`).
- Content: title row ("Controllers"), then pad cards side by side:
  - P1 card (fake): "Xbox Wireless Controller", battery 72% with a battery
    glyph, connection dot, player badge "P1" in accent.
  - An empty P2 slot: dashed glass card, softly pulsing "Press any button on
    a new controller…".
- P1 card actions (focusable, `scope: 'controllers'`): **Remap buttons** →
  `sound.play('accept')` + `openRemap('snes')`; **Reorder** and
  **Disconnect** → inert pulse (popEase), like the shelf's placeholder chips.
  First focusable gets `autoFocus`.
- Bottom hint line: Ⓐ Select Ⓑ Close.
- No back handling (App closes on B/X).

### `src/remap/RemapRoom.tsx` + support — [WORKER: remap]

Fullscreen mapping room over a dimmed backdrop (rendered while
`remapPlatform` is set). Props: `{ platformId: string }`.

- **Side-by-side diagrams**: left = physical Xbox pad, right = the emulated
  console's original controller (`platformId` → layout; implement at least
  snes, nes, genesis, n64, ps1, gb; unknown ids fall back to a generic pad).
  Draw BOTH as clean inline SVG line diagrams — rounded body outline, button
  circles/pills with labels, `stroke: currentColor`-style theming with
  accent highlights. No image assets. This screen must look crafted; it's a
  marquee feature.
- A platform chip row at top (focusable) switches the emulated side between
  a few platforms (calls `openRemap(<id>)` — App re-renders with new prop).
- **Mapping model**: keep a per-platform default map (emulated button →
  xbox button id) in `src/remap/pads.ts`; state in component (persistence
  comes later with the daemon).
- **Focus travels the emulated pad's buttons** (each button is focusable,
  `scope: 'remap'`; first gets autoFocus). The focused emulated button AND
  its currently-mapped physical button both highlight in accent, with the
  mapping shown as a label ("Y ← X" style) near the pair — you can *see*
  which button is which at all times.
- **Rebind flow**: accept on an emulated button → `setRemapListening(true)`,
  the pair pulses "press a button…" → capture the next physical press with
  your OWN one-shot `window.addEventListener('keydown', …, {capture:true})`
  + a gamepad rAF poll — App ignores semantic input while listening. Demo
  keyboard→Xbox table: Enter=A, Backspace=B, KeyX=X, KeyY/KeyC=Y, arrows=
  D-pad, KeyQ=LB, KeyE=RB, Tab=View, Escape = cancel listening (no change).
  On capture: update map, `setRemapListening(false)`, `sound.play('accept')`
  (or 'edge' on cancel).
- Bottom hint: Ⓐ Rebind Ⓑ Done. No back handling (App closes).

## Round 2.1 — Games room restructure (DESIGN.md §11 revised)

The sidebar-rail layout is replaced by two levels inside `GamesRoom`:

1. **Console picker** — a single scrolling row of console tiles, reusing the
   Home wall's interaction language (fixed-width tiles, crisp ring, edge
   scrolling via scroll-padding, focused tile pushes neighbors apart).
   Tiles show the console's hardware illustration (see ConsoleArt below) on
   its accent, name label revealed on focus, subtle maker grouping.
2. **"Wii U mode" grid** — accept on a console → full-width dense box-art
   grid (≈5 columns, vertical scroll), room lit in the console's accent.

Store: `gamesLevel: 'consoles' | 'grid'` + `setGamesLevel()` (already in
core/store.ts). Accept on console: `setGamesLevel('grid')`. App owns ALL
back handling (grid → consoles → wall) — never handle back in the room.

### `src/games/consoleArt.tsx` — [WORKER: console-art]

```ts
export function ConsoleArt(props: { id: string; className?: string }): JSX.Element
```

Inline-SVG illustration of the actual hardware for each platform id:
`nes, snes, n64, gamecube, wii, gb, genesis, saturn, dreamcast, ps1, ps2,
psp, pc` + a generic fallback. `viewBox="0 0 240 160"`, no width/height
attributes (CSS sizes it). Recognizable silhouettes of the machines
(include the iconic controller where it strengthens recognition — NES pad,
N64 trident, Wii remote…). Theme with CSS custom properties:
body/plastic = `var(--console-body, #d9d5cf)` and dark variant
`var(--console-dark, #2a2733)`, accent details = `var(--accent)`,
shadows/lines = translucent black. Keep each machine ~30-60 elements,
rounded corners, consistent stroke weight — a matched set, like one
illustrator drew them all.

## Round 3 — Phone GamePad slice (DESIGN.md §5, ARCHITECTURE.md topology)

One Rust daemon (`../consoled`), two WS clients: the TV shell (role `tv`)
and the phone PWA (role `phone`). Dev topology: Vite serves both UIs on the
LAN (port 5620); consoled listens on **0.0.0.0:43919**.

### Wire protocol (JSON text frames; keep it this simple)

Client → server:
- `{ "t": "auth", "role": "tv" | "phone", "token"?: string }` — must be the
  first frame. Role `tv` is only accepted from loopback and needs no token
  (the shell runs on the console box). Role `phone` requires a token from
  pairing.
- `{ "t": "sub", "chan": string, "after"?: number }` — subscribe; server
  replays ring events with seq > after, then `synced`.
- `{ "t": "send", "chan": string, "payload": object }` — publish.
- `{ "t": "ping" }`

Server → client:
- `{ "t": "authOk" }` / `{ "t": "authErr", "reason": string }`
- `{ "t": "event", "chan": string, "seq": number, "payload": object,
  "replay"?: true }`
- `{ "t": "synced", "chan": string, "seq": number }`
- `{ "t": "pong" }`

Channels: `state` (ring-buffered, cap 64 — TV publishes UI snapshots),
`input` (live only — phone publishes semantic ConsoleInput events),
`text` (live only — phone publishes `{ "text": string, "commit": boolean }`).

State snapshot payload (TV → phone): `{ mode, view, gamesLevel, focusedId,
runningChannel, runningTitle, shelfOpen, channels: [{id,title,accent,glyph}] }`.

HTTP: `GET /health` → `{"ok":true}`; `POST /pair` body `{"pin":"123456"}` →
`{"token":"cph_…"}` or 403 (5 attempts max per boot, then 429);
`GET /pair-info` (loopback only) → `{"pin":"123456","port":43919}`.

### `../consoled/` — Rust daemon — [WORKER: daemon]

Cargo bin crate. LIFT code from `C:\Users\david\projects\o3code\src-tauri\src\remote\`
(these files are Tauri-free by design): `auth.rs` (role-prefixed tokens,
constant-time verify, PairingBook one-time codes — adapt roles to `tv`/
`phone`, token prefix `cph_`), `ring.rs` + `hub.rs` (seq + replay — use for
`state`), and the *shape* of `server.rs`'s axum wiring (auth phase, per-conn
subscribe set, keepalive) WITHOUT its Ozone specifics. Simplify the envelope
to the JSON protocol above (don't lift envelope.rs wholesale). deps: tokio,
axum (ws feature), serde/serde_json, rand, subtle, tracing. Six-digit PIN
minted at boot AND printed to stdout; phone tokens survive until process
exit (in-memory). Unit-test auth + ring basics. `cargo build` and
`cargo test` must pass.

### `shell/src/link/transport.ts` — [WORKER: transport]

Port the RECONNECTION BEHAVIOR of `C:\Users\david\projects\o3code\src\transport-ws.ts`
onto our tiny protocol (do not copy its command/invoke machinery):

```ts
export interface LinkEvent { chan: string; seq: number; payload: unknown; replay?: boolean }
export function createLink(opts: {
  url: string;                      // ws://host:43919/ws
  role: 'tv' | 'phone';
  token?: string;
  onStatus?: (s: 'connecting' | 'open' | 'closed' | 'authFailed') => void;
}): {
  subscribe(chan: string, handler: (e: LinkEvent) => void): () => void; // remembers floor, resubs on reconnect
  send(chan: string, payload: object): void;                            // drops silently while closed
  close(): void;
}
```

Must have: exponential backoff 500ms→30s; app-level ping every 15s;
`visibilitychange` → immediate redial (iOS freeze); per-chan floor tracking
so reconnect subs use `after`; `authErr` → status 'authFailed' and STOP
retrying (bad token ≠ flaky network). No dependencies. Framework-free
(no React imports) — both surfaces use it.

### `shell/src/phone/` — [WORKER: phone]

`PhoneApp.tsx` + support + CSS. Rendered instead of the console App when
the URL path is `/phone` (integrator wires main.tsx). Touch-first, portrait,
cozy-dusk + glass language, `--ui-scale` respected but sized for a hand.

1. **Pairing screen**: big friendly PIN input (host = window.location.hostname,
   port 43919 fixed). POST /pair → store token in
   localStorage['console-phone-pairing'] and reconnect automatically on
   later visits. "Forget this console" escape hatch. Errors read like a
   console, not a web form ("That code didn't match — check the TV").
2. **GamePad screen** (paired): top half = mirror of the channel row built
   from the latest `state` snapshot (tap a tile → send `input` nav/accept
   events to move TV focus there — derive the lefts/rights from the
   channels array order vs focusedId; tap focused tile again → accept).
   Bottom half = touch pad cluster: D-pad, A/B/X buttons, Home button —
   each press sends the matching ConsoleInput payload on `input`. Plus a
   text field: typing sends `{text, commit:false}` per keystroke and
   `{text, commit:true}` on enter (channel `text`).
3. Reconnect banner driven by link status (debounced ~1.5s so blips don't
   flash, per o3code's connection-notice lesson).

Use `createLink` from '../link/transport' (contract above; may not exist
yet — code against it). Read-only: src/core/types.ts (ConsoleInput shapes).

### Integrator (not a worker)

main.tsx route fork; TV-side link (role tv): publish state snapshots on
store change, apply received `input` events through the same handler as
local input, toast incoming `text` on screen; vite `server.host = true`;
pairing PIN surfaced on the TV (Controllers overlay footer, via /pair-info).

## Round 3.5 — Settings room

### `shell/src/settings/` — [WORKER: settings]

In-shell room (`view === 'settings'`, scope `'settings'`, App owns back).
Same room language as the Games room: NOT a sidebar — a single horizontal
row of big setting tiles (Home-wall interaction language, slate-teal accent),
each opening a full screen inside the room:

- **Storage** (build fully): a *console-quality* storage screen. Fake-but-
  plausible data for now (C: 223 GB SSD — System; D: 1.8 TB HDD — Games,
  Movies & TV, Music, Other; a "scan" note). Per-drive horizontal segment
  bars, category colors from channel accents, big friendly numbers
  (`x of y GB free`), focusable drive cards where focus highlights the
  card's segments with a legend. Data shape goes in `storageData.ts` so the
  daemon can feed real numbers later.
- **Phone** (build fully): pairing status + how-to. Fetch
  `http://127.0.0.1:43919/pair-info` (daemon may not be running — show a
  calm "Console service offline" state, retry every 5 s). When available,
  show the six-digit PIN huge, plus the phone URL
  `http://<window.location.hostname>:5620/phone` and a QR code of that URL
  drawn as an inline SVG **without dependencies** (a tiny QR encoder is
  ~150 lines for byte-mode QR v4/L, or use a text fallback if that proves
  unreasonable — do NOT add npm packages).
- **Controllers / Network / System**: tiles present; Controllers opens the
  existing overlay (`openControllers()`); the other two render a friendly
  "coming soon" screen.

Boundaries: only `src/settings/`. Read-only context: DESIGN.md §1/§11/§12,
src/home/Tile.css (ring language), src/core/store.ts, src/styles/glass.css.
No back handling; typecheck clean apart from other workers' missing modules.

## Round 4 — Real library import (gamelist.xml)

The media PC (`ssh david@192.168.1.158`, see ARCHITECTURE.md for the
base64-EncodedCommand technique) holds a fully scraped RetroBat library:
`S:\RetroBat\roms\<system>\gamelist.xml` + `images\` + `videos\`.

### `tools/import-gamelists.mjs` — [WORKER: importer]

Node ESM script, **no npm dependencies** (hand-roll the XML parsing — the
gamelist schema is flat and regex/simple-parser friendly; do NOT add a
package). Run from the repo root on THIS desktop; it shells out to
`ssh david@192.168.1.158` to read remote files.

- Pull each `gamelist.xml`, parse every `<game>`: name, desc, image,
  thumbnail, marquee, video, rating, releasedate, developer, publisher,
  genre, players, region, favorite, playcount, lastplayed, gametime, path.
- Emit `shell/src/core/library.generated.json`:
  `{ generatedAt, systems: [{ id, gameCount, games: [...] }] }` — cap at
  **60 games per system** (highest playcount first, then favorites, then
  alphabetical) so the file stays a sane size for the prototype; record the
  true `gameCount`.
- Copy the *thumbnail* (fallback: image) for each included game to
  `shell/public/art/<system>/<slug>.png` via `scp`, batched; skip files that
  already exist so re-runs are cheap. Store the public path in the JSON.
- Idempotent, resumable, and chatty about progress. Handle systems with no
  gamelist gracefully.

### `shell/src/core/library.ts` — [same worker]

Typed accessor over the generated JSON: `LibraryGame`, `LibrarySystem`,
`getSystem(id)`, `getGames(id)`, `allSystems()`, plus a `hasLibrary` flag so
UI can fall back to the fake `platforms.ts` data when the JSON is absent.
Map RetroBat system ids → our platform ids where they differ (e.g.
`megadrive`→`genesis`, `psx`→`ps1`, `gb`/`gbc`→`gb`); keep the mapping in
one exported table, and PRESERVE systems we don't yet model (they become
new platforms rather than being dropped).

Boundaries: `tools/` and `shell/src/core/library.ts` +
`library.generated.json` + `shell/public/art/` only. Don't touch
`platforms.ts`, the Games room, or anything else — the integrator wires the
Games room to the real library afterward.

## Round 5 — Ambient channels (DESIGN.md §14)

Three in-shell rooms, one per worker. Shared rules for all three:

- Rendered by App when `view === '<id>'`; **focus scope is the view id**
  (`'weather'`, `'news'`, `'situation'`). App owns back — never handle it.
- Read DESIGN.md §14 first. These are *places you visit for fun*, not
  dashboards: big type readable from a couch, slow generous motion, one idea
  per screen, cozy-dusk palette, glass for floating chrome. No dense widget
  grids. Assume a 1920×1080 TV at 3 m.
- Data: **keyless providers only**, fetched client-side. Handle offline/
  error states as calm console copy ("Can't reach the weather right now"),
  never a raw error. Cache the last good payload in localStorage so the
  channel opens instantly and shows something even when offline.
- Motion/timings from `src/motion/tuning.ts`; entrance = drill-in like the
  other rooms. `prefers-reduced-motion` respected.
- Bottom hint pill matching the other rooms' style.
- No npm dependencies. Type-clean. Only touch your own directory.

### `src/weather/` — [WORKER: weather]
**Open-Meteo** (`api.open-meteo.com/v1/forecast`, no key). Geolocate via
`navigator.geolocation` with a graceful fallback to a default city; let the
user cycle a few saved cities with left/right (hard-code a small list plus
the detected one). Show: current temp huge, condition, feels-like, wind;
then a 5–7 day strip of focusable day cards (focus reveals hi/lo, precip
chance, sunrise/sunset). Draw weather symbols as **inline SVG** you author —
sun, cloud, rain, snow, storm, fog — gently animated (drifting cloud,
falling drops), never emoji. Sky gradient behind the content shifts with
conditions and time of day while staying inside the cozy-dusk family.

### `src/news/` — [WORKER: news]
RSS via `https://api.rss2json.com/v1/api.json?rss_url=…` (keyless) with a
direct-fetch fallback; ~4 feeds (world/tech/science/gaming) hard-coded in
`feeds.ts`, easy to edit. Left/right switches feed, up/down moves through
headlines. One story at a time, magazine-style: headline huge, source +
relative time, summary at readable size, thumbnail when the feed has one.
Auto-advance every ~12 s when idle (pause the moment the user navigates,
resume after ~30 s idle) with a slow progress hairline. Strip HTML from
summaries. This should feel like a channel that's *on*, not a reader.

### `src/situation/` — [WORKER: situation]
A console port of `C:\Users\david\projects\situationMonitor`. **Read that
project first** and port its concept and visual heart into our shell:
gamepad-navigable, TV-legible, cozy-dusk. Keep whatever keyless data
sources it uses; drop anything needing a server, a key, or mouse-only
interaction, and say so in your summary. If it needs a data source we can't
reach client-side, mock the data with an obvious `TODO(daemon)` note and
build the *screen* — the shape matters more than live data right now.

## Round 6 — Weather channel v2 (cities, radar, cameras)

Extends `src/weather/` (which already does Open-Meteo current + forecast).
Same shared rules as Round 5. Focus scope stays `'weather'`; App owns back.

1. **City management.** Saved cities in `localStorage['console-weather-cities']`
   (seeded with the geolocated city on first run). A city row/rail lets you
   move between saved cities; an "Add city" entry opens a search that queries
   **Open-Meteo's geocoding API** (`geocoding-api.open-meteo.com/v1/search`,
   keyless) — typed with the on-screen keyboard pattern or, simply, a
   focusable A–Z picker; keep entry gamepad-usable, no assumption of a real
   keyboard. Support removing a city. Persist across reloads.
2. **Per-city menu.** Selecting a city opens its own screen: current
   conditions, hourly strip, multi-day, sun times — and the radar/camera
   tabs below. Keep the existing visual language.
3. **Radar.** Use **RainViewer's public API** (`api.rainviewer.com/public/weather-maps.json`,
   keyless) — it returns timestamped tile paths. Render tiles over a simple
   basemap in a `<canvas>` or stacked `<img>` tiles computed from the city's
   lat/lng at a sensible zoom (z≈5–7), and animate the last ~6 frames as a
   loop with a play/pause. **Do not add a map library** — compute the
   slippy-tile x/y/z from lat/lng yourself (standard Web Mercator formula).
   Basemap tiles: use RainViewer's own or OpenStreetMap tiles; if OSM tile
   usage looks unwise, render the radar over a plain accent-tinted backdrop
   with a coastline hint instead of a real basemap and note it.
4. **Cameras.** Investigate feasibility ONLY with keyless public sources
   (e.g. state DOT traffic-camera JPEG endpoints, which are usually plain
   image URLs that refresh). If you find a reliable keyless source, add a
   camera tab that cycles a few relevant cameras with a refresh interval.
   **If it proves unreliable or requires keys, do not fake it** — leave the
   tab out and report exactly what you found. Never embed a service's
   private/undocumented endpoint that requires auth.

Keep everything cached in localStorage so the channel opens instantly
offline. Report honestly which of radar/cameras actually work end-to-end.

## Round 7 — Game detail page, sorting, favorites, pinning

Design: DESIGN.md §11b (detail page), §11c (sorting/favorites), §11d (pinning).

Integrator has added to `core/store.ts`: `gamesLevel` now includes `'detail'`,
plus `selectedGameKey`, `openGameDetail(key)`, and `closeGameDetail()`. App
routes back: detail → grid → consoles → wall. A new `core/userLibrary.ts`
(integrator-owned, read it) persists favorites, pins and per-console sort in
localStorage and exposes a `useUserLibrary()` hook.

### `src/games/GameDetail.tsx` + CSS — [WORKER: detail]

Full-screen page inside the Games room for the selected `LibraryGame`
(`shelfFor(consoleId)` gives you the entry; `core/library.ts` has the type).

- **Hero**: if `game.video` exists, the importer copies it to
  `/game-video/<system>/<slug>.mp4` — play it muted, looped, autoplay,
  `playsInline`, with the box art as poster and as fallback when absent.
- **Facts row**: developer · publisher · year (from `releasedate`, format it)
  · genre · players · rating (as ★ out of 5). Then *your* history: last
  played (relative), total playtime (`gametime` seconds → "12h 04m"),
  times played. Omit anything empty rather than printing "—" everywhere.
- **Description**: `game.desc`, clamped to a readable block, scrollable if long.
- **Actions** (focusable, scope `'games'`, Play autoFocus): **Play** →
  existing launch flow (`playLaunch` on the hero element, then
  `launchApp('games', title)`); **Favorite** → `toggleFavorite(key)`;
  **Controls** → `openRemap(consoleId)` (the remap room already exists);
  **Pin to Home** → `togglePin(...)`.
- Cozy-dusk + glass language, console accent, drill-in entrance. No back
  handling — App owns it.

### Shelf changes in `src/games/` — [same worker]

- Accept on a box now calls `openGameDetail(entry.key)` instead of launching.
- **Sort control** in the games header: cycles Recently played · Most played
  · Favorites · A–Z · Year (persist per console via `userLibrary`), with a
  visible chip showing the current mode. Bind to the **Y button** as well —
  the input layer emits `{type:'sort'}` for Y (integrator adds it).
- **★ badge** on favorited box art (BoxArt gains an optional `favorite` prop).
- Keep everything else about the shelf intact.

Boundaries: only `src/games/`. No npm deps. Type-clean.

## Definition of done (each worker)

- `npx tsc --noEmit` clean for your files (run it; ignore errors from other
  workers' missing modules if they haven't landed — but YOUR files must not
  be the cause).
- No console errors from your module at runtime.
- Code commented like a good open-source codebase: explain the non-obvious
  (algorithms, iOS/browser quirks), not the obvious.
