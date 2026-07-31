#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REMOTE = process.env.RETROBAT_REMOTE || 'david@192.168.1.158';
const REMOTE_ROOT_WINDOWS =
  process.env.RETROBAT_ROMS || 'S:\\RetroBat\\roms';
const REMOTE_ROOT_SCP = REMOTE_ROOT_WINDOWS.replaceAll('\\', '/');
const GAME_LIMIT = 60;
const XML_FIELDS = [
  'path',
  'name',
  'desc',
  'image',
  'thumbnail',
  'marquee',
  'video',
  'rating',
  'releasedate',
  'developer',
  'publisher',
  'genre',
  'players',
  'region',
  'favorite',
  'playcount',
  'lastplayed',
  'gametime',
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const outputPath = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'library.generated.json',
);
const artRoot = path.join(repositoryRoot, 'shell', 'public', 'art');

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function spawnResult(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: null, error, stderr, stdout });
    });
    child.on('close', (code) => {
      resolve({ code, error: null, stderr, stdout });
    });
  });
}

function cleanProcessError(result) {
  if (result.error) {
    return result.error.message;
  }

  const usefulLines = result.stderr
    .split(/\r?\n/)
    .filter(
      (line) =>
        line &&
        !line.startsWith('#< CLIXML') &&
        !line.includes('Preparing modules for first use'),
    );
  return usefulLines.join(' ').trim() || `exit code ${result.code}`;
}

async function fetchGamelists() {
  const remoteScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$utf8 = [Text.UTF8Encoding]::new($false)
$root = ${quotePowerShell(REMOTE_ROOT_WINDOWS)}
foreach ($directory in Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name) {
  $gamelist = Join-Path $directory.FullName 'gamelist.xml'
  if (Test-Path -LiteralPath $gamelist -PathType Leaf) {
    $xml = [IO.File]::ReadAllText($gamelist)
    $payload = [Convert]::ToBase64String($utf8.GetBytes($xml))
    [Console]::Out.WriteLine($directory.Name + [char]9 + $payload)
  } else {
    [Console]::Out.WriteLine($directory.Name + [char]9 + '-')
  }
}
`;
  const command = `powershell -NoProfile -EncodedCommand ${encodePowerShell(remoteScript)}`;
  const gamelists = new Map();
  const missing = [];

  return new Promise((resolve) => {
    const child = spawn('ssh', [REMOTE, command], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    let pending = '';
    let stderr = '';
    let spawnError = null;

    const processLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (!line) {
        return;
      }

      const separator = line.indexOf('\t');
      if (separator < 1) {
        console.warn('[ssh] Ignoring an unrecognized response line.');
        return;
      }

      const system = line.slice(0, separator);
      const payload = line.slice(separator + 1);
      if (!isSafeSystemId(system)) {
        console.warn(`[ssh] Ignoring unsafe system id: ${JSON.stringify(system)}`);
        return;
      }
      if (payload === '-') {
        missing.push(system);
        console.log(`[ssh] ${system}: no gamelist.xml (skipped)`);
        return;
      }

      try {
        const xml = Buffer.from(payload, 'base64').toString('utf8');
        gamelists.set(system, xml.replace(/^\uFEFF/, ''));
        console.log(
          `[ssh] ${system}: fetched ${Math.round(Buffer.byteLength(xml) / 1024).toLocaleString()} KiB`,
        );
      } catch (error) {
        console.warn(`[ssh] ${system}: could not decode XML (${error.message})`);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        processLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code) => {
      if (pending) {
        processLine(pending);
      }
      resolve({
        complete: code === 0 && !spawnError,
        error:
          code === 0 && !spawnError
            ? ''
            : cleanProcessError({
                code,
                error: spawnError,
                stderr,
                stdout: '',
              }),
        gamelists,
        missing,
      });
    });
  });
}

function decodeXml(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (entity, code) => {
      const normalized = code.toLowerCase();
      if (normalized === 'amp') return '&';
      if (normalized === 'apos') return "'";
      if (normalized === 'gt') return '>';
      if (normalized === 'lt') return '<';
      if (normalized === 'quot') return '"';

      const numeric =
        normalized[1] === 'x'
          ? Number.parseInt(normalized.slice(2), 16)
          : Number.parseInt(normalized.slice(1), 10);
      if (
        !Number.isInteger(numeric) ||
        numeric < 0 ||
        numeric > 0x10ffff
      ) {
        return entity;
      }
      return String.fromCodePoint(numeric);
    },
  );
}

function readTag(block, tag) {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`,
    'i',
  ).exec(block);
  if (!match) {
    return '';
  }

  const value = match[1].replace(
    /^<!\[CDATA\[([\s\S]*)\]\]>$/,
    (_whole, cdata) => cdata,
  );
  return decodeXml(value).trim();
}

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseRating(value) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFavorite(value) {
  return /^(?:1|true|yes)$/i.test(value.trim());
}

