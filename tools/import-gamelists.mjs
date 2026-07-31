#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { dedupeGames, shouldDedupe } from './dedupe.mjs';
import { foldMods } from './mods.mjs';
import { foldSwitchLibrary } from './switchContent.mjs';

const REMOTE = process.env.RETROBAT_REMOTE || 'david@192.168.1.158';
const REMOTE_ROOT_WINDOWS =
  process.env.RETROBAT_ROMS || 'S:\\RetroBat\\roms';
const MEDIA_SERVER_ROOT_WINDOWS =
  process.env.CONSOLE_MEDIA_ROOT || 'S:\\';
// No per-system cap. The importer is metadata-only now (art and video are
// served off the media PC by mediaserve), so a game costs ~1.5 KB of JSON
// instead of megabytes of copied art. The old 150 ceiling existed purely to
// stay inside a local art budget that no longer exists.
const LOCAL_IMAGE_VARIANTS = [
  'thumb',
  'image',
  'box',
  'boxart',
  'mix',
];

/**
 * Box packaging profiles. The old measured median is consulted only when it
 * already falls inside the profile; a screenshot-shaped bad median must not
 * reinforce another screenshot choice.
 */
const PORTRAIT_BOX_TARGETS = {
  atarist: 0.73,
  colecovision: 0.73,
  gamegear: 0.72,
  gb: 0.8,
  gba: 0.86,
  gbc: 0.8,
  jaguarcd: 0.71,
  mastersystem: 0.72,
  megadrive: 0.76,
  nds: 0.67,
  neogeo: 0.74,
  nes: 0.72,
  pcengine: 0.88,
  pokemini: 0.9,
  ps3: 0.72,
  sega32x: 0.76,
  segacd: 0.72,
  snes: 0.72,
  supergrafx: 0.88,
  switch: 0.62,
  triforce: 0.71,
  xbox360: 0.71,
};
const WIDE_BOX_TARGETS = {
  atari2600: 1.49,
  atari5200: 1.49,
  atari7800: 1.44,
  channelf: 1.3,
  jaguar: 1.41,
  lynx: 1.58,
  n64: 1.37,
  n64dd: 1.16,
  virtualboy: 1.71,
};
const FULL_WRAP_TARGETS = {
  '3ds': 2.29,
  dreamcast: 2,
  gamecube: 2,
  ps2: 2.05,
  psp: 2.29,
  psx: 2,
  saturn: 2.16,
  wii: 2.29,
  wiiu: 2.14,
  windows: 1.96,
  xbox: 2.85,
};
const PACKAGE_FREE_SYSTEMS = new Set(['ports']);
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
const legacyOutputPath = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'library.generated.json',
);
const outputDirectory = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'library',
);
const indexOutputPath = path.join(outputDirectory, 'index.generated.json');
const measuredAspectsPath = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'boxAspects.generated.json',
);
function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function encodeCompressedPowerShell(script) {
  const compressed = gzipSync(Buffer.from(script, 'utf8')).toString('base64');
  return encodePowerShell(`
$bytes = [Convert]::FromBase64String('${compressed}')
$memory = [IO.MemoryStream]::new([byte[]]$bytes)
$gzip = [IO.Compression.GzipStream]::new($memory, [IO.Compression.CompressionMode]::Decompress)
$reader = [IO.StreamReader]::new($gzip, [Text.Encoding]::UTF8)
& ([ScriptBlock]::Create($reader.ReadToEnd()))
`);
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
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
  const command = `powershell -NoProfile -EncodedCommand ${encodeCompressedPowerShell(remoteScript)}`;
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

/**
 * Romsets carry things that aren't games: BIOS dumps, test cartridges, service
 * menus, demo reels. No-Intro/RetroBat tag these `ZZZ(notgame):` or `[BIOS]`,
 * which is a reliable enough marker to keep them off the shelf. They still
 * exist on disk — the emulator needs the BIOS — they just aren't titles you
 * scroll past looking for something to play.
 */
function isPlayable(name) {
  return !/^\s*(?:ZZZ[\s(]|\[BIOS\]|BIOS\b)|\(notgame\)/i.test(name);
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
      screenshot: null,
    };
    if (isPlayable(game.name)) {
      games.push(game);
    }
  }

  games.sort(compareGames);

  // Dedupe over the FULL romset, before any ranking survives to the shelf.
  // Order matters: collapsing after a cap would just dedupe an arbitrary
  // slice. `gameCount` stays the true source count so the room can still say
  // "2,255 games" while showing the ~900 distinct ones.
  const shelf = shouldDedupe(systemId) ? dedupeGames(games) : games;

  return {
    id: systemId,
    gameCount: games.length,
    games: shelf,
  };
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

function gameKey(game) {
  return `${game.systemId}\0${game.path}\0${game.name}`;
}

function buildMediaRequests(systems) {
  const requests = [];

  for (const system of systems) {
    if (!isSafeSystemId(system.id)) {
      console.warn(`[media] ${system.id}: unsafe system id; media disabled`);
      for (const game of system.games) {
        game.art = null;
        game.screenshot = null;
        game.video = null;
      }
      continue;
    }

    for (let index = 0; index < system.games.length; index += 1) {
      const game = system.games[index];
      const sourceVideo = normalizeRelativeMediaPath(game.video);
      game.art = null;
      game.screenshot = null;
      game.video = null;
      const metadata = [
        ['thumb', game.thumbnail],
        ['image', game.image],
        ['marquee', game.marquee],
      ]
        .map(([role, source]) => ({
          role,
          source: normalizeRelativeMediaPath(source),
        }))
        .filter(({ source }) => source);
      requests.push({
        key: requests.length,
        system: system.id,
        gameIndex: index,
        metadata,
        video: sourceVideo,
        game,
      });
    }
  }

  return { requests };
}

function resolveMetadataMedia(requests) {
  const choices = new Map();
  for (const request of requests) {
    const candidates = request.metadata.map(({ role, source }) => ({
      source,
      size: 0,
      variant: role,
      via: 'gamelist',
      dimensions: null,
      aspect: null,
    }));
    choices.set(request.key, {
      candidates,
      video: request.video ? { source: request.video, size: 0 } : null,
    });
  }
  return choices;
}

async function readMeasuredAspects() {
  try {
    const parsed = JSON.parse(await readFile(measuredAspectsPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[art] Previous measured aspects ignored: ${error.message}`);
    }
    return {};
  }
}

function distanceToTarget(aspect, target) {
  return Math.abs(Math.log(aspect / target));
}

function distanceToRanges(aspect, ranges) {
  let distance = Number.POSITIVE_INFINITY;
  for (const [minimum, maximum] of ranges) {
    if (aspect >= minimum && aspect <= maximum) return 0;
    const edge = aspect < minimum ? minimum : maximum;
    distance = Math.min(distance, distanceToTarget(aspect, edge));
  }
  return distance;
}

function packagingProfile(system, measuredAspects) {
  if (PACKAGE_FREE_SYSTEMS.has(system)) {
    return { kind: 'free', ranges: [[0.4, 3.2]], targets: [1.6] };
  }
  if (Object.hasOwn(FULL_WRAP_TARGETS, system)) {
    const configured = FULL_WRAP_TARGETS[system];
    const previous = Number(measuredAspects[system]);
    const wideTarget =
      previous >= 1.88 && previous <= 3.2 ? previous : configured;
    return {
      kind: 'wrap',
      ranges: [
        [0.55, 0.98],
        [1.88, 3.2],
      ],
      targets: [wideTarget, 0.72],
    };
  }
  if (Object.hasOwn(WIDE_BOX_TARGETS, system)) {
    const configured = WIDE_BOX_TARGETS[system];
    const previous = Number(measuredAspects[system]);
    const target =
      previous >= 1.08 && previous <= 1.78 ? previous : configured;
    return {
      kind: 'wide',
      ranges: [[1.08, 1.8]],
      targets: [target],
    };
  }

  const target = PORTRAIT_BOX_TARGETS[system] ?? 0.74;
  return {
    kind: 'portrait',
    ranges: [[0.52, 0.98]],
    targets: [target],
  };
}

function aspectFitsProfile(aspect, profile) {
  return (
    Number.isFinite(aspect) &&
    aspect > 0 &&
    distanceToRanges(aspect, profile.ranges) === 0
  );
}

const COVER_VARIANT_SCORE = {
  box: 14,
  boxart: 14,
  thumb: 6,
  mix: 1,
  image: -3,
  plain: 0,
};

function coverScore(candidate, profile, previousMedian) {
  const variantScore = COVER_VARIANT_SCORE[candidate.variant] ?? -4;
  const aspect = Number(candidate.aspect);
  if (!Number.isFinite(aspect) || aspect <= 0) return variantScore - 16;

  const rangeDistance = distanceToRanges(aspect, profile.ranges);
  const targetDistance = Math.min(
    ...profile.targets.map((target) => distanceToTarget(aspect, target)),
  );
  let score =
    variantScore +
    (rangeDistance === 0 ? 11 : 11 - rangeDistance * 28) +
    Math.max(-5, 4 - targetDistance * 9);

  // Under the known sstitle configuration, a screen-shaped -image is not a
  // box merely because a wide package happens to occupy a similar band.
  if (candidate.variant === 'image' && aspect >= 1.02 && aspect <= 1.87) {
    score -= 5;
  }
  if (profile.kind === 'wrap' && aspect >= 1.88) score += 1;

  if (
    Number.isFinite(previousMedian) &&
    aspectFitsProfile(previousMedian, profile)
  ) {
    score += Math.max(
      0,
      1.5 - distanceToTarget(aspect, previousMedian) * 4,
    );
  }
  return score;
}

function screenshotScore(candidate) {
  const variantScore =
    {
      image: 12,
      mix: 3,
      plain: 0,
      thumb: -2,
      box: -10,
      boxart: -10,
    }[candidate.variant] ?? -5;
  const aspect = Number(candidate.aspect);
  if (!Number.isFinite(aspect) || aspect <= 0) return variantScore - 8;

  let shapeScore;
  if (aspect >= 1.02 && aspect <= 2.1) {
    shapeScore = 7;
  } else if (aspect < 1.02) {
    shapeScore = 7 - distanceToTarget(aspect, 1.02) * 18;
  } else {
    shapeScore = 7 - distanceToTarget(aspect, 2.1) * 12;
  }
  return variantScore + shapeScore;
}

function compareScored(left, right) {
  const scoreDifference = right.score - left.score;
  if (Math.abs(scoreDifference) > 0.001) return scoreDifference;
  if (left.candidate.size !== right.candidate.size) {
    return right.candidate.size - left.candidate.size;
  }
  return left.candidate.source.localeCompare(right.candidate.source, 'en');
}

function isBoxLike(candidate, profile) {
  if (!candidate) return false;
  if (profile.kind === 'free') return true;
  if (candidate.variant === 'box' || candidate.variant === 'boxart') {
    return true;
  }
  const aspect = Number(candidate.aspect);
  if (!aspectFitsProfile(aspect, profile)) return false;
  if (candidate.variant === 'image' && aspect >= 1.02 && aspect <= 1.87) {
    return false;
  }
  return true;
}

function selectLocalMedia(requests, remoteChoices, measuredAspects) {
  const selections = new Map();
  const systemResults = new Map();

  for (const request of requests) {
    const remote = remoteChoices.get(request.key) ?? {
      candidates: [],
      video: null,
    };
    const eligible = remote.candidates.filter(
      (candidate) =>
        candidate.variant !== 'marquee' &&
        (LOCAL_IMAGE_VARIANTS.includes(candidate.variant) ||
          candidate.variant === 'plain'),
    );
    const profile = packagingProfile(request.system, measuredAspects);
    const previousMedian = Number(measuredAspects[request.system]);
    const cover = eligible
      .map((candidate) => ({
        candidate,
        score: coverScore(candidate, profile, previousMedian),
      }))
      .sort(compareScored)[0]?.candidate ?? null;
    const screenshot = eligible
      .map((candidate) => ({
        candidate,
        score: screenshotScore(candidate),
      }))
      .sort(compareScored)[0]?.candidate ?? null;
    const legacySmallest = [...remote.candidates].sort(
      (left, right) =>
        left.size - right.size ||
        left.source.localeCompare(right.source, 'en'),
    )[0] ?? null;
    const finalCover = cover ?? screenshot;
    const finalScreenshot = screenshot ?? cover;

    selections.set(request.key, {
      cover: finalCover,
      screenshot: finalScreenshot,
      video: remote.video,
      localBoxLike: isBoxLike(finalCover, profile),
      originalLocalBoxLike: isBoxLike(finalCover, profile),
      apiCover: false,
      changedFromSmallest: Boolean(
        finalCover && legacySmallest?.source !== finalCover.source,
      ),
      localCandidateCount: eligible.length,
    });

    const result = systemResults.get(request.system) ?? {
      games: 0,
      withCandidates: 0,
      changed: 0,
      boxLike: 0,
      fallback: 0,
    };
    result.games += 1;
    if (eligible.length > 0) result.withCandidates += 1;
    if (finalCover && legacySmallest?.source !== finalCover.source) {
      result.changed += 1;
    }
    if (isBoxLike(finalCover, profile)) result.boxLike += 1;
    else if (finalCover) result.fallback += 1;
    systemResults.set(request.system, result);
  }

  return { selections, systemResults };
}

function encodeUrlPathSegment(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function mediaServerPath(system, source) {
  const normalizedSource = normalizeRelativeMediaPath(source);
  if (!normalizedSource || !isSafeSystemId(system)) return null;

  const serverRoot = path.win32.resolve(MEDIA_SERVER_ROOT_WINDOWS);
  const sourcePath = path.win32.resolve(
    REMOTE_ROOT_WINDOWS,
    system,
    ...normalizedSource.split('/'),
  );
  const relative = path.win32.relative(serverRoot, sourcePath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.win32.sep}`) ||
    path.win32.isAbsolute(relative)
  ) {
    throw new Error(
      `Media path ${sourcePath} is outside server root ${serverRoot}`,
    );
  }

  return `/${relative
    .split(path.win32.sep)
    .map(encodeUrlPathSegment)
    .join('/')}`;
}

function assignMediaUrls(requests, selections) {
  let art = 0;
  let screenshots = 0;
  let videos = 0;
  let missing = 0;

  for (const request of requests) {
    const selection = selections.get(request.key);
    const cover = selection?.cover ?? selection?.screenshot ?? null;
    const screenshot = selection?.screenshot ?? selection?.cover ?? null;
    request.game.art = cover
      ? mediaServerPath(request.system, cover.source)
      : null;
    request.game.screenshot = screenshot
      ? mediaServerPath(request.system, screenshot.source)
      : null;
    request.game.video = selection?.video
      ? mediaServerPath(request.system, selection.video.source)
      : null;

    if (request.game.art) art += 1;
    else missing += 1;
    if (request.game.screenshot) screenshots += 1;
    if (request.game.video) videos += 1;
  }

  return { art, screenshots, videos, missing };
}

function baselineMissingGameKeys(library) {
  return new Set(
    library.systems.flatMap((system) =>
      system.games
        .filter((game) => game.art === null)
        .map((game) => gameKey(game)),
    ),
  );
}

function baselineRecovery(baselineKeys, systems) {
  let recovered = 0;
  let absent = 0;
  for (const system of systems) {
    for (const game of system.games) {
      if (!baselineKeys.has(gameKey(game))) continue;
      if (game.art) recovered += 1;
      else absent += 1;
    }
  }
  return { absent, recovered, total: recovered + absent };
}

async function readExistingLibrary() {
  try {
    const index = JSON.parse(await readFile(indexOutputPath, 'utf8'));
    if (!index || !Array.isArray(index.systems)) {
      throw new Error('systems is not an array');
    }
    const systems = await Promise.all(
      index.systems.map(async (system) => {
        if (!isSafeSystemId(system.id)) {
          throw new Error(`unsafe system id: ${JSON.stringify(system.id)}`);
        }
        const games = JSON.parse(
          await readFile(
            path.join(outputDirectory, `${system.id}.generated.json`),
            'utf8',
          ),
        );
        if (!Array.isArray(games)) {
          throw new Error(`${system.id} games is not an array`);
        }
        return { id: system.id, gameCount: system.gameCount, games };
      }),
    );
    return { generatedAt: index.generatedAt ?? null, systems };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[resume] Existing chunked JSON ignored: ${error.message}`);
    }
  }

  try {
    const parsed = JSON.parse(await readFile(legacyOutputPath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.systems)) {
      throw new Error('systems is not an array');
    }
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[resume] Existing legacy JSON ignored: ${error.message}`);
    }
    return { generatedAt: null, systems: [] };
  }
}

