# Console Design Direction

Design language for the custom console shell (TV + phone GamePad). Decisions marked
**LOCKED** were made explicitly; everything else is the current working proposal and
open to revision.

Working codename: none yet (open question — see bottom).

---

## 1. Visual mood — "Cozy Dusk" **LOCKED**

The console feels like a warm lamp-lit living room at night, not an office monitor.

- **Base**: deep warm charcoal with a very subtle navy→plum vertical gradient
  (roughly `#17151F` → `#1E1B26`). Never pure black — pure black reads as "off"
  and crushes on OLED transitions.
- **Light behavior**: the focused tile casts a soft colored glow onto the
  background in its channel color. Focus = light. Moving focus feels like
  carrying a lantern across the grid.
- **Text**: warm off-white (`#F2EEE8`), never pure white. Rounded geometric sans
  (Nunito / Quicksand family territory), large sizes — this is a 10-foot UI.
- **Accents**: one signature color per channel (see §8). Saturated but not neon;
  they should glow against the dusk base, not vibrate.
- **Texture**: faint film grain / dither over gradients to prevent TV banding;
  gentle vignette at screen edges.
- Playfulness comes from **motion, sound, and glow** — not from brightness or
  clutter.

## 2. Home navigation — Single scrolling channel row **LOCKED**
*(revised 2026-07-30: was a 4×2 Wii-style grid; changed because the channel
count will rarely match a tidy page)*

One horizontal row of big channel tiles, Switch-style, vertically centered.

- **Fixed tile size, unbounded row**: tiles never shrink to fit; the row
  simply extends past the screen edge (a partially visible tile at the edge
  is the scroll affordance, like the Switch).
- **Edge scrolling, not paging**: focus roams the middle of the screen
  without moving the row; when it pushes into the side margins the row
  glides to follow. Left/right is the only navigation axis on Home.
- **Trailing sockets**: a few faint dashed "coming soon" sockets after the
  last channel keep the invitation feeling; they are not focusable.
- **Live tiles**: tiles may render motion — the Games tile slowly cycles
  recently-played artwork, YouTube cycles thumbnails. Idle tiles animate
  subtly; the focused tile animates fully.
- **Focus behavior**: focused tile scales up ~8%, glows in its channel color,
  and its label brightens. One soft tick sound per focus move.
- ~~Context strip under the row~~ *(removed 2026-07-30: read as explainer
  clutter; context now belongs on the phone or inside the channel)*.
- **Chrome**: top bar = clock, network, controller/phone status, small avatar
  chip (see §9). Bottom bar = contextual button hints. Both fade to near-
  invisible after a few idle seconds.

## 3. Tiles & launch transitions
*(revised 2026-07-30: squarer + crisper, deliberately closer to Switch 2)*

- **Shape**: square tiles with generous rounded corners, tight gutters
  between them.
- **Tile face**: full-bleed art or a large channel glyph that owns the face
  (no floating-in-margin icons) on a channel-color gradient. Label sits
  *below* the tile and appears only on the focused tile.
- **Focus cursor**: a crisp accent ring hugging the focused tile, breathing
  slowly (brightness, never size) — an object, not a light leak. The
  background lantern glow survives but far subtler, as ambience only.
- **Glass material**: floating chrome (Home shelf, hint pill, context strip)
  uses the liquid-glass recipe lifted from vAMP's Glass theme — frosted
  white-gradient film, heavy backdrop blur + saturation, hairline border,
  inset top-light (`shell/src/styles/glass.css`).
- **Launching an app** (game/emulator/external): the tile zooms toward the
  viewer while the rest of the grid recedes and dims; the tile face becomes
  the splash background; crossfade into the app. ~600–800ms, paired with the
  signature launch sound. **Returning Home reverses the exact motion** — the
  app shrinks back into its tile at its grid position, focus restored. This
  round-trip is the core "console illusion" moment.
- **Opening an in-shell channel** (library screens, settings): the tile
  expands to fill the screen and the channel screen inherits its accent color;
  the channel glyph stays anchored top-left so you always know where you are.