function fallbackName(romPath) {
  const filename = romPath.replaceAll('\\', '/').split('/').pop() || 'Unknown game';
  return filename.replace(/\.[^.]+$/, '') || 'Unknown game';
}

function compareGames(left, right) {
  if (left.playcount !== right.playcount) {
    return right.playcount - left.playcount;
  }
  if (left.favorite !== right.favorite) {
    return Number(right.favorite) - Number(left.favorite);
  }
  const byName = left.name.localeCompare(right.name, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
  return byName || left.path.localeCompare(right.path, 'en');
}

function parseGamelist(systemId, xml) {
  const games = [];
  const gamePattern = /<game(?:\s[^>]*)?>([\s\S]*?)<\/game\s*>/gi;
  let match;

  while ((match = gamePattern.exec(xml)) !== null) {
    const raw = Object.fromEntries(
      XML_FIELDS.map((field) => [field, readTag(match[1], field)]),
    );
    const game = {
      systemId,
      path: raw.path,
      name: raw.name || fallbackName(raw.path),
      desc: raw.desc,
      image: raw.image,
      thumbnail: raw.thumbnail,
      marquee: raw.marquee,
      video: raw.video,
      rating: parseRating(raw.rating),
      releasedate: raw.releasedate,
      developer: raw.developer,
      publisher: raw.publisher,
      genre: raw.genre,
      players: raw.players,
      region: raw.region,
      favorite: parseFavorite(raw.favorite),
      playcount: parseNonNegativeInteger(raw.playcount),
      lastplayed: raw.lastplayed,
      gametime: parseNonNegativeInteger(raw.gametime),
      art: null,
    };
    games.push(game);
  }

  games.sort(compareGames);
  return {
    id: systemId,
    gameCount: games.length,
    games: games.slice(0, GAME_LIMIT),
  };
}

function slugify(value) {
  let slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  if (!slug) {
    slug = 'game';
  }
  if (/^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)$/i.test(slug)) {
    slug = `game-${slug}`;
  }
  return slug;
}

function shortHash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function assignSlugs(games) {
  const bases = games.map((game) => slugify(game.name));
  const counts = new Map();
  for (const base of bases) {
    counts.set(base, (counts.get(base) || 0) + 1);
  }

  const used = new Set();
  return games.map((game, index) => {
    const base = bases[index];
    let slug =
      counts.get(base) === 1
        ? base
        : `${base}-${shortHash(game.path || `${game.name}:${index}`)}`;
    if (used.has(slug)) {
      slug = `${slug}-${shortHash(`${game.path}:${index}`)}`;
    }
    used.add(slug);
    return slug;
  });
}

function isSafeSystemId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 100 &&
    value !== '.' &&
    value !== '..' &&
    !/[\/\\\0]/.test(value)
  );
}

function normalizeRelativeMediaPath(value) {
  if (!value) {
    return '';
  }
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized)
  ) {
    return '';
  }

  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    return '';
  }
  return parts.join('/');
}

async function isNonEmptyFile(filename) {
  try {
    return (await stat(filename)).isFile() && (await stat(filename)).size > 0;
  } catch {
    return false;
  }
}

async function buildArtRequests(systems) {
  const requests = [];
  let skipped = 0;

  for (const system of systems) {
    if (!isSafeSystemId(system.id)) {
      console.warn(`[art] ${system.id}: unsafe system id; art disabled`);
      for (const game of system.games) {
        game.art = null;
      }
      continue;
    }

    const slugs = assignSlugs(system.games);
    const localDirectory = path.join(artRoot, system.id);
    await mkdir(localDirectory, { recursive: true });

    for (let index = 0; index < system.games.length; index += 1) {
      const game = system.games[index];
      const target = path.join(localDirectory, `${slugs[index]}.png`);
      const publicPath = `/art/${system.id}/${slugs[index]}.png`;
      if (await isNonEmptyFile(target)) {
        game.art = publicPath;
        skipped += 1;
        continue;
      }

      game.art = null;
      const candidates = [...new Set(
        [game.thumbnail, game.image]
          .map(normalizeRelativeMediaPath)
          .filter(Boolean),
      )];
      if (!candidates.length) {
        continue;
      }

      requests.push({
        key: requests.length,
        system: system.id,
        candidates,
        target,
        publicPath,
        game,
      });
    }
  }

  return { requests, skipped };
}

