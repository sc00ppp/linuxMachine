# linuxMachine

A custom living-room console: a controller-first TV shell plus an optional
phone GamePad, for games, emulators, local media and YouTube. The target is a
Linux box that boots straight into this — no desktop, no Steam frontend, no
Kodi skin. Inspired by the Wii U's friendliness, not a copy of it.

- **[DESIGN.md](DESIGN.md)** — the visual and interaction language: the cozy-dusk
  look, the channel wall, launch choreography, the Home overlay, sound, the
  ambient channels.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the daemon/shell/phone topology, what
  is being reused from prior projects, and the media-PC library survey.
- **[shell/CONTRACTS.md](shell/CONTRACTS.md)** — module contracts. The codebase is
  built by parallel agents, each owning one directory; this is the interface
  between them.

## Layout

```
shell/      TV shell + phone GamePad (React 19 + TypeScript + Vite)
  src/core/     shared state, channel catalog, library accessors
  src/home/     the channel wall
  src/games/    Console Room (console row → Wii U-style grid)
  src/movies/   Movies & TV
  src/weather/  Weather channel (Open-Meteo, RainViewer radar)
  src/news/     News channel (RSS)
  src/situation/ Situation channel (live globe: quakes, storms, ISS)
  src/settings/ Settings rooms (storage, phone pairing)
  src/phone/    the phone GamePad surface, served at /phone
  src/link/     WebSocket transport shared by TV and phone
consoled/   Rust daemon: pairing, WebSocket hub, event replay
tools/      importers that build the library from a media PC over SSH
```

## Running it

```bash
cd shell && npm install && npm run dev
```

Opens on `http://localhost:5620` (LAN-visible, so a phone can reach `/phone`).
Arrows/WASD navigate, Enter opens, Esc backs out, `H` is the Home button and
`X` opens the Controllers overlay. A standard gamepad works too.

The daemon (needed for phone pairing) runs separately:

```bash
cd consoled && cargo run
```

## Library data

The game and media libraries are **not in this repo** and never will be —
they're personal data generated from a local media PC. `tools/` holds the
importers that produce them; run those against your own machine and the shell
picks the results up automatically, falling back to sample data when absent.
