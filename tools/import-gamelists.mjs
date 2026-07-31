#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { imageSizeFromHeader } from './image-headers.mjs';

const REMOTE = process.env.RETROBAT_REMOTE || 'david@192.168.1.158';
const REMOTE_ROOT_WINDOWS =
  process.env.RETROBAT_ROMS || 'S:\\RetroBat\\roms';
const REMOTE_ROOT_SCP = REMOTE_ROOT_WINDOWS.replaceAll('\\', '/');
const REMOTE_THEME_ART_WINDOWS =
  process.env.RETROBAT_THEME_ART ||
  'S:\\RetroBat\\emulationstation\\.emulationstation\\themes\\es-theme-carbon-master\\art';
const REMOTE_THEME_ART_SCP = REMOTE_THEME_ART_WINDOWS.replaceAll('\\', '/');
const GAME_LIMIT = 150;
const VIDEO_LIMIT_PER_SYSTEM = 40;
const ART_SIZE_LIMIT = Math.floor(2.5 * 1024 ** 3);
const IMPORT_THEME_ASSETS = process.env.IMPORT_THEME_ASSETS !== '0';
const SCREEN_SCRAPER_ENDPOINT =
  'https://api.screenscraper.fr/api2/jeuInfos.php';
const SCREEN_SCRAPER_SYSTEMS_ENDPOINT =
  'https://api.screenscraper.fr/api2/systemesListe.php';
const SHELL_PLATFORM_ID_MAP = {
  megadrive: 'genesis',
  psx: 'ps1',
  gbc: 'gb',
};

/**
 * Carbon theme filename (without extension) by the id ConsoleTile receives.
 * Keep this explicit: RetroBat, Carbon, and the shell do not share one naming
 * scheme, and a fuzzy match can silently put the wrong machine on the shelf.
 */
const THEME_SYSTEM_FILE_MAP = {
  '3ds': '3ds',
  atari2600: 'atari2600',
  atari5200: 'atari5200',
  atari7800: 'atari7800',
  atarist: 'atarist',
  channelf: 'channelf',
  colecovision: 'colecovision',
  dreamcast: 'dreamcast',
  gamecube: 'gc',
  gamegear: 'gamegear',
  gb: 'gb',
  gba: 'gba',
  jaguar: 'atarijaguar',
  jaguarcd: 'atarijaguarcd',
  lynx: 'atarilynx',
  mastersystem: 'mastersystem',
  genesis: 'megadrive',
  n64: 'n64',
  n64dd: 'n64dd',
  nds: 'nds',
  neogeo: 'neogeo',
  nes: 'nes',
  pcengine: 'pcengine',
  pokemini: 'pokemini',
  ports: 'ports',
  ps1: 'psx',
  ps2: 'ps2',
  ps3: 'ps3',
  psp: 'psp',
  saturn: 'saturn',
  sega32x: 'sega32x',
  segacd: 'segacd',
  snes: 'snes',
  supergrafx: 'supergrafx',
  switch: 'switch',
  triforce: 'triforce',
  virtualboy: 'virtualboy',
  wii: 'wii',
  wiiu: 'wiiu',
  windows: 'windows',
  xbox: 'xbox',
  xbox360: 'xbox360',
};
const LOCAL_IMAGE_VARIANTS = [
  'thumb',
  'image',
  'box',
  'boxart',
  'mix',
];
const INDEXED_IMAGE_VARIANTS = [...LOCAL_IMAGE_VARIANTS, 'marquee'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

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
const outputPath = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'library.generated.json',
);
const artRoot = path.join(repositoryRoot, 'shell', 'public', 'art');
const gameVideoRoot = path.join(
  repositoryRoot,
  'shell',
  'public',
  'game-video',
);
const measuredAspectsPath = path.join(
  repositoryRoot,
  'shell',
  'src',
  'core',
  'boxAspects.generated.json',
);
const screenScraperCacheRoot = path.join(
  scriptDirectory,
  '.screenscraper-cache',
);
const screenScraperCachePath = path.join(
  screenScraperCacheRoot,
  'boxart.json',
);
const consoleArtRoot = path.join(
  repositoryRoot,
  'shell',
  'public',
  'console-art',
);
const controllerArtRoot = path.join(
  repositoryRoot,
  'shell',
  'public',
  'controller-art',
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
    const details = await stat(filename);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

function romBasename(romPath) {
  const filename = romPath.replaceAll('\\', '/').split('/').pop() || '';
  return filename.replace(/\.[^.]+$/, '');
}

function gameKey(game) {
  return `${game.systemId}\0${game.path}\0${game.name}`;
}

async function buildMediaRequests(systems, stagingArtRoot, stagingVideoRoot) {
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

    const slugs = assignSlugs(system.games);
    const localArtDirectory = path.join(stagingArtRoot, system.id);
    const localVideoDirectory = path.join(stagingVideoRoot, system.id);
    await mkdir(localArtDirectory, { recursive: true });
    await mkdir(localVideoDirectory, { recursive: true });

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
      const slug = slugs[index];

      requests.push({
        key: requests.length,
        system: system.id,
        gameIndex: index,
        metadata,
        romBase: romBasename(game.path),
        video: sourceVideo,
        coverTargetBase: path.join(localArtDirectory, slug),
        coverPublicBase: `/art/${system.id}/${slug}`,
        screenshotTargetBase: path.join(
          localArtDirectory,
          `${slug}-screenshot`,
        ),
        screenshotPublicBase: `/art/${system.id}/${slug}-screenshot`,
        videoTarget: path.join(localVideoDirectory, `${slug}.mp4`),
        videoPublicPath: `/game-video/${system.id}/${slug}.mp4`,
        game,
      });
    }
  }

  return { requests };
}