async function resolveRemoteArt(requests) {
  if (!requests.length) {
    return { choices: new Map(), complete: true, error: '' };
  }

  const remoteScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$utf8 = [Text.UTF8Encoding]::new($false)
$root = ${quotePowerShell(REMOTE_ROOT_WINDOWS)}
$json = [Console]::In.ReadToEnd()
$requests = ConvertFrom-Json -InputObject $json
foreach ($request in $requests) {
  $choice = $null
  $systemRoot = Join-Path $root ([string]$request.system)
  foreach ($candidate in $request.candidates) {
    $relative = ([string]$candidate).Replace('/', [IO.Path]::DirectorySeparatorChar)
    $fullPath = Join-Path $systemRoot $relative
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      $item = Get-Item -LiteralPath $fullPath
      if ($item.Length -gt 0) {
        $choice = [string]$candidate
        break
      }
    }
  }
  if ($null -eq $choice) {
    [Console]::Out.WriteLine(([string]$request.key) + [char]9 + '-')
  } else {
    $encoded = [Convert]::ToBase64String($utf8.GetBytes($choice))
    [Console]::Out.WriteLine(([string]$request.key) + [char]9 + $encoded)
  }
}
`;
  const command = `powershell -NoProfile -EncodedCommand ${encodePowerShell(remoteScript)}`;
  const input = JSON.stringify(
    requests.map(({ key, system, candidates }) => ({
      key,
      system,
      candidates,
    })),
  );
  return runArtResolverWithInput(command, input);
}

function runArtResolverWithInput(command, input) {
  return new Promise((resolve) => {
    const child = spawn('ssh', [REMOTE, command], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let spawnError = null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code) => {
      const choices = new Map();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line) continue;
        const separator = line.indexOf('\t');
        if (separator < 1) continue;
        const key = Number.parseInt(line.slice(0, separator), 10);
        const payload = line.slice(separator + 1);
        if (!Number.isInteger(key)) continue;
        choices.set(
          key,
          payload === '-'
            ? ''
            : Buffer.from(payload, 'base64').toString('utf8'),
        );
      }
      const complete = code === 0 && !spawnError;
      resolve({
        choices,
        complete,
        error: complete
          ? ''
          : cleanProcessError({
              code,
              error: spawnError,
              stderr,
              stdout,
            }),
      });
    });
    child.stdin.on('error', () => {
      // The close handler reports the useful SSH error.
    });
    child.stdin.end(input, 'utf8');
  });
}

function escapeScpRemotePath(value) {
  return value.replace(/([\\*?[\]])/g, '\\$1');
}

function splitScpBatches(entries) {
  const batches = [];
  let batch = [];
  let names = new Set();
  let characterCount = 0;

  for (const entry of entries) {
    const basename = path.posix.basename(entry.source).toLowerCase();
    const estimatedLength = entry.source.length + REMOTE.length + 2;
    if (
      batch.length &&
      (batch.length >= 60 ||
        characterCount + estimatedLength > 20_000 ||
        names.has(basename))
    ) {
      batches.push(batch);
      batch = [];
      names = new Set();
      characterCount = 0;
    }
    batch.push(entry);
    names.add(basename);
    characterCount += estimatedLength;
  }
  if (batch.length) {
    batches.push(batch);
  }
  return batches;
}

async function copyArt(requests, choices, resolverComplete) {
  const bySystem = new Map();
  let missing = 0;
  let copied = 0;
  let failed = 0;

  for (const request of requests) {
    const resolved = choices.get(request.key);
    const source =
      resolved === undefined && !resolverComplete
        ? request.candidates[0]
        : resolved;
    if (!source) {
      missing += 1;
      continue;
    }
    const entries = bySystem.get(request.system) || [];
    entries.push({ ...request, source });
    bySystem.set(request.system, entries);
  }

  for (const [system, entries] of bySystem) {
    let systemCopied = 0;
    let systemFailed = 0;
    const batches = splitScpBatches(entries);

    for (const batch of batches) {
      const staging = await mkdtemp(
        path.join(tmpdir(), `linuxmachine-${system}-art-`),
      );
      try {
        const remoteSources = batch.map(({ source }) => {
          const remotePath = `${REMOTE_ROOT_SCP}/${system}/${source}`;
          return `${REMOTE}:${escapeScpRemotePath(remotePath)}`;
        });
        const result = await spawnResult('scp', [
          '-q',
          ...remoteSources,
          staging,
        ]);
        if (result.code !== 0 || result.error) {
          console.warn(
            `[art] ${system}: SCP batch warning (${cleanProcessError(result)})`,
          );
        }

        for (const entry of batch) {
          const staged = path.join(staging, path.posix.basename(entry.source));
          if (!(await isNonEmptyFile(staged))) {
            systemFailed += 1;
            continue;
          }
          await copyFile(staged, entry.target);
          if (await isNonEmptyFile(entry.target)) {
            entry.game.art = entry.publicPath;
            systemCopied += 1;
          } else {
            systemFailed += 1;
          }
        }
      } finally {
        await rm(staging, { force: true, recursive: true });
      }
    }

    copied += systemCopied;
    failed += systemFailed;
    console.log(
      `[art] ${system}: copied ${systemCopied}, failed ${systemFailed}`,
    );
  }

  return { copied, failed, missing };
}

async function readExistingLibrary() {
  try {
    const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.systems)) {
      throw new Error('systems is not an array');
    }
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[resume] Existing JSON ignored: ${error.message}`);
    }
    return { generatedAt: null, systems: [] };
  }
}