async function writeLibrary(systems) {
  const generatedAt = new Date().toISOString();
  const index = {
    generatedAt,
    systems: systems.map((system) => ({
      id: system.id,
      gameCount: system.gameCount,
      shelfCount: system.games.length,
    })),
  };
  await mkdir(outputDirectory, { recursive: true });

  const outputs = [
    ...systems.map((system) => [
      path.join(outputDirectory, `${system.id}.generated.json`),
      system.games,
    ]),
    [indexOutputPath, index],
  ];
  const temporaryOutputs = outputs.map(([destination, value]) => ({
    destination,
    temporary: `${destination}.${process.pid}.tmp`,
    value,
  }));

  await Promise.all(
    temporaryOutputs.map(({ temporary, value }) =>
      writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    ),
  );
  for (const { destination, temporary } of temporaryOutputs) {
    await rename(temporary, destination);
  }

  const expectedNames = new Set(
    outputs.map(([destination]) => path.basename(destination)),
  );
  for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith('.generated.json') &&
      !expectedNames.has(entry.name)
    ) {
      await rm(path.join(outputDirectory, entry.name), { force: true });
    }
  }

  // The chunk set is complete before the legacy file disappears, so a failed
  // import can never strand the shell with neither representation.
  await rm(legacyOutputPath, { force: true });
}