async function resolveRemoteMedia(requests) {
  if (!requests.length) {
    return { choices: new Map(), complete: true, error: '' };
  }

  const remoteScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$inputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $inputEncoding
$utf8 = [Text.UTF8Encoding]::new($false)
$root = ${quotePowerShell(REMOTE_ROOT_WINDOWS)}
$json = [Console]::In.ReadToEnd()
$requests = ConvertFrom-Json -InputObject $json
$variantNames = @(${INDEXED_IMAGE_VARIANTS.map(quotePowerShell).join(', ')})
$imageExtensions = @(${IMAGE_EXTENSIONS.map(quotePowerShell).join(', ')})

function Test-SofMarker([int]$marker) {
  return (($marker -ge 0xC0 -and $marker -le 0xC3) -or
    ($marker -ge 0xC5 -and $marker -le 0xC7) -or
    ($marker -ge 0xC9 -and $marker -le 0xCB) -or
    ($marker -ge 0xCD -and $marker -le 0xCF))
}

function Get-ImageHeader([string]$filename) {
  $stream = [IO.File]::OpenRead($filename)
  try {
    $buffer = [byte[]]::new(65536)
    $count = $stream.Read($buffer, 0, $buffer.Length)
  } finally {
    $stream.Dispose()
  }
  if ($count -ge 24 -and
      $buffer[0] -eq 0x89 -and $buffer[1] -eq 0x50 -and
      $buffer[2] -eq 0x4E -and $buffer[3] -eq 0x47) {
    return [Convert]::ToBase64String([byte[]]$buffer[0..23])
  }
  if ($count -lt 4 -or $buffer[0] -ne 0xFF -or $buffer[1] -ne 0xD8) {
    return ''
  }

  $index = 2
  while ($index -lt ($count - 9)) {
    if ($buffer[$index] -ne 0xFF) {
      $index += 1
      continue
    }
    $marker = [int]$buffer[$index + 1]
    if (Test-SofMarker $marker) {
      $length = [Math]::Min($count, $index + 10)
      return [Convert]::ToBase64String([byte[]]$buffer[0..($length - 1)])
    }
    if (($index + 3) -ge $count) { break }
    $segmentLength = (([int]$buffer[$index + 2]) -shl 8) -bor [int]$buffer[$index + 3]
    if ($segmentLength -lt 2) { break }
    $index += 2 + $segmentLength
  }
  return ''
}

function Get-VariantBase([string]$stem, [string]$variant) {
  if ($variant -eq 'plain') { return $stem }
  return $stem.Substring(0, $stem.Length - $variant.Length - 1)
}

function Add-Match($matches, $entry, [string]$role, [string]$via) {
  if ($null -eq $entry -or $matches.ContainsKey([string]$entry.source)) { return }
  $variant = [string]$entry.variant
  if ($variant -eq 'plain' -and $role) { $variant = $role }
  $matches[[string]$entry.source] = [PSCustomObject]@{
    source = [string]$entry.source
    size = [long]$entry.size
    variant = $variant
    via = $via
    fullPath = [string]$entry.fullPath
    base = [string]$entry.base
  }
}

foreach ($group in @($requests | Group-Object system)) {
  $systemRoot = Join-Path $root ([string]$group.Name)
  $imagesRoot = Join-Path $systemRoot 'images'
  $byRelative = @{}
  $byBase = @{}
  if (Test-Path -LiteralPath $imagesRoot -PathType Container) {
    foreach ($file in Get-ChildItem -LiteralPath $imagesRoot -File -Recurse) {
      if ($file.Length -le 0) { continue }
      $extension = $file.Extension.ToLowerInvariant()
      if ($imageExtensions -notcontains $extension) { continue }
      $relative = $file.FullName.Substring($systemRoot.Length).TrimStart('\\').Replace('\\', '/')
      $stem = $file.BaseName.ToLowerInvariant()
      $variant = 'plain'
      foreach ($variantName in $variantNames) {
        $suffix = '-' + $variantName
        if ($stem.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) {
          $variant = $variantName
          break
        }
      }
      $base = Get-VariantBase $stem $variant
      $entry = [PSCustomObject]@{
        source = $relative
        size = [long]$file.Length
        variant = $variant
        fullPath = $file.FullName
        base = $base
      }
      $byRelative[$relative] = $entry
      if (-not $byBase.ContainsKey($base)) {
        $byBase[$base] = [Collections.ArrayList]::new()
      }
      [void]$byBase[$base].Add($entry)
    }
  }

  foreach ($request in @($group.Group)) {
    $matches = @{}
    $baseNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [void]$baseNames.Add(([string]$request.romBase).ToLowerInvariant())

    foreach ($metadata in @($request.metadata)) {
      $source = [string]$metadata.source
      $role = [string]$metadata.role
      $dot = $source.LastIndexOf('.')
      $sourceWithoutExtension = if ($dot -gt 0) { $source.Substring(0, $dot) } else { $source }
      foreach ($extension in $imageExtensions) {
        $twin = $sourceWithoutExtension + $extension
        if ($byRelative.ContainsKey($twin)) {
          Add-Match $matches $byRelative[$twin] $role 'metadata'
        }
      }
      $stem = [IO.Path]::GetFileNameWithoutExtension($source).ToLowerInvariant()
      $stemVariant = 'plain'
      foreach ($variantName in $variantNames) {
        if ($stem.EndsWith('-' + $variantName, [StringComparison]::OrdinalIgnoreCase)) {
          $stemVariant = $variantName
          break
        }
      }
      [void]$baseNames.Add((Get-VariantBase $stem $stemVariant))
    }

    foreach ($base in $baseNames) {
      if ($byBase.ContainsKey($base)) {
        foreach ($entry in $byBase[$base]) {
          Add-Match $matches $entry '' 'basename'
        }
      }
    }

    $outCandidates = @(
      foreach ($entry in $matches.Values) {
        [PSCustomObject]@{
          source = [string]$entry.source
          size = [long]$entry.size
          variant = [string]$entry.variant
          via = [string]$entry.via
          header = Get-ImageHeader ([string]$entry.fullPath)
        }
      }
    )

    $video = $null
    $videoSource = [string]$request.video
    if ($videoSource) {
      $videoPath = Join-Path $systemRoot $videoSource.Replace('/', [IO.Path]::DirectorySeparatorChar)
      if (Test-Path -LiteralPath $videoPath -PathType Leaf) {
        $videoItem = Get-Item -LiteralPath $videoPath
        if ($videoItem.Length -gt 0 -and $videoItem.Extension -ieq '.mp4') {
          $video = [PSCustomObject]@{
            source = $videoSource
            size = [long]$videoItem.Length
          }
        }
      }
    }

    $result = [PSCustomObject]@{ candidates = $outCandidates; video = $video }
    $payload = ConvertTo-Json -InputObject $result -Compress -Depth 5
    $encoded = [Convert]::ToBase64String($utf8.GetBytes($payload))
    [Console]::Out.WriteLine(([string]$request.key) + [char]9 + $encoded)
  }
}
`;
  const command = `powershell -NoProfile -EncodedCommand ${encodeCompressedPowerShell(remoteScript)}`;
  const input = JSON.stringify(
    requests.map(({ key, system, metadata, romBase, video }) => ({
      key,
      system,
      metadata,
      romBase,
      video,
    })),
  );
  return runRemoteResolver(command, input, requests.length);
}

function runRemoteResolver(command, input, expectedCount) {
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
        const parsed = JSON.parse(
          Buffer.from(payload, 'base64').toString('utf8'),
        );
        const rawCandidates = Array.isArray(parsed.candidates)
          ? parsed.candidates
          : [];
        const candidates = rawCandidates.map((candidate) => {
          let dimensions = null;
          try {
            const header = Buffer.from(candidate.header || '', 'base64');
            dimensions = imageSizeFromHeader(header);
          } catch {
            // Malformed header data remains an unmeasured last-resort image.
          }
          return {
            source: candidate.source,
            size: Number(candidate.size) || 0,
            variant: candidate.variant,
            via: candidate.via,
            dimensions,
            aspect:
              dimensions?.w > 0 && dimensions?.h > 0
                ? dimensions.w / dimensions.h
                : null,
          };
        });
        choices.set(key, {
          candidates,
          video:
            parsed.video?.source && Number(parsed.video.size) > 0
              ? {
                  source: parsed.video.source,
                  size: Number(parsed.video.size),
                }
              : null,
        });
      }
      const complete =
        code === 0 && !spawnError && choices.size === expectedCount;
      resolve({
        choices,
        complete,
        error: complete
          ? ''
          : choices.size !== expectedCount && code === 0 && !spawnError
            ? `received ${choices.size}/${expectedCount} media responses`
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

async function readScreenScraperCache() {
  try {
    const parsed = JSON.parse(await readFile(screenScraperCachePath, 'utf8'));
    return {
      version: 1,
      apiStatus: parsed?.apiStatus ?? null,
      games:
        parsed?.games && typeof parsed.games === 'object' ? parsed.games : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[screenscraper] Cache ignored: ${error.message}`);
    }
    return { version: 1, apiStatus: null, games: {} };
  }
}