async function writeLibrary(systems) {
  const output = {
    generatedAt: new Date().toISOString(),
    systems,
  };
  const temporaryPath = path.join(
    scriptDirectory,
    `.library.generated.${process.pid}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

async function main() {
  console.log(`[import] RetroBat source: ${REMOTE}:${REMOTE_ROOT_WINDOWS}`);
  console.log('[import] Fetching all gamelist.xml files in one SSH session...');
  const existing = await readExistingLibrary();
  const fetched = await fetchGamelists();

  if (!fetched.complete) {
    console.warn(
      `[ssh] Connection ended early: ${fetched.error}. Preserving prior systems where possible.`,
    );
  }

  const systemsById = new Map(
    (fetched.complete ? [] : existing.systems).map((system) => [
      system.id,
      system,
    ]),
  );
  let parseFailures = 0;
  for (const [systemId, xml] of fetched.gamelists) {
    try {
      const system = parseGamelist(systemId, xml);
      systemsById.set(systemId, system);
      console.log(
        `[parse] ${systemId}: ${system.gameCount.toLocaleString()} games; keeping ${system.games.length}`,
      );
    } catch (error) {
      parseFailures += 1;
      console.warn(`[parse] ${systemId}: failed (${error.message})`);
    }
  }
  for (const systemId of fetched.missing) {
    if (fetched.complete) {
      systemsById.delete(systemId);
    }
  }

  const systems = [...systemsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id, 'en'),
  );
  const trueGameCount = systems.reduce(
    (total, system) => total + system.gameCount,
    0,
  );
  const includedGameCount = systems.reduce(
    (total, system) => total + system.games.length,
    0,
  );

  console.log(
    `[art] Checking ${includedGameCount.toLocaleString()} included games against local art...`,
  );
  const art = await buildArtRequests(systems);
  console.log(
    `[art] ${art.skipped.toLocaleString()} existing non-empty files skipped; ${art.requests.length.toLocaleString()} need resolution`,
  );

  const resolved = await resolveRemoteArt(art.requests);
  if (!resolved.complete) {
    console.warn(
      `[art] Remote preflight ended early: ${resolved.error}. SCP will make a best-effort pass for unresolved entries.`,
    );
  }
  const artResult = await copyArt(
    art.requests,
    resolved.choices,
    resolved.complete,
  );

  await writeLibrary(systems);

  console.log(`[done] Wrote ${path.relative(repositoryRoot, outputPath)}`);
  console.log(
    `[done] ${systems.length} systems, ${trueGameCount.toLocaleString()} true games, ${includedGameCount.toLocaleString()} included`,
  );
  console.log(
    `[done] Art: ${artResult.copied.toLocaleString()} copied, ${art.skipped.toLocaleString()} skipped, ${artResult.missing.toLocaleString()} unavailable, ${artResult.failed.toLocaleString()} failed`,
  );

  if (
    !fetched.complete ||
    !resolved.complete ||
    parseFailures > 0 ||
    artResult.failed > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exitCode = 1;
});