## 4. Home overlay (over running apps)

- Home button over any app: app video freezes/dims under a blur, audio ducks,
  and a **compact shelf** slides up from the bottom third. Not a full Home
  menu — a card.
- Shelf contents: current-app card (Resume · Quit to Home) in the center,
  flanked by quick actions: Volume, Controllers, Phone status, Sleep.
- Identical layout, sound, and timing everywhere — over games, movies,
  YouTube, everything. This is the single strongest cohesion lever we have.
- B / Home again = resume, with a short "un-duck" audio swell.

## 5. Phone GamePad

### Idle on Home — Mirror + touch remote **LOCKED**
- Phone shows the same channel grid, touch-native: tap to focus (TV follows),
  tap the focused tile to launch. Swipe between pages. TV is authoritative;
  both screens stay in sync both directions.
- The mirror is the *foundation*; contextual screens are overlays on top of it.

### Division of labor
Rule of thumb: **the TV shows the thing; the phone shows things about the
thing.**
- TV: big art, current selection, playback. Minimal text.
- Phone: everything dense or interactive — search, keyboard, long
  descriptions, queues, chapter lists, subtitle pickers, settings forms.
- Text entry always goes to the phone when paired (TV shows the text
  appearing live); TV keeps a fallback on-screen keyboard for unpaired use.

### Contextual modes (auto-switch by TV state)
- YouTube browsing → search + keyboard + recommendations
- Video playback → scrubber, queue, chapters, subtitles
- Game focused → details, launch options, save states
- In-game → configurable touch pad / quick remote

## 6. Motion personality

- **Physics**: everything is soft-spring eased; nothing linear, nothing
  instant-teleport. Focus moves ~200ms, page glides ~350ms, launches
  ~600–800ms.
- **Character**: calm and plush, not zippy. The Switch is a sports car; this
  is a well-oiled wooden toy. Responsiveness comes from input latency (react
  on button-down immediately), not from animation speed.
- Glow and parallax follow focus with slight lag, like light catching up.

## 7. Sound personality

- **Palette**: warm mallets (marimba/kalimba territory) + soft woody ticks.
  Navigation = tick; page turn = low tock; launch = rising warm whoosh + chime;
  return home = the same chime inverted; phone pairing = a two-note handshake
  (TV plays note 1, phone plays note 2 — the pair "answers" the console).
- **Ambient Home music**: quiet loopable evening instrumental bed. Each
  channel, when focused, may add one instrument layer on top of the bed
  (Wii-Shop-style delight without copying it). Ducks under any preview audio.
- Wire the sound engine in Phase 1 with placeholder synth sounds — sound is
  half the personality and can't be bolted on later.

## 8. Shared visual language across content types

- **One card system**: game, movie, episode, and video are all the same card —
  artwork, title, channel-colored badge, progress bar, one primary action.
  The channel color on the badge/progress bar is the only thing that changes.
- **One detail-screen skeleton**: hero art + primary actions on TV; long text,
  metadata, and secondary actions on the phone.
- Channel accent colors (working set):
  - Continue — warm gold
  - Games — coral
  - Movies & TV — amber
  - YouTube — its own red (unavoidable and fine)
  - Settings — slate teal

## 9. Profiles — invisible until needed **LOCKED**

- Console boots straight to Home as the last-used profile. No "who's playing"
  gate.
- Small avatar chip in the top bar; selecting it opens a switch overlay.
- Phone pairing binds to a profile.
- **Schema note**: every piece of user state (progress, recents, pairings,
  preferences) carries a `user_id` from day one, even while the UI barely
  shows profiles. Retrofitting this later is the expensive path.

## 10. First page of channels (v1)

| Slot | Channel | Notes |
|---|---|---|
| 1 | **Continue** | Dynamic tile: always the last game/video, one press to resume. Shows a friendly "nothing yet" face when empty. |
| 2 | **Games** | ROMs/emulators + native, one library. |
| 3 | **Movies & TV** | Local media. |
| 4 | **YouTube** | |
| 5 | **Settings** | System, network, controllers, pairing. Pairing is also reachable from the top-bar phone icon. |