async function writeScreenScraperCache(cache) {
  await mkdir(screenScraperCacheRoot, { recursive: true });
  const temporary = `${screenScraperCachePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await rename(temporary, screenScraperCachePath);
}

async function fetchScreenScraperCredentials() {
  const configPath = 'S:\\RetroBat\\emulationstation\\.emulationstation\\es_settings.cfg';
  const remoteScript = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$utf8=[Text.UTF8Encoding]::new($false)
$text=[IO.File]::ReadAllText(${quotePowerShell(configPath)})
function Read-Setting([string]$name) {
  $quote=[char]34
  $pattern='name='+$quote+[regex]::Escape($name)+$quote+'\\s+value='+$quote+'([^'+$quote+']*)'+$quote
  $match=[regex]::Match($text,$pattern)
  if (-not $match.Success) { return '' }
  return [Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
}
$json=ConvertTo-Json -Compress -InputObject ([PSCustomObject]@{
  user=Read-Setting 'ScreenScraperUser'; password=Read-Setting 'ScreenScraperPass'
})
[Console]::Out.Write([Convert]::ToBase64String($utf8.GetBytes($json)))
`;
  const command = `powershell -NoProfile -EncodedCommand ${encodePowerShell(remoteScript)}`;
  const result = await spawnResult('ssh', [REMOTE, command]);
  if (result.code !== 0 || result.error) {
    return { credentials: null, error: `config read failed (${cleanProcessError(result)})` };
  }
  try {
    const decoded = Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed.user || !parsed.password) {
      return { credentials: null, error: 'RetroBat ScreenScraper credentials are missing' };
    }
    return { credentials: { user: parsed.user, password: parsed.password }, error: '' };
  } catch {
    return { credentials: null, error: 'RetroBat credential response was unreadable' };
  }
}

function screenScraperParameters(credentials) {
  return new URLSearchParams({
    output: 'json',
    softname: 'linuxmachine-boxart',
    ssid: credentials.user,
    sspassword: credentials.password,
  });
}

