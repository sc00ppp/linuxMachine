# Console Architecture & Reuse Plan

Companion to [DESIGN.md](DESIGN.md). This records the technical stack direction and
what we're lifting from prior projects (`../vAMP`, `../o3code`).

## Stack decision: React, on the o3code skeleton

**React 19 + TypeScript + Vite for both surfaces; Rust for the console daemon.**

Rationale: o3code (Ozone) already contains a battle-tested, iOS-hardened phone
companion stack — WebSocket transport with replay, QR pairing, PWA serving,
reconnection logic, web push — and it's React. vAMP's animation value is
framework-agnostic (tuned numbers, CSS keyframes, WAAPI patterns, spring math),
so it ports to React cheaply. Reusing the phone stack outweighs porting
animation idioms; React wins.

## Topology: one Rust daemon, two thin clients

The key move (adapted from o3code's design): the **Rust daemon is the console**.
The TV shell and the phone are both WebSocket clients of it, with different
role-scoped tokens.

```
                ┌────────────────────────────────┐
                │        consoled (Rust)         │
                │  axum server on 127.0.0.1      │
                │  ── auth (role tokens)         │
                │  ── event hub + replay ring    │
                │  ── command dispatch           │
                │  ── app supervisor (launch/    │
                │     monitor/kill, focus)       │
                │  ── controller input (evdev)   │
                │  ── library DB (SQLite)        │
                │  ── power/volume/system        │
                └───────┬───────────────┬────────┘
                 ws (role: tv)   ws (role: phone)
                        │               │
              ┌─────────┴───────┐ ┌─────┴──────────┐
              │  TV shell       │ │  Phone PWA     │
              │  React, kiosk   │ │  same React    │
              │  fullscreen     │ │  bundle, phone │
              │  Chromium       │ │  layout        │
              └─────────────────┘ └────────────────┘
```

Benefits:
- TV/phone state sync is free — both consume the same event stream, so the
  mirror-mode phone grid (DESIGN.md §5) is just a second subscriber.
- The daemon survives shell crashes: if Chromium dies, the daemon restarts it
  and replays state — this *is* the "failures return safely to Home" guarantee.
- Same shape o3code proved: its `remote/` crate modules are Tauri-free by
  construction, so they don't care what hosts the TV webview.

**Open decision — TV shell host** (decide before Phase 5, not now):
- *Chromium/Electron kiosk*: best Linux rendering + video codecs + (if ever
  needed) Widevine for web video. Likely winner for a GTX 970 Linux TV box.
- *Tauri v2*: what both donor projects use, but Linux Tauri = WebKitGTK, which
  is a rendering/codec risk on a TV box.
- Phase 1 dev mode runs in a plain browser window against the daemon, so this
  choice can wait.

## Reuse manifest — o3code (`../o3code`)

The phone GamePad (Phase 2) starts ~70% built. What lifts cleanly:

### Rust (daemon foundation) — `src-tauri/src/remote/`
Explicitly Tauri-free; these become the core of `consoled`:
- `auth.rs` — role-prefixed CSPRNG tokens, constant-time verify, one-time
  pairing codes with TTL. Drop-in. Our roles: `tv` / `phone` (theirs:
  frontend/controller).
- `envelope.rs` — versioned wire protocol frames. Rename channels for our
  domain (e.g. `home`, `nowPlaying`, `input`, `system`, `ui`).
- `ring.rs` + `hub.rs` — event hub with monotonic seq + replay ring; the
  reconnect/catch-up machinery. Generic, lift as-is.
- `dispatch.rs` — role-gated command table. Lift the mechanism.
- `server.rs` — don't copy (huge, entangled); *port* route-by-route: `/ws`,
  `/health`, `/media` (byte-range), `/upload`, static PWA serving with its
  carefully tuned cache headers.
- The `EventSink`/fanout pattern from `app_core.rs` — one pump feeds all sinks.

### TypeScript (phone + TV client)
- `src/transport.ts` + `src/transport-ws.ts` — **highest-value lift (~770
  lines)**. Transport interface + WS impl with exponential backoff,
  15s app-level keepalive (defeats iOS/proxy idle-kill), `visibilitychange`
  wake (iOS freezes backoff timers), per-command timeouts, replay/floor/desync
  handling, dev hooks.
- `src/RemoteGate.tsx` — pairing front door: QR pair-link with secret in the
  URL *fragment* (never hits a server), in-page camera QR scan (installed PWAs
  don't share Safari's storage — camera-app scanning breaks), paste fallback,
  saved-pairing in localStorage, forget-pairing, crash overlay that survives
  React dying.
- `public/sw.js` + `manifest.webmanifest` — PWA service worker; deliberately
  network-first/no-cache on the shell to defeat stale-installed-PWA bugs.
  Every comment is a paid-for lesson.
- `src/mobile.ts` — `useMobile()`/`useTablet()` predicates mirrored by CSS
  media queries, `visualViewport` keyboard-height plumbing (composer rides
  above the iOS keyboard), `useLongPress()` with haptics.
- `src/connection-notice.ts`, `src/tap.ts`, `src/touch-glow.ts`, `src/uuid.ts`.

### Bonus subsystems (later phases)
- `src/dictate.ts` + `dictation.rs` — **phone as microphone**: WebAudio PCM
  capture (bypasses iOS AAC-only MediaRecorder), browser-side resample to
  16 kHz, local speech-to-text on the PC. Voice search for YouTube, free.
- `remote/screen.rs` + `ScreenView.tsx` — live JPEG screen streaming to the
  phone. Could power "glance at the TV from the couch/another room".
- `remote/webpush.rs` — web push ("download finished" on your phone).
- `harness/` + `dev-telemetry.ts` — dev harness where the phone POSTs its own
  telemetry to the server and Playwright drives the real PWA. Debugging a
  companion device with no devtools is hard; this is a working answer.

### Security posture (copy wholesale)
Loopback-only bind + fronting layer for TLS (they use `tailscale serve`; on
our LAN-only console we'll need a local-cert story or accept plain ws on the
LAN — decide in Phase 2), role-scoped tokens where the prefix is part of the
secret, auth-attempt caps, allowlisted command surface.

### Caveat
`o3code/docs/remote-control-plan.md` is a good conceptual read but stale in
places; where doc and code disagree, `transport-ws.ts` and `envelope.rs` are
the truth.

## Reuse manifest — vAMP (`../vAMP`)

Svelte 5, so we port *techniques and numbers*, not components:

- `app/src/lib/fullscreen/tuning.svelte.ts` — 54-line pure const of hand-tuned
  durations/beziers, annotated "FLOATY enter + WII U exit". Take the numbers
  verbatim as our motion baseline.
- The **`data-fs-collapse="x|y|fade"` pattern** — declarative attributes on
  chrome elements + one generic WAAPI animator that measures and collapses
  them. This becomes our Home→app launch choreography. Only ~300 of the
  choreographer's 1700 lines matter to us — the other ~1200 compensate for
  native window resizing, which a fullscreen console never does. Port
  `animateChrome()` (choreographer ~line 1045).
- `app/src/lib/utils/drillTransition.ts` — 40-line pin-outgoing + counter-
  slide drill transition; exactly the grid→channel-screen motion. Trivial port.
- `app/src/app.css` lines ~439–545 — framework-agnostic keyframes incl.
  overshoot easing `cubic-bezier(0.34,1.56,0.64,1)`; plus reduced-motion block.
- Spring math from `scrollAwayHeader.svelte.ts` / mobile `elasticOverscroll.ts`
  — critically-damped integrator + asymptotic rubber-band cap.
- Theming architecture (`stores/theme.ts`) — CSS custom properties on
  `documentElement`, instant zero-rebuild theme swap. Matches our channel-
  accent system.
- `stores/uiScale.ts` — global `--ui-scale` with fixed steps; directly our
  10-foot UI scaling + accessibility plan.
- `utils/dominantColor.ts` / `chromaticAccent.ts` — accent extraction from
  artwork; powers dynamic tile glow from game/movie art.
- `utils/keyboard.ts` — `isTypingTarget()` + shortcut handler, incl. a real
  WebView2 alt-key gotcha comment.
- HeroCrossfade *pattern* (two-layer A/B so content never unmounts on change)
  — reimplement small, don't port the 874-line file.

## The media PC — DESKTOP-7O9IS23 (surveyed 2026-07-30 over SSH)

**Access**: `ssh david@192.168.1.158` (OpenSSH Server, key auth from the
desktop; default shell is cmd.exe, so send PowerShell via
`powershell -NoProfile -EncodedCommand <base64 UTF-16LE>` — nested quoting
through PowerShell→ssh→cmd→PowerShell otherwise mangles everything).
Windows 10 Home. Drives: C: 420 GB used / 46 free · E: 292/174 ·
**S: 3.7 TB used / 935 GB free** (the library drive).

### RetroBat — `S:\RetroBat\` (this is the emulation goldmine)

A complete RetroBat (Windows EmulationStation) install, already scraped:

- **`roms\`** — ~48,000 ROMs, ~1.2 TB, across 44 systems. Notables: switch
  198 GB, wii 157 GB, wiiu 112 GB, psp 110 GB, ps2 109 GB, 3ds 82 GB,
  xbox 47 GB, gamecube 42 GB, psx 40 GB, dreamcast 38 GB, nds 26 GB,
  segacd 23 GB, saturn 18 GB — plus complete cartridge-era sets (nes 7600,
  megadrive 7389, snes 4582, gb/gbc/gba ~9700 combined).
- **`roms\<system>\gamelist.xml`** — 43 scraped gamelists (~18 MB total).
  Per game: `name`, full `desc`, `image`, `thumbnail`, `marquee`, **`video`**,
  `rating`, `releasedate`, `developer`, `publisher`, `genre`, `players`,
  `region`, `lang`, plus **play history** (`favorite`, `playcount`,
  `lastplayed`, `gametime`) and hashes (`crc32`, `md5`). Scraped from
  ScreenScraper + TheGamesDB.
- **`roms\<system>\images\` + `videos\`** — **32,163 artwork files (7.3 GB)**
  and preview videos. Real box art for the Games room; no scraping needed.
- **`emulators\`** — 79 emulators already configured (retroarch, dolphin,
  pcsx2, rpcs3, ryujinx, yuzu, cemu, duckstation, ppsspp, xemu, xenia,
  flycast, mame, citra, vita3k, …).
- **`bios\`** — 3,671 BIOS files (1.2 GB). The thing that's always missing.
- Also: `saves\`, `savestates` via emulators, `cheats\`, `decorations\`
  (bezels), `screenshots\`, `sounds\`.

**Implication for Phase 4**: the library provider's first job is not
scraping — it's *importing gamelist.xml*. That single parser yields titles,
descriptions, artwork paths, genres, and even the user's own play history
for ~48k games. Play history feeds the Continue channel for free.

### Scraping: don't steal the binary, call the same API

RetroBat's scraper lives inside `emulationstation.exe` (the Batocera ES C++
binary) — not a script we can lift. But it isn't doing anything exotic: it
calls **ScreenScraper's public API** (`api.screenscraper.fr/api2/`) and
TheGamesDB, then writes the results into `gamelist.xml`. So:

1. **For the existing ~48k games: no scraping needed at all.** The gamelists
   are already populated; we import them (Round 4).
2. **For new games later**: our daemon calls ScreenScraper's API directly
   with David's own account (already registered — credentials sit in
   plaintext in `emulationstation\.emulationstation\es_settings.cfg`, which
   is worth knowing but *not* worth copying into our repo; read them at
   runtime or re-enter them in Settings).
3. **Escape hatch**: run RetroBat's own scraper when convenient and just
   re-run our importer — gamelist.xml is the interchange format either way.

### Storage stock-take (measured 2026-07-30)

Total on S: ≈ 3.7 TB. Where it actually goes:

| Bucket | Size | Verdict |
|---|---|---|
| ROMs — modern discs (switch 198, wii 157, wiiu 112, psp 110, ps2 109, 3ds 82, xbox 47, ps3 44, gamecube 42, psx 40, dreamcast 38, nds 26, xbox360 23, segacd 23, saturn 18) | **~1.1 TB** | The real cost. Curate hard — a played-favorites subset is a fraction of this. |
| ROMs — cartridge era (nes, snes, megadrive, gb/gbc/gba, mastersystem, n64, pcengine, neogeo, atari…) | **~30 GB** | Keep everything. Complete sets are essentially free. |
| Steam libraries (S: + E:) | 954 GB | Stays on whatever machine runs the games; not console-managed. |
| `S:\PC Games` | 502 GB | Same. |
| Kodi Collection (20 TV series) | 497 GB | Keep; this is the Movies & TV channel's content. |
| `S:\ISOs` | 107 GB | Overlaps RetroBat; dedupe candidate. |
| Emulators | 10.5 GB | Keep — 79 preconfigured. |
| **Scraped videos** (.mp4 previews) | **13.5 GB** | **Keep all of them** — disk is explicitly not a constraint (David, 2026-07-31). No per-system cap. |
| **Scraped images** | **7.3 GB** | **Keep — highest value per byte in the whole library.** |
| BIOS | 1.2 GB | Keep. Irreplaceable in practice. |
| Saves | 1.6 GB | Keep. Personal. |

**Read**: metadata + art + BIOS + every cartridge system ≈ **50 GB** — that's
the entire "console feel" for almost nothing. The 1.1 TB is disc-era ROMs,
which is where curation (by playcount/favorites from the gamelists) pays.
The console doesn't need to *hold* the library — it can mount S: over the
network and keep only art + metadata locally.

### Other content on the media PC

- `S:\Kodi\Collection\` — Movies (empty) and **TV Shows (20 series)**;
  Kodi userdata at `%APPDATA%\Kodi\userdata` (library DBs, Thumbnails,
  RssFeeds.xml, favourites.xml — the RSS list is a starting point for the
  News channel).
- `S:\Steam`, `S:\SteamLibrary`, `E:\Steam`, `E:\SteamLibrary`,
  `S:\PC Games` — the "PC is a console" library.
- `S:\ISOs`, `S:\Slippi`, `S:\flex launcher` (an existing TV launcher —
  worth a look for what it got right/wrong), Playnite install on C:.

## Known local library sources (dev machine, scanned 2026-07-30)

For the Phase 4 library scanner — real content already on this PC's D: drive:

- `D:\ISOs\Gamecube\Dolphin Games\` — ~19 GameCube titles (.rvz/.iso),
  incl. Melee-adjacent mods (Project+ 2.11, PMEX Remix) under `Dolphin\`.
- `D:\WII  USB\Games\` — Wii/GC USB-loader layout (`GALE01\game.iso` etc.),
  Beyond Melee, Mario Kart Double Dash.
- `D:\ISOs\RetroArch\` — full RetroArch install: cores, cheats, and
  **Named_Boxarts thumbnails** (real box art for the Games room later).
  `downloads\` has a stray N64 `Flappy Bird.z64`.
- `D:\ISOs\3DS\` (Citra), `D:\ISOs\Switch\`, `D:\ISOs\PKMN Uranium\`,
  `D:\ISOs\sm64coopdx…\` — more platforms for later.
- `D:\SteamLibrary\` — Steam library ("PC is a console").
- `D:\Slippi\`, `D:\Melee Modding\` — the Melee ecosystem.
- `D:\Stuff\Documents (7.27.22)\SNES\Super Famicom\earthbound.sfc\` —
  EarthBound as a **higan gamepak folder** (`program.rom` + `save.ram` +
  higan save states), not a loose .sfc file. The scanner must treat
  `*.sfc` DIRECTORIES as higan-format games.

## Greenfield (in neither project)

1. **Gamepad input + spatial focus navigation** — no gamepad code exists in
   either repo. Daemon-side evdev capture and shell-side focus engine are
   Phase 1 core work.
2. **UI sound engine** — neither project has interface sounds. Build in
   Phase 1 (see DESIGN.md §7).
3. **App supervisor** — launching/monitoring emulators & apps, focus restore,
   crash-to-Home (Phase 3).
4. **Content providers + library DB** (Phase 4).