Slots 6–8 stay empty in v1 — empty slots render as faint dashed "coming soon"
sockets (Wii-style), which reads as *invitation*, not absence.

## 11. Games channel — the Console Room
*(revised 2026-07-30: two levels — console row → Wii U grid; was a sidebar
rail, which read as a settings screen rather than a place)*

Opening Games drills into a room organized **by console**, in two levels:

- **Level 1 — console picker**: a **grid, one maker per row** — Nintendo on
  top, then PlayStation, Sega, Xbox, and **PC last**. Each row scrolls
  horizontally on its own; up/down moves between makers, left/right along a
  maker's machines. A quiet maker label sits at the head of each row.
  **A maker only earns a row once it has 3+ machines**, except the four
  majors (Nintendo, PlayStation, Sega, Xbox) which always keep their own row
  however few machines they hold. Atari, NEC, SNK, Coleco and friends share
  a single "Other" row rather than each getting a near-empty shelf.
  Tiles use **real console hardware images** harvested from RetroBat's theme
  art, falling back to our hand-drawn SVGs for anything unmatched.
  **PC is a row, not a single tile** — Steam is one library among others
  (GOG, Epic, standalone installs), so it gets the same shelf treatment as
  any console.
- **Level 2 — "Wii U mode"**: accepting a console fills the screen with a
  big dense grid of box art — Wii U home menu energy, 5-ish columns,
  vertical scroll. The room's lighting takes the console's accent.
- B walks back up one level at a time: grid → console row → channel wall.
- Later: per-console "insert cartridge" launch sounds, real box art from
  RetroArch's Named_Boxarts thumbnails (already on disk — see
  ARCHITECTURE.md library sources).

## 11b. Game detail page

Selecting a game does **not** launch it — it opens the game's page, the way a
console does. This is where the scraped metadata finally pays off.

- **Hero**: the scraped preview **video** plays muted on a loop behind/beside
  the box art (RetroBat has one per game); falls back to the cover if absent.
- **Facts**: developer, publisher, year, genre, players, rating — and *your*
  history from the gamelist: last played, total playtime, playcount.
- **Description**: the scraped `desc`, at readable size.
- **Actions**: **Play** (primary), **Favorite** (toggle, ★), **Controls**
  (opens the remap room scoped to this console), and later Save states.
- B returns to the shelf; the shelf remembers where you were.

### Mods & hacks — launched from the game they modify

A romhack belongs *with* its game, not scattered alphabetically across the
shelf. Super Mario 64 and its mods are one thing you sit down to play, so the
detail page carries a **Mods** row under the actions: each mod a small card,
each one launchable, inheriting the base game's art when it has none of its own
(hacks almost never do).

**Detection is by metadata absence, not title shape.** A scraped release carries
`desc`/`publisher`/`releasedate`/art from ScreenScraper; a romhack is in no
database, so it arrives bare. That asymmetry is the signal. The obvious
alternative — matching title prefixes — was measured against the real library
and is actively wrong: it reads *Mega Man 2* as a mod of *Mega Man*, *Sonic The
Hedgehog 2* as a mod of *Sonic*, and *Super Mario Bros. 3* as a mod of *Super
Mario Bros.* Sequels are not mods.

So a shelf entry is a mod when it is **unscraped** *and* an existing **scraped**
entry's title appears inside it at a word boundary. Measured on the real
library: **131 mods across 12 systems, no sequel false-positives.** The other
437 unscraped entries matched nothing and stay on the shelf as themselves —
they are standalone homebrew (*Among Us*, *AEW Wrestling*), not mods of
anything.

Guards, each earned from a real mismatch in the data:
- The base title must be substantial — a generic word like "Challenge" or
  "Dungeon" must not adopt everything that contains it.
- PC-like systems (`windows`, `ports`) are excluded; there "X - Shortcut" is a
  launcher artifact, not a mod.
- Playlist and shortcut files (`.m3u`, `.lnk`) are excluded; a multi-disc `.m3u`
  is the *same* game, which is dedupe's job, not this.