async function fetchWithTimeout(url, options = {}, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function classifyScreenScraperResponse(status, body) {
  if (/d[eé]veloppeur|developer|devpassword|\bdevid\b/i.test(body)) {
    return {
      state: 'developer-credentials-required',
      reason: 'the API rejected the request without devid/devpassword',
    };
  }
  if (/login utilisateur|user(?:name)? login|ssid|sspassword/i.test(body)) {
    return {
      state: 'user-credentials-rejected',
      reason: 'the API rejected the configured ScreenScraper user account',
    };
  }
  if (status >= 400) {
    return { state: 'api-rejected', reason: `the API returned HTTP ${status}` };
  }
  return { state: 'available', reason: 'the API accepted the preflight' };
}

async function preflightScreenScraper(credentials, cache) {
  const cachedAt = Date.parse(cache.apiStatus?.checkedAt ?? '');
  const cacheFresh =
    Number.isFinite(cachedAt) && Date.now() - cachedAt < 24 * 60 * 60 * 1000;
  if (cacheFresh && cache.apiStatus?.state !== 'transient-error') {
    return { ...cache.apiStatus, cached: true };
  }

  const parameters = screenScraperParameters(credentials);
  // NES id 3 is used only to make jeuInfos authenticate this request.
  parameters.set('systemeid', '3');
  parameters.set('romnom', 'Super Mario Bros. (USA).zip');
  let status;
  try {
    const response = await fetchWithTimeout(
      `${SCREEN_SCRAPER_ENDPOINT}?${parameters}`,
    );
    const body = await response.text();
    status = classifyScreenScraperResponse(response.status, body);
  } catch {
    status = {
      state: 'transient-error',
      reason: 'the API preflight could not reach ScreenScraper',
    };
  }
  cache.apiStatus = { ...status, checkedAt: new Date().toISOString() };
  await writeScreenScraperCache(cache);
  return { ...cache.apiStatus, cached: false };
}

function normalizedSystemName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const SCREEN_SCRAPER_SPECIAL_ALIASES = {
  '3ds': ['nintendo3ds'],
  channelf: ['fairchildchannelf'],
  gamecube: ['nintendogamecube', 'gc'],
  gamegear: ['segagamegear'],
  gb: ['gameboy', 'nintendogameboy'],
  gba: ['gameboyadvance'],
  gbc: ['gameboycolor'],
  mastersystem: ['segamastersystem'],
  megadrive: ['genesis', 'segagenesis'],
  n64: ['nintendo64'],
  n64dd: ['nintendo64dd'],
  nds: ['nintendods'],
  nes: ['nintendoentertainmentsystem'],
  pcengine: ['turbografx16'],
  pokemini: ['pokemonmini'],
  ps2: ['playstation2'],
  ps3: ['playstation3'],
  psp: ['playstationportable'],
  psx: ['ps1', 'playstation'],
  sega32x: ['32x'],
  segacd: ['megacd'],
  snes: ['supernintendo'],
  switch: ['nintendoswitch'],
  wiiu: ['nintendowiiu'],
};

function collectScreenScraperSystems(value, systems = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectScreenScraperSystems(item, systems);
    return systems;
  }
  if (!value || typeof value !== 'object') return systems;
  if (value.id != null && value.noms && typeof value.noms === 'object') {
    systems.push(value);
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      collectScreenScraperSystems(nested, systems);
    }
  }
  return systems;
}

async function fetchScreenScraperSystemIds(credentials, requestedSystems) {
  const parameters = screenScraperParameters(credentials);
  const response = await fetchWithTimeout(
    `${SCREEN_SCRAPER_SYSTEMS_ENDPOINT}?${parameters}`,
  );
  const body = await response.text();
  const classification = classifyScreenScraperResponse(response.status, body);
  if (classification.state !== 'available') {
    throw new Error(classification.reason);
  }
  const namesToId = new Map();
  for (const system of collectScreenScraperSystems(JSON.parse(body))) {
    for (const name of Object.values(system.noms)) {
      const normalized = normalizedSystemName(name);
      if (normalized) namesToId.set(normalized, String(system.id));
    }
  }

  const ids = new Map();
  for (const system of requestedSystems) {
    const aliases = [system, ...(SCREEN_SCRAPER_SPECIAL_ALIASES[system] ?? [])];
    for (const alias of aliases) {
      const id = namesToId.get(normalizedSystemName(alias));
      if (id) {
        ids.set(system, id);
        break;
      }
    }
  }
  return ids;
}

function collectBox2dMedia(value, media = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectBox2dMedia(item, media);
    return media;
  }
  if (!value || typeof value !== 'object') return media;
  if (
    String(value.type ?? '').toLowerCase() === 'box-2d' &&
    typeof value.url === 'string' &&
    /^https:\/\//i.test(value.url)
  ) {
    media.push(value);
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      collectBox2dMedia(nested, media);
    }
  }
  return media;
}

function chooseBox2dUrl(parsed) {
  const regionOrder = ['us', 'wor', 'eu', 'ss', 'uk', 'jp'];
  return collectBox2dMedia(parsed).sort((left, right) => {
    const leftRank = regionOrder.indexOf(String(left.region ?? '').toLowerCase());
    const rightRank = regionOrder.indexOf(
      String(right.region ?? '').toLowerCase(),
    );
    return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
  })[0]?.url ?? null;
}

function cachedImageExtension(contentType, bytes) {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) {
    return '.png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return '.jpg';
  }
  return /png/i.test(contentType) ? '.png' : '.jpg';
}

function screenScraperCandidate(key, filename, bytes, via) {
  const dimensions = imageSizeFromHeader(bytes.subarray(0, 65536));
  return {
    source: `screenscraper:${key}`,
    localPath: filename,
    size: bytes.length,
    variant: 'box',
    via,
    dimensions,
    aspect: dimensions ? dimensions.w / dimensions.h : null,
  };
}

