/**
 * Fake box art (DESIGN.md §11: "fake art in the prototype: accent gradient +
 * title"). Real cover images arrive with the library DB in Phase 4.
 *
 * A wall of covers that are all the *same* accent gradient reads as a
 * placeholder; a wall where every cover is visibly its own object reads as a
 * shelf. So every game derives a small bundle of art parameters — gradient
 * angle, highlight position, hue drift, brightness, and a decorative motif —
 * deterministically from its own title. Same game, same cover, every render
 * and every session (no persistence needed), yet no two covers in a library
 * look alike.
 *
 * The drift is deliberately narrow (±18° of hue, ±10% brightness): the cover
 * must still read as *this console's* colour, because the whole room is lit
 * in that accent.
 */

/**
 * FNV-1a, 32-bit. Cheap, dependency-free, and well-distributed over short
 * ASCII-ish strings — which matters here because we slice individual bit
 * ranges out of the result and use each range as an independent "random"
 * value. A weaker hash (e.g. summing char codes) would correlate those
 * slices and make similar titles produce near-identical covers.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit integer space.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Number of decorative motifs implemented in BoxArt.css. */
export const MOTIF_COUNT = 4;

export interface CoverArt {
  /** Hue drift away from the console accent, e.g. `-8deg`. */
  hue: string;
  /** Main gradient angle. */
  angle: string;
  /** Highlight ("light hitting the print") position. */
  highlightX: string;
  highlightY: string;
  /** Per-cover brightness/saturation nudge — some prints are richer. */
  lift: string;
  saturation: string;
  /** Angle of the diagonal specular sheen across the laminate. */
  sheen: string;
  /** Which decorative motif this cover wears (0…MOTIF_COUNT-1). */
  motif: number;
  /** Title size that keeps long names inside the plate. */
  titleSize: string;
}

/**
 * Derive one cover's art parameters. Seeded with the platform id as well as
 * the title so the two consoles that share a title (Punch-Out!! ships on NES
 * *and* Wii here) don't get twinned covers sitting one rail entry apart.
 */
export function coverArt(platformId: string, title: string): CoverArt {
  const seed = hash32(`${platformId}::${title}`);
  // Each field reads a different bit range, so they vary independently.
  const pick = (shift: number, count: number) => (seed >>> shift) % count;

  return {
    hue: `${pick(0, 37) - 18}deg`,
    angle: `${118 + pick(5, 5) * 14}deg`,
    highlightX: `${14 + pick(8, 6) * 11}%`,
    highlightY: `${4 + pick(12, 5) * 9}%`,
    lift: `${(0.9 + pick(16, 5) * 0.05).toFixed(2)}`,
    saturation: `${(0.94 + pick(20, 4) * 0.05).toFixed(2)}`,
    sheen: `${98 + pick(24, 5) * 9}deg`,
    motif: pick(28, MOTIF_COUNT),
    titleSize: titleSizeFor(title),
  };
}

/**
 * Cover typography has to survive "FF VII" and "Monster Hunter Freedom
 * Unite" in the same grid. Rather than shrink-to-fit (a layout thrash per
 * card), step the size down by length — the plate wraps to at most three
 * lines at every step. The floor is the 10-foot legibility minimum from
 * CONTRACTS rule 5.
 */
function titleSizeFor(title: string): string {
  const n = title.length;
  if (n <= 9) return '1.85rem';
  if (n <= 16) return '1.65rem';
  if (n <= 24) return '1.45rem';
  return '1.3rem';
}