Mods fold off the main shelf into their base game's page. A console that lists
*Fire Emblem* five times because someone made five hacks of it is noise; one
*Fire Emblem* with five mods under it is a library.

## 11c. Library sorting & favorites

The shelf needs to be steerable once a system has hundreds of games:

- **Sort** (Y cycles, or a chip in the header): Recently played · Most played
  · Favorites first · A–Z · Year. Default is the importer's ranking (played,
  then favorites, then alphabetical).
- **Favorites** are read from the gamelist's `favorite` flag and toggled
  locally; a ★ badge sits on the corner of favorited box art.
- **Filter**: a Favorites-only toggle.
- Sort/filter choices persist per console.

## 11d. Pinning to Home

Any game (or channel screen) can be **pinned to the channel wall** so it sits
next to Games/Movies/YouTube — the console equivalent of "add to home
screen". Pinned games appear as tiles using their box art, launch directly,
and can be reordered or unpinned. This is what makes the wall *yours* rather
than a fixed menu.

## 12. Controllers overlay — Wii Home spirit

The Wii Home Menu's magic was configuring controllers *without leaving the
game*. Ours is the same: a liquid-glass overlay summonable from anywhere —
X on the Home wall, or the Controllers chip on the shelf — over Home or over
a running app.

- Connected pads as glass cards: player slot (P1–P4), pad name/type, battery,
  connection glyph; a pulsing "press a button on a new controller" slot.
- Per-pad actions: **Remap** (→ §13), reorder player slots, disconnect.
- Closes with B, returning exactly where you were.

## 13. Emulator remapping room

For emulators, mapping must be *visible*, not a list of abstract names:

- **Side by side**: your physical pad (Xbox layout for now) on the left, the
  emulated console's original controller on the right (SNES pad for SNES,
  etc.), drawn as clean diagrams with labeled buttons.
- Focus moves through the emulated console's buttons; selecting one enters a
  "listening" state — press the physical button you want, and the tie
  updates. Both diagrams highlight live so you can *see* which button is
  which.
- Per-console mapping profiles (persisted per user later; in-memory in the
  prototype).
- Reachable from a pad card in §12 and later from a game's launch options.

## 14. Ambient channels — the Wii spirit

The Wii's Weather and News Channels weren't utilities, they were *places you
visited for fun*. That's the bar: a channel you'd open with no task in mind,
sit with for thirty seconds, and feel good about.

Principles for this family:
- **Slow, ambient, generous**: big type, unhurried motion, a globe or map
  you can drift across. No dashboards, no dense widget grids.
- **Instantly readable from the couch** — one idea per screen.
- **A music bed each** (the Wii Weather theme is the reason people remember
  it). Ours: a warm, slow instrumental loop per ambient channel, sharing the
  mallet palette from §7.
- **Keyless data first**: providers that need no API key (Open-Meteo for
  weather, RSS for news) so the console works out of the box; keys optional
  for extras.

Planned members:
- **Weather** — current conditions + multi-day, with a drift-able map view.
- **News** — headlines that turn over slowly, RSS-fed, readable at distance.
- **Situation** — a port of the existing situationMonitor project as a
  console channel (see ARCHITECTURE.md).
- **Live TV** (later) — free live streams: news channels and/or Twitch, in
  the same channel frame so it never feels like a browser.

Each ambient channel is still a normal channel: same tile, same launch
choreography, same Home overlay, same sound language.

---

## Open questions (next planning passes)

1. **Name / branding** — the console needs a name; it drives the boot logo,
   pairing screen, and sound motif.
2. **Continue-tile behavior** when the last item was inside an app we can't
   deep-resume (e.g., a YouTube video) — resume playback vs. reopen channel?
3. **Overlay scope creep** — does the shelf ever need full Home access while
   an app is suspended (Wii U could), or is Quit-to-Home always acceptable?
4. **Phone pairing flow details** — QR vs. PIN default, and what the TV shows
   during pairing.
5. **Sound direction demo** — build a small audio sketch (5–6 sounds + bed)
   before Phase 1 UI work locks timing to placeholder bleeps.