async function fetchScreenScraperCover(request, systemId, credentials, cache) {
  const key = shortHash(gameKey(request.game));
  const cached = cache.games[key];
  if (cached?.status === 'missing') return null;
  if (cached?.status === 'found' && cached.file) {
    const cachedFile = path.join(screenScraperCacheRoot, cached.file);
    if (await isNonEmptyFile(cachedFile)) {
      const bytes = await readFile(cachedFile);
      return screenScraperCandidate(key, cachedFile, bytes, 'screenscraper-cache');
    }
  }

  const parameters = screenScraperParameters(credentials);
  parameters.set('systemeid', systemId);
  const romName =
    request.game.path.replaceAll('\\', '/').split('/').pop() ||
    request.game.name;
  parameters.set('romnom', romName);
  const response = await fetchWithTimeout(
    `${SCREEN_SCRAPER_ENDPOINT}?${parameters}`,
  );
  const body = await response.text();
  const classification = classifyScreenScraperResponse(response.status, body);
  if (classification.state !== 'available') {
    throw new Error(classification.reason);
  }
  let mediaUrl = null;
  try {
    mediaUrl = chooseBox2dUrl(JSON.parse(body));
  } catch {
    // A valid no-result response is cached below.
  }
  if (!mediaUrl) {
    cache.games[key] = { status: 'missing' };
    await writeScreenScraperCache(cache);
    return null;
  }

  const mediaResponse = await fetchWithTimeout(mediaUrl, {}, 30_000);
  if (!mediaResponse.ok) {
    throw new Error(`box-2D media returned HTTP ${mediaResponse.status}`);
  }
  const bytes = Buffer.from(await mediaResponse.arrayBuffer());
  if (bytes.length === 0) throw new Error('box-2D media was empty');
  const extension = cachedImageExtension(
    mediaResponse.headers.get('content-type') ?? '',
    bytes,
  );
  const relative = path.join('images', `${key}${extension}`);
  const filename = path.join(screenScraperCacheRoot, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
  cache.games[key] = { status: 'found', file: relative };
  await writeScreenScraperCache(cache);
  return screenScraperCandidate(key, filename, bytes, 'screenscraper-api');
}

function screenScraperResult(state, reason, extra = {}) {
  return {
    state,
    reason,
    fetched: 0,
    cached: 0,
    missing: 0,
    unsupported: 0,
    bySystem: new Map(),
    ...extra,
  };
}

async function applyScreenScraperCovers(requests, selections) {
  const needingCovers = requests.filter(
    (request) => !selections.get(request.key)?.localBoxLike,
  );
  if (needingCovers.length === 0) {
    return screenScraperResult(
      'not-needed',
      'every included game had box-like local art',
    );
  }

  // Credentials are read on every run and are never written to the cache.
  const credentialResult = await fetchScreenScraperCredentials();
  if (!credentialResult.credentials) {
    return screenScraperResult(
      'credentials-unavailable',
      credentialResult.error,
    );
  }
  const cache = await readScreenScraperCache();
  const status = await preflightScreenScraper(
    credentialResult.credentials,
    cache,
  );
  if (status.state !== 'available') {
    return screenScraperResult(status.state, status.reason, {
      cachedStatus: status.cached,
    });
  }

  let systemIds;
  try {
    const systems = new Set(needingCovers.map((request) => request.system));
    systemIds = await fetchScreenScraperSystemIds(
      credentialResult.credentials,
      systems,
    );
  } catch (error) {
    return screenScraperResult(
      'api-rejected',
      `system lookup failed: ${error.message}`,
      { unsupported: needingCovers.length },
    );
  }

  let fetched = 0;
  let cached = 0;
  let missing = 0;
  let unsupported = 0;
  const bySystem = new Map();
  for (const request of needingCovers) {
    const systemId = systemIds.get(request.system);
    if (!systemId) {
      unsupported += 1;
      continue;
    }
    const cacheKey = shortHash(gameKey(request.game));
    const hadCached = Boolean(cache.games[cacheKey]);
    try {
      const cover = await fetchScreenScraperCover(
        request,
        systemId,
        credentialResult.credentials,
        cache,
      );
      if (cover) {
        const selection = selections.get(request.key);
        selection.cover = cover;
        if (!selection.screenshot) selection.screenshot = cover;
        selection.localBoxLike = true;
        selection.apiCover = true;
        if (hadCached) cached += 1;
        else fetched += 1;
        bySystem.set(request.system, (bySystem.get(request.system) ?? 0) + 1);
      } else {
        missing += 1;
      }
    } catch (error) {
      return screenScraperResult(
        'api-rejected',
        `box lookup stopped: ${error.message}`,
        { fetched, cached, missing, unsupported, bySystem },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return screenScraperResult(
    'available',
    'the API accepted requests without developer credentials',
    { fetched, cached, missing, unsupported, bySystem },
  );
}

function escapeScpRemotePath(value) {
  return value.replace(/([\\*?[\]])/g, '\\$1');
}

function safeArtExtension(source) {
  const extension = path.posix.extname(source).toLowerCase();
  return /^(?:\.gif|\.jpe?g|\.png|\.webp)$/.test(extension)
    ? extension
    : '.png';
}

async function normalizeCopiedArtExtension(entry) {
  const bytes = await readFile(entry.target);
  let extension = '';
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    extension = '.png';
  } else if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    extension = '.jpg';
  } else if (
    bytes.length >= 6 &&
    bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')
  ) {
    extension = '.gif';
  } else if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    extension = '.webp';
  }

  if (!extension || path.extname(entry.target).toLowerCase() === extension) {
    return;
  }
  const correctedTarget = `${entry.targetBase}${extension}`;
  await rename(entry.target, correctedTarget);
  entry.target = correctedTarget;
  entry.publicPath = `${entry.publicBase}${extension}`;
}

function quoteSftpPath(value) {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\"')
    .replace(/([*?[\]])/g, '\\$1')}"`;
}

