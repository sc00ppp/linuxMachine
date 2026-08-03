#!/usr/bin/env node

/**
 * Expand `shell/src/core/emulators.ts` into `consoled/data/emulators.json`.
 *
 * The TypeScript module stays the authoring surface — it has the helper
 * constructors, the coverage notes, and the review history. The daemon cannot
 * read TypeScript, so this emits the same catalog as plain data and `consoled`
 * embeds it with `include_str!`.
 *
 * Run `--check` in CI/pre-commit: it re-emits in memory and exits non-zero when
 * the checked-in JSON has drifted from the registry.
 */

import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const SOURCE = path.join(ROOT, 'shell', 'src', 'core', 'emulators.ts');
const TARGET = path.join(ROOT, 'consoled', 'data', 'emulators.json');

// Node 22.16 needs an explicit flag to import a `.ts` module. Re-exec rather
// than make every caller remember it; on newer Node the flag is a no-op.
if (!process.env.CONSOLE_EMIT_EMULATORS_CHILD) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      SELF,
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, CONSOLE_EMIT_EMULATORS_CHILD: '1' },
    },
  );
  process.exit(result.status ?? 1);
}

/** Drop undefined-valued keys so the emitted shape stays stable. */
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function emitLaunch(launch) {
  if (!launch) return null;
  return compact({
    name: launch.name,
    kind: launch.kind,
    binary: launch.binary,
    core: launch.core,
    args: [...launch.argsTemplate],
    notes: launch.notes,
  });
}

function emitPlatform(config) {
  return compact({
    coverage: config.coverage,
    preferred: emitLaunch(config.preferred),
    alternates: config.alternates.map(emitLaunch),
    notes: config.notes,
  });
}

function emitSystem(entry) {
  return compact({
    id: entry.id,
    fullname: entry.fullname,
    manufacturer: entry.manufacturer,
    romExtensions: [...entry.romExtensions],
    bios: compact({
      required: entry.bios.required,
      files: [...entry.bios.files],
      notes: entry.bios.notes,
    }),
    platforms: {
      linux: emitPlatform(entry.platforms.linux),
      windows: emitPlatform(entry.platforms.windows),
    },
  });
}

async function render() {
  const registry = await import(pathToFileUrl(SOURCE));
  const systems = {};
  for (const id of Object.keys(registry.EMULATORS).sort()) {
    systems[id] = emitSystem(registry.EMULATORS[id]);
  }
  const document = {
    // Bump when the daemon-visible shape changes; registry.rs asserts on it.
    version: 1,
    generatedBy: 'tools/emit-emulators.mjs',
    aliases: sortedRecord(registry.EMULATOR_ID_ALIASES),
    systems,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function sortedRecord(record) {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

function pathToFileUrl(filePath) {
  // Windows drive paths are not valid import specifiers on their own.
  return new URL(`file:///${filePath.split(path.sep).join('/')}`).href;
}

async function main() {
  const check = process.argv.includes('--check');
  const emitted = await render();

  if (check) {
    let current = null;
    try {
      current = await readFile(TARGET, 'utf8');
    } catch {
      console.error(
        `${path.relative(ROOT, TARGET)} is missing. Run: node tools/emit-emulators.mjs`,
      );
      process.exit(1);
    }
    if (current !== emitted) {
      console.error(
        `${path.relative(ROOT, TARGET)} is stale. Run: node tools/emit-emulators.mjs`,
      );
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, TARGET)} is up to date.`);
    return;
  }

  await mkdir(path.dirname(TARGET), { recursive: true });
  await writeFile(TARGET, emitted);
  const count = Object.keys(JSON.parse(emitted).systems).length;
  console.log(`Wrote ${path.relative(ROOT, TARGET)} (${count} systems).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
