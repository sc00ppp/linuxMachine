/**
 * Derive each console's box-art aspect ratio from the REAL scraped covers.
 *
 * Hand-guessed ratios were wrong in both directions (N64 boxes are wide
 * landscape, Game Boy boxes nearly square), which letterboxed most shelves.
 * The artwork already on disk is the ground truth, so measure it: read the
 * PNG/JPEG header of every cover per system and take the median width/height.
 *
 * Median, not mean: a handful of odd scrapes (marquees, wrong-art fallbacks)
 * would drag an average badly.
 *
 * Usage: node tools/measure-box-aspects.mjs
 * Writes shell/src/core/boxAspects.generated.json
 */
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readImageSize } from './image-headers.mjs';

const ART_DIR = 'shell/public/art';
const OUT = 'shell/src/core/boxAspects.generated.json';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

if (!existsSync(ART_DIR)) {
  console.error(`No art directory at ${ART_DIR} — run the importer first.`);
  process.exit(1);
}

const out = {};
for (const system of readdirSync(ART_DIR)) {
  const dir = join(ART_DIR, system);
  if (!statSync(dir).isDirectory()) continue;

  const ratios = [];
  for (const file of readdirSync(dir)) {
    // Backdrops live beside covers but must not influence shelf geometry.
    if (/-screenshot\.(?:jpe?g|png)$/i.test(file)) continue;
    try {
      const size = readImageSize(join(dir, file));
      if (size && size.w > 0 && size.h > 0) ratios.push(size.w / size.h);
    } catch {
      /* unreadable cover — skip */
    }
  }

  if (ratios.length === 0) continue;
  const aspect = Number(median(ratios).toFixed(3));
  out[system] = aspect;
  console.log(
    `${system.padEnd(14)} ${String(ratios.length).padStart(4)} covers  median ${aspect}  ${
      aspect > 1.05 ? '(wide)' : aspect < 0.85 ? '(tall)' : '(squarish)'
    }`,
  );
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote ${Object.keys(out).length} systems → ${OUT}`);