async function main() {
  const startedAt = process.hrtime.bigint();
  console.log(`[import] RetroBat source: ${REMOTE}:${REMOTE_ROOT_WINDOWS}`);
  console.log(`[import] Media server root: ${MEDIA_SERVER_ROOT_WINDOWS}`);
  const existing = await readExistingLibrary();
  const baselineMissing = baselineMissingGameKeys(existing);
  console.log('[import] Fetching all gamelist.xml files in one SSH session...');
  const fetched = await fetchGamelists();
  if (!fetched.complete) {
    throw new Error(`SSH gamelist fetch ended early: ${fetched.error}`);
  }

  const systemsById = new Map();
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
  if (parseFailures > 0) {
    throw new Error(`${parseFailures} gamelist(s) failed to parse`);
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
    `[media] Selecting gamelist media paths for ${includedGameCount.toLocaleString()} included games...`,
  );
  const media = buildMediaRequests(systems);
  const mediaChoices = resolveMetadataMedia(media.requests);
  const resolvedCount = [...mediaChoices.values()].filter(
    (choice) => choice.candidates.length > 0,
  ).length;
  console.log(
    `[media] Gamelist image paths: ${resolvedCount.toLocaleString()} found, ${(media.requests.length - resolvedCount).toLocaleString()} absent.`,
  );
  if (media.requests.length > 0 && resolvedCount === 0) {
    throw new Error('Gamelists contain no image paths');
  }

  const measuredAspects = await readMeasuredAspects();
  const selected = selectLocalMedia(
    media.requests,
    mediaChoices,
    measuredAspects,
  );
  const mediaResult = assignMediaUrls(media.requests, selected.selections);

  const recovery = baselineRecovery(baselineMissing, systems);
  const variantResults = new Map();
  for (const request of media.requests) {
    const selection = selected.selections.get(request.key);
    const result = variantResults.get(request.system) ?? {
      games: 0,
      changed: 0,
      boxLike: 0,
      fallback: 0,
    };
    result.games += 1;
    if (selection?.changedFromSmallest) result.changed += 1;
    if (selection?.originalLocalBoxLike) result.boxLike += 1;
    else if (selection?.cover) result.fallback += 1;
    variantResults.set(request.system, result);
  }

  for (const [system, result] of variantResults) {
    console.log(
      `[variants] ${system}: changed ${result.changed}/${result.games}; box-like ${result.boxLike}, fallback ${result.fallback}`,
    );
  }

  // Fold romhacks under the games they modify. This runs LAST, after media
  // resolution, because "did the scraper know this game?" is the detection
  // signal and `art` is only assigned above. Running it at parse time would
  // judge every entry unscraped and fold half the library into itself.
  // Switch romsets are content lists, not game lists: every patch and every DLC
  // pack is its own file, so 143 entries were really ~30 games. Nintendo's title
  // ids say which is which, so this is precise rather than name-guessing — which
  // is exactly why dedupe.mjs still refuses to touch Switch by title.
  const switchDrops = { updates: 0, dlc: 0, tools: 0, duplicates: 0 };
  for (const system of systems) {
    if (system.id !== 'switch') continue;
    const { games, dropped } = foldSwitchLibrary(system.games);
    system.games = games;
    for (const key of Object.keys(switchDrops)) switchDrops[key] += dropped[key];
  }

  let foldedMods = 0;
  for (const system of systems) {
    const { games, modCount } = foldMods(system.id, system.games);
    system.games = games;
    foldedMods += modCount;
  }

  await writeLibrary(systems);
  const elapsedSeconds =
    Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  console.log(
    `[done] Wrote ${systems.length + 1} files under ${path.relative(repositoryRoot, outputDirectory)}`,
  );
  console.log(
    `[done] ${systems.length} systems, ${trueGameCount.toLocaleString()} true games, ${includedGameCount.toLocaleString()} included after romset dedupe (no cap)`,
  );
  console.log(
    `[done] Mods folded under their base game: ${foldedMods.toLocaleString()}`,
  );
  console.log(
    `[done] Switch content removed: ${switchDrops.dlc} DLC, ${switchDrops.updates} updates, ${switchDrops.duplicates} duplicates, ${switchDrops.tools} tools`,
  );
  console.log(
    `[done] Media URLs: ${mediaResult.art.toLocaleString()} art, ${mediaResult.screenshots.toLocaleString()} screenshots, ${mediaResult.videos.toLocaleString()} videos; ${mediaResult.missing.toLocaleString()} without art`,
  );
  console.log('[done] Media files copied: 0 (metadata-only import)');
  console.log(
    `[done] Previous missing-art set: ${recovery.recovered.toLocaleString()} recovered, ${recovery.absent.toLocaleString()} genuinely absent (${recovery.total.toLocaleString()} checked)`,
  );
  console.log(`[done] Import completed in ${elapsedSeconds.toFixed(2)}s`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exitCode = 1;
});