function copySystemRemoteMedia(system, entries) {
  const remoteSystemRoot = `/${REMOTE_ROOT_WINDOWS.replaceAll('\\', '/')}/${system}`;
  const commands = entries
    .map(({ source, target }) => {
      const remotePath = `${remoteSystemRoot}/${source}`;
      const localPath = target.replaceAll('\\', '/');
      return `-get ${quoteSftpPath(remotePath)} ${quoteSftpPath(localPath)}`;
    })
    .concat('quit')
    .join('\n');

  return new Promise((resolve) => {
    const child = spawn('sftp', ['-q', '-b', '-', REMOTE], {
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
    child.on('close', async (code) => {
      for (const entry of entries) {
        if (await isNonEmptyFile(entry.target)) continue;
        if (!/[*?[\]]/.test(entry.source)) continue;
        const remotePath = `${REMOTE_ROOT_SCP}/${system}/${entry.source}`;
        await spawnResult('scp', [
          '-q',
          `${REMOTE}:${escapeScpRemotePath(remotePath)}`,
          entry.target,
        ]);
      }

      let copied = 0;
      let copiedBytes = 0;
      let videoCopied = 0;
      let videoBytes = 0;
      let failed = 0;
      for (const entry of entries) {
        if (await isNonEmptyFile(entry.target)) {
          if (entry.kind === 'image') {
            await normalizeCopiedArtExtension(entry);
          }
          const details = await stat(entry.target);
          for (const field of entry.assignFields) {
            entry.game[field] = entry.publicPath;
          }
          copied += 1;
          copiedBytes += details.size;
          if (entry.kind === 'video') {
            videoCopied += 1;
            videoBytes += details.size;
          }
        } else {
          failed += 1;
        }
      }
      const complete = failed === 0 && !spawnError;
      resolve({
        complete,
        copied,
        copiedBytes,
        videoCopied,
        videoBytes,
        failed,
        error: complete
          ? ''
          : cleanProcessError({ code, error: spawnError, stderr, stdout }),
      });
    });
    child.stdin.on('error', () => {
      // The close handler reports the useful SFTP error.
    });
    child.stdin.end(`${commands}\n`, 'utf8');
  });
}

function chooseVideoKeys(requests, selections) {
  const bySystem = new Map();
  for (const request of requests) {
    if (!selections.get(request.key)?.video) continue;
    const entries = bySystem.get(request.system) ?? [];
    entries.push(request);
    bySystem.set(request.system, entries);
  }
  const keys = new Set();
  for (const entries of bySystem.values()) {
    for (const request of entries.slice(0, VIDEO_LIMIT_PER_SYSTEM)) {
      keys.add(request.key);
    }
  }
  return keys;
}

function mediaIdentity(candidate) {
  if (!candidate) return '';
  return candidate.localPath
    ? `local:${candidate.localPath}`
    : `remote:${candidate.source}`;
}

function imageCopyEntry(request, candidate, role, assignFields) {
  const extension = candidate.localPath
    ? safeArtExtension(candidate.localPath)
    : safeArtExtension(candidate.source);
  const isCover = role === 'cover';
  const targetBase = isCover
    ? request.coverTargetBase
    : request.screenshotTargetBase;
  const publicBase = isCover
    ? request.coverPublicBase
    : request.screenshotPublicBase;
  return {
    kind: 'image',
    source: candidate.source,
    localPath: candidate.localPath ?? null,
    targetBase,
    publicBase,
    target: `${targetBase}${extension}`,
    publicPath: `${publicBase}${extension}`,
    assignFields,
    game: request.game,
  };
}

async function copyMediaAssets(requests, selections, videoKeys) {
  const remoteBySystem = new Map();
  const localEntries = [];
  let missing = 0;
  for (const request of requests) {
    const selection = selections.get(request.key);
    const cover = selection?.cover ?? selection?.screenshot ?? null;
    const screenshot = selection?.screenshot ?? selection?.cover ?? null;
    const imageEntries = [];
    if (cover && mediaIdentity(cover) === mediaIdentity(screenshot)) {
      imageEntries.push(
        imageCopyEntry(request, cover, 'cover', ['art', 'screenshot']),
      );
    } else {
      if (cover) {
        imageEntries.push(imageCopyEntry(request, cover, 'cover', ['art']));
      }
      if (screenshot) {
        imageEntries.push(
          imageCopyEntry(request, screenshot, 'screenshot', ['screenshot']),
        );
      }
    }
    if (imageEntries.length === 0) missing += 1;

    if (videoKeys.has(request.key) && selection?.video) {
      imageEntries.push({
        kind: 'video',
        source: selection.video.source,
        localPath: null,
        target: request.videoTarget,
        publicPath: request.videoPublicPath,
        assignFields: ['video'],
        game: request.game,
      });
    }
    for (const entry of imageEntries) {
      if (entry.localPath) {
        localEntries.push(entry);
      } else {
        const entries = remoteBySystem.get(request.system) ?? [];
        entries.push(entry);
        remoteBySystem.set(request.system, entries);
      }
    }
  }

  let copied = 0;
  let copiedBytes = 0;
  let videoCopied = 0;
  let videoBytes = 0;
  let failed = 0;
  for (const entry of localEntries) {
    try {
      await copyFile(entry.localPath, entry.target);
      await normalizeCopiedArtExtension(entry);
      const details = await stat(entry.target);
      for (const field of entry.assignFields) {
        entry.game[field] = entry.publicPath;
      }
      copied += 1;
      copiedBytes += details.size;
    } catch (error) {
      failed += 1;
      console.warn(`[art] Cached cover copy failed (${error.message})`);
    }
  }

  const systemBatches = [...remoteBySystem.entries()];
  let cursor = 0;
  const worker = async () => {
    while (cursor < systemBatches.length) {
      const batchIndex = cursor;
      cursor += 1;
      const [system, entries] = systemBatches[batchIndex];
      const result = await copySystemRemoteMedia(system, entries);
      copied += result.copied;
      copiedBytes += result.copiedBytes;
      videoCopied += result.videoCopied;
      videoBytes += result.videoBytes;
      failed += result.failed;
      if (!result.complete) {
        console.warn(`[media] ${system}: stream warning (${result.error})`);
      }
      console.log(
        `[media] ${system}: copied ${result.copied}, failed ${result.failed}`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, systemBatches.length) }, () => worker()),
  );

  for (const request of requests) {
    const { game } = request;
    if (!game.art && game.screenshot) game.art = game.screenshot;
    if (!game.screenshot && game.art) game.screenshot = game.art;
  }
  return {
    copied,
    copiedBytes,
    imageCopied: copied - videoCopied,
    videoCopied,
    videoBytes,
    failed,
    missing,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function resolvedArtBytes(
  requests,
  selections,
  limit = Number.POSITIVE_INFINITY,
) {
  return requests.reduce((total, request) => {
    if (request.gameIndex >= limit) return total;
    const selection = selections.get(request.key);
    const candidates = [selection?.cover, selection?.screenshot].filter(Boolean);
    const seen = new Set();
    for (const candidate of candidates) {
      const identity = mediaIdentity(candidate);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const size = Number(candidate.size);
      if (Number.isFinite(size) && size > 0) total += size;
    }
    return total;
  }, 0);
}

function capForArtBudget(requests, selections) {
  for (let limit = GAME_LIMIT; limit >= 1; limit -= 1) {
    if (resolvedArtBytes(requests, selections, limit) <= ART_SIZE_LIMIT) {
      return limit;
    }
  }
  return 1;
}

async function directoryStats(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryStats(filename);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(filename)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function replaceGeneratedDirectory(source, destination) {
  await mkdir(destination, { recursive: true });

  const sourceNames = new Set(await readdir(source));
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (!sourceNames.has(entry.name)) {
      await rm(path.join(destination, entry.name), {
        force: true,
        recursive: entry.isDirectory(),
      });
    }
  }

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await replaceGeneratedDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function copyMappedThemeAssets(consoleIds, remoteDirectory, extension, outputRoot) {
  const matched = [];
  const unmatched = [];
  const mappings = [];
  for (const id of [...consoleIds].sort((left, right) => left.localeCompare(right, 'en'))) {
    const sourceId = THEME_SYSTEM_FILE_MAP[id];
    if (!sourceId) {
      unmatched.push(id);
      continue;
    }
    mappings.push({ id, sourceId });
  }

  await mkdir(outputRoot, { recursive: true });
  const downloadRoot = await mkdtemp(
    path.join(tmpdir(), `linuxmachine-${remoteDirectory}-`),
  );
  try {
    const uniqueSources = [...new Set(mappings.map(({ sourceId }) => sourceId))];
    const remoteSources = uniqueSources.map(
      (sourceId) =>
        `${REMOTE}:${escapeScpRemotePath(`${REMOTE_THEME_ART_SCP}/${remoteDirectory}/${sourceId}.${extension}`)}`,
    );
    const result = await spawnResult('scp', ['-q', ...remoteSources, downloadRoot]);
    if (result.code !== 0 || result.error) {
      console.warn(
        `[theme] ${remoteDirectory}: SCP warning (${cleanProcessError(result)})`,
      );
    }

    for (const mapping of mappings) {
      const source = path.join(
        downloadRoot,
        `${mapping.sourceId}.${extension}`,
      );
      if (!(await isNonEmptyFile(source))) {
        unmatched.push(mapping.id);
        continue;
      }
      await copyFile(source, path.join(outputRoot, `${mapping.id}.${extension}`));
      matched.push(mapping);
    }
  } finally {
    await rm(downloadRoot, { force: true, recursive: true });
  }

  return { matched, unmatched };
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
  const existing = await readExistingLibrary();
  const baselineMissing = baselineMissingGameKeys(existing);
  const runRoot = await mkdtemp(path.join(scriptDirectory, '.library-import-'));
  const stagedArtRoot = path.join(runRoot, 'art');
  const stagedVideoRoot = path.join(runRoot, 'game-video');
  const stagedConsoleRoot = path.join(runRoot, 'console-art');
  const stagedControllerRoot = path.join(runRoot, 'controller-art');
  await mkdir(stagedArtRoot, { recursive: true });
  await mkdir(stagedVideoRoot, { recursive: true });

  try {
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
    let includedGameCount = systems.reduce(
      (total, system) => total + system.games.length,
      0,
    );

    console.log(
      `[media] Inspecting every local PNG/JPEG variant for ${includedGameCount.toLocaleString()} included games...`,
    );
    const media = await buildMediaRequests(
      systems,
      stagedArtRoot,
      stagedVideoRoot,
    );
    const resolved = await resolveRemoteMedia(media.requests);
    if (!resolved.complete) {
      throw new Error(`Remote media inventory ended early: ${resolved.error}`);
    }
    const resolvedCount = [...resolved.choices.values()].filter(
      (choice) => choice.candidates.length > 0,
    ).length;
    console.log(
      `[media] Local image matches: ${resolvedCount.toLocaleString()} found, ${(media.requests.length - resolvedCount).toLocaleString()} absent.`,
    );
    if (media.requests.length > 0 && resolvedCount === 0) {
      throw new Error('Remote media inventory returned no image matches');
    }

    const measuredAspects = await readMeasuredAspects();
    const selected = selectLocalMedia(
      media.requests,
      resolved.choices,
      measuredAspects,
    );
    let effectiveGameLimit = capForArtBudget(
      media.requests,
      selected.selections,
    );
    if (effectiveGameLimit < GAME_LIMIT) {
      console.warn(
        `[art] Projected art exceeded ${formatBytes(ART_SIZE_LIMIT)}; lowering the per-system cap from ${GAME_LIMIT} to ${effectiveGameLimit}.`,
      );
      for (const system of systems) {
        system.games = system.games.slice(0, effectiveGameLimit);
      }
      includedGameCount = systems.reduce(
        (total, system) => total + system.games.length,
        0,
      );
    }
    const selectedRequests = media.requests.filter(
      (request) => request.gameIndex < effectiveGameLimit,
    );
    const screenScraper = await applyScreenScraperCovers(
      selectedRequests,
      selected.selections,
    );
    const projectedBytes = resolvedArtBytes(
      selectedRequests,
      selected.selections,
    );
    console.log(
      `[art] Preflight: ${formatBytes(projectedBytes)} across ${selectedRequests.length.toLocaleString()} included games (cap ${effectiveGameLimit}/system).`,
    );

    const videoKeys = chooseVideoKeys(selectedRequests, selected.selections);
    const mediaResult = await copyMediaAssets(
      selectedRequests,
      selected.selections,
      videoKeys,
    );
    if (mediaResult.failed > 0) {
      throw new Error(`${mediaResult.failed} media file(s) failed to copy`);
    }

    let consoleAssets = { matched: [], unmatched: [] };
    let controllerAssets = { matched: [], unmatched: [] };
    if (IMPORT_THEME_ASSETS) {
      const consoleIds = new Set(
        systems
          .filter((system) => system.games.length > 0)
          .map((system) => SHELL_PLATFORM_ID_MAP[system.id] ?? system.id),
      );
      consoleAssets = await copyMappedThemeAssets(
        consoleIds,
        'consoles',
        'png',
        stagedConsoleRoot,
      );
      controllerAssets = await copyMappedThemeAssets(
        consoleIds,
        'controllers',
        'svg',
        stagedControllerRoot,
      );
    }

    const stagedArtStats = await directoryStats(stagedArtRoot);
    const stagedVideoStats = await directoryStats(stagedVideoRoot);
    if (stagedArtStats.bytes > ART_SIZE_LIMIT) {
      throw new Error(
        `Staged art is ${formatBytes(stagedArtStats.bytes)}, above the ${formatBytes(ART_SIZE_LIMIT)} limit`,
      );
    }

    await replaceGeneratedDirectory(stagedArtRoot, artRoot);
    await replaceGeneratedDirectory(stagedVideoRoot, gameVideoRoot);
    if (IMPORT_THEME_ASSETS) {
      await replaceGeneratedDirectory(stagedConsoleRoot, consoleArtRoot);
      await replaceGeneratedDirectory(
        stagedControllerRoot,
        controllerArtRoot,
      );
    }
    await writeLibrary(systems);

    const recovery = baselineRecovery(baselineMissing, systems);
    const consoleMappings = consoleAssets.matched
      .map(({ id, sourceId }) => `${id}<-${sourceId}.png`)
      .join(', ');
    const controllerMappings = controllerAssets.matched
      .map(({ id, sourceId }) => `${id}<-${sourceId}.svg`)
      .join(', ');
    const variantResults = new Map();
    for (const request of selectedRequests) {
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
      const apiAdded = screenScraper.bySystem.get(system) ?? 0;
      console.log(
        `[variants] ${system}: changed ${result.changed}/${result.games}; local box-like ${result.boxLike}, fallback ${result.fallback}, API covers ${apiAdded}`,
      );
    }
    console.log(
      `[screenscraper] ${screenScraper.state}: ${screenScraper.reason}; fetched ${screenScraper.fetched}, cache hits ${screenScraper.cached}`,
    );

    console.log(`[done] Wrote ${path.relative(repositoryRoot, outputPath)}`);
    console.log(
      `[done] ${systems.length} systems, ${trueGameCount.toLocaleString()} true games, ${includedGameCount.toLocaleString()} included; cap ${effectiveGameLimit}/system`,
    );
    console.log(
      `[done] Images: ${mediaResult.imageCopied.toLocaleString()} copied, ${mediaResult.missing.toLocaleString()} unavailable, ${stagedArtStats.files.toLocaleString()} files / ${formatBytes(stagedArtStats.bytes)}`,
    );
    console.log(
      `[done] Videos: ${mediaResult.videoCopied.toLocaleString()} copied (cap ${VIDEO_LIMIT_PER_SYSTEM}/system), ${stagedVideoStats.files.toLocaleString()} files / ${formatBytes(stagedVideoStats.bytes)}`,
    );
    console.log(
      `[done] Previous missing-art set: ${recovery.recovered.toLocaleString()} recovered, ${recovery.absent.toLocaleString()} genuinely absent (${recovery.total.toLocaleString()} checked)`,
    );
    if (IMPORT_THEME_ASSETS) {
      console.log(
        `[done] Console images matched (${consoleAssets.matched.length}): ${consoleMappings || 'none'}`,
      );
      console.log(
        `[done] Console images unmatched (${consoleAssets.unmatched.length}): ${consoleAssets.unmatched.join(', ') || 'none'}`,
      );
      console.log(
        `[done] Controller images matched (${controllerAssets.matched.length}): ${controllerMappings || 'none'}`,
      );
      console.log(
        `[done] Controller images unmatched (${controllerAssets.unmatched.length}): ${controllerAssets.unmatched.join(', ') || 'none'}`,
      );
    }
  } finally {
    await rm(runRoot, {
      force: true,
      recursive: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exitCode = 1;
});
