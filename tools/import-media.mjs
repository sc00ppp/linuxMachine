#!/usr/bin/env node

/**
 * Import the read-only Kodi collection from the media PC.
 *
 * There are deliberately no npm dependencies here. The remote machine's
 * default SSH shell is cmd.exe, so the inventory is sent as a UTF-16LE
 * PowerShell EncodedCommand. Only local generated metadata and poster files
 * are written; the media PC is never modified.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const execFile = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const generatedPath = path.join(
  projectRoot,
  'shell',
  'src',
  'core',
  'media.generated.json',
);
const artDirectory = path.join(projectRoot, 'shell', 'public', 'media-art');

const remote = process.env.MEDIA_SSH ?? 'david@192.168.1.158';
const sshBinary =
  process.env.MEDIA_SSH_BIN ??
  (process.platform === 'win32'
    ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    : 'ssh');
const scpBinary =
  process.env.MEDIA_SCP_BIN ??
  (process.platform === 'win32'
    ? 'C:\\Windows\\System32\\OpenSSH\\scp.exe'
    : 'scp');

const remoteInventoryScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$tvRoot = 'S:\Kodi\Collection\TV Shows'
$movieRoot = 'S:\Kodi\Collection\Movies'
$videoExtensions = @(
  '.3gp', '.avi', '.divx', '.flv', '.iso', '.m2ts', '.m4v', '.mkv',
  '.mov', '.mp4', '.mpeg', '.mpg', '.mts', '.ogm', '.ts', '.vob',
  '.webm', '.wmv'
)

function Get-VideoFiles([string] $root) {
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    return @()
  }

  return @(
    Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $videoExtensions -contains $_.Extension.ToLowerInvariant() }
  )
}

function Get-FirstArtwork([string] $directory, [string] $stem) {
  $candidates = @()
  if ($stem) {
    $candidates += @(
      "$stem-poster.jpg",
      "$stem-poster.jpeg",
      "$stem.jpg",
      "$stem.jpeg"
    )
  }
  $candidates += @(
    'poster.jpg',
    'poster.jpeg',
    'folder.jpg',
    'folder.jpeg',
    'fanart.jpg',
    'fanart.jpeg'
  )

  foreach ($name in $candidates) {
    $candidate = Join-Path $directory $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }
  return $null
}

function Get-SeasonNumber([System.IO.FileInfo] $file, [string] $seriesRoot) {
  $relativeDirectory = $file.DirectoryName.Substring($seriesRoot.Length).TrimStart('\')
  foreach ($segment in ($relativeDirectory -split '\\')) {
    if ($segment -match '(?i)^specials?$') { return 0 }
    if ($segment -match '(?i)^season[\s._-]*(\d{1,3})') {
      return [int] $Matches[1]
    }
  }

  if ($file.BaseName -match '(?i)S(\d{1,3})E\d{1,4}') {
    return [int] $Matches[1]
  }
  if ($file.BaseName -match '(?i)(\d{1,3})x\d{1,4}') {
    return [int] $Matches[1]
  }
  # A show with episodes directly in its root is overwhelmingly a first
  # season. Explicit Specials folders and S0Exx names still map to 0.
  return 1
}

function Get-EpisodeNumber([string] $baseName) {
  if ($baseName -match '(?i)S\d{1,3}E(\d{1,4})') {
    return [int] $Matches[1]
  }
  if ($baseName -match '(?i)\d{1,3}x(\d{1,4})') {
    return [int] $Matches[1]
  }
  if ($baseName -match '(?i)(?:^|[\s._-])E(\d{1,4})(?:$|[\s._-])') {
    return [int] $Matches[1]
  }
  return $null
}

$series = @()
if (Test-Path -LiteralPath $tvRoot -PathType Container) {
  foreach ($seriesDirectory in @(
    Get-ChildItem -LiteralPath $tvRoot -Directory -ErrorAction Stop |
      Sort-Object Name
  )) {
    $files = @(Get-VideoFiles $seriesDirectory.FullName)
    $episodeRows = @(
      foreach ($file in $files) {
        [pscustomobject] @{
          Season = Get-SeasonNumber $file $seriesDirectory.FullName
          Episode = Get-EpisodeNumber $file.BaseName
          FileName = $file.Name
          SizeBytes = [int64] $file.Length
        }
      }
    )

    $seasons = @(
      foreach ($group in @($episodeRows | Group-Object Season | Sort-Object { [int] $_.Name })) {
        $episodes = @(
          $group.Group |
            Sort-Object @{ Expression = { if ($null -eq $_.Episode) { [int]::MaxValue } else { $_.Episode } } },
                        FileName
        )
        [pscustomobject] @{
          Number = [int] $group.Name
          EpisodeCount = $episodes.Count
          TotalBytes = [int64] (($episodes | Measure-Object SizeBytes -Sum).Sum)
          Episodes = $episodes
        }
      }
    )

    $series += [pscustomobject] @{
      Title = $seriesDirectory.Name
      EpisodeCount = $episodeRows.Count
      TotalBytes = [int64] (($episodeRows | Measure-Object SizeBytes -Sum).Sum)
      PosterSource = Get-FirstArtwork $seriesDirectory.FullName $null
      Seasons = $seasons
    }
  }
}

$movies = @()
foreach ($file in @(Get-VideoFiles $movieRoot)) {
  $movies += [pscustomobject] @{
    FileName = $file.Name
    BaseName = $file.BaseName
    ParentName = $file.Directory.Name
    SizeBytes = [int64] $file.Length
    PosterSource = Get-FirstArtwork $file.DirectoryName $file.BaseName
  }
}

[pscustomobject] @{
  Series = $series
  Movies = $movies
} | ConvertTo-Json -Depth 9 -Compress
`;

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug) return slug;
  return `media-${createHash('sha1').update(value).digest('hex').slice(0, 10)}`;
}

function uniqueSlug(title, used) {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function cleanEpisodeTitle(fileName, seriesTitle, episodeNumber, fallbackNumber) {
  const extension = path.extname(fileName);
  let title = fileName.slice(0, extension ? -extension.length : undefined);
  title = title
    .replace(/S\d{1,3}E\d{1,4}(?:E\d{1,4})*|\d{1,3}x\d{1,4}|(?:^|[\s._-])E\d{1,4}(?=$|[\s._-])/i, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const seriesBase = seriesTitle.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim();
  if (
    title.localeCompare(seriesTitle, undefined, { sensitivity: 'base' }) === 0 ||
    title.localeCompare(seriesBase, undefined, { sensitivity: 'base' }) === 0
  ) {
    title = '';
  } else if (title.toLocaleLowerCase().startsWith(`${seriesBase.toLocaleLowerCase()} `)) {
    title = title.slice(seriesBase.length).replace(/^[\s–—-]+/, '');
  }

  if (/^\((?:19|20)\d{2}\)$/.test(title)) title = '';
  return title || `Episode ${episodeNumber ?? fallbackNumber}`;
}

function movieIdentity(row) {
  const genericFileName = /^(?:movie|video|title\d*)$/i.test(row.BaseName);
  const rawTitle = genericFileName ? row.ParentName : row.BaseName;
  const parenthesizedYears = [
    ...rawTitle.matchAll(/\(((?:19|20)\d{2})\)/g),
  ];
  const bareYears = [
    ...rawTitle.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g),
  ];
  const yearMatch = parenthesizedYears.at(-1) ?? bareYears.at(-1) ?? null;
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const withoutYear = yearMatch
    ? `${rawTitle.slice(0, yearMatch.index)} ${rawTitle.slice(
        (yearMatch.index ?? 0) + yearMatch[0].length,
      )}`
    : rawTitle;
  const title = withoutYear
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s()[\]-]+|[\s()[\]-]+$/g, '')
    .trim();
  return { title: title || rawTitle, year };
}

function parseInventory(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('The media PC returned no JSON inventory.');
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

async function runInventory() {
  // A direct EncodedCommand of the inventory exceeds cmd.exe's 8191-character
  // command line. Gzip shrinks the payload; this tiny encoded bootstrap
  // expands it entirely in memory and executes it. Nothing is staged remotely.
  const compressed = gzipSync(Buffer.from(remoteInventoryScript, 'utf8'), {
    level: 9,
  }).toString('base64');
  const bootstrap =
    `$b=[Convert]::FromBase64String('${compressed}');` +
    '$m=New-Object IO.MemoryStream(,$b);' +
    '$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);' +
    '$r=New-Object IO.StreamReader($g);' +
    '&([scriptblock]::Create($r.ReadToEnd()))';
  const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64');

  try {
    const { stdout } = await execFile(
      sshBinary,
      [
        remote,
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encoded,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return parseInventory(stdout);
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr).trim()
        : String(error);
    throw new Error(`Remote Kodi inventory failed: ${detail || 'unknown SSH error'}`);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function remoteScpPath(remotePath) {
  // OpenSSH's SFTP-backed scp accepts a Windows drive path with forward
  // slashes. Passing this as one execFile argument preserves spaces and
  // apostrophes without shell quoting.
  return `${remote}:${remotePath.replaceAll('\\', '/')}`;
}

async function copyPoster(source, slug, counters) {
  if (!source) return null;

  const destination = path.join(artDirectory, `${slug}.jpg`);
  if (await exists(destination)) {
    counters.postersSkipped += 1;
    return `/media-art/${slug}.jpg`;
  }

  const partial = `${destination}.part`;
  await fs.rm(partial, { force: true });
  try {
    await execFile(scpBinary, ['-q', remoteScpPath(source), partial], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    await fs.rename(partial, destination);
    counters.postersCopied += 1;
    return `/media-art/${slug}.jpg`;
  } catch (error) {
    counters.posterFailures += 1;
    await fs.rm(partial, { force: true });
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr).trim()
        : String(error);
    console.warn(`Poster copy failed for ${source}: ${detail}`);
    return null;
  }
}

async function buildCatalog(inventory) {
  const usedSlugs = new Set();
  const counters = {
    postersCopied: 0,
    postersSkipped: 0,
    posterFailures: 0,
  };

  const series = [];
  for (const row of inventory.Series ?? []) {
    const id = uniqueSlug(String(row.Title), usedSlugs);
    const poster = await copyPoster(row.PosterSource, id, counters);
    const seasons = (row.Seasons ?? []).map((season) => {
      const number = Number(season.Number);
      const episodes = (season.Episodes ?? []).map((episode, index) => {
        const episodeNumber =
          episode.Episode === null || episode.Episode === undefined
            ? null
            : Number(episode.Episode);
        const ordinal = episodeNumber ?? index + 1;
        return {
          id: `${id}-s${String(number).padStart(2, '0')}-e${String(ordinal).padStart(3, '0')}-${index + 1}`,
          title: cleanEpisodeTitle(
            String(episode.FileName),
            String(row.Title),
            episodeNumber,
            index + 1,
          ),
          fileName: String(episode.FileName),
          episodeNumber,
          sizeBytes: Number(episode.SizeBytes),
        };
      });

      return {
        number,
        title: number === 0 ? 'Specials' : `Season ${number}`,
        episodeCount: Number(season.EpisodeCount),
        totalBytes: Number(season.TotalBytes),
        episodes,
      };
    });

    series.push({
      id,
      title: String(row.Title),
      seasons,
      episodeCount: Number(row.EpisodeCount),
      totalBytes: Number(row.TotalBytes),
      poster,
    });
  }

  const movies = [];
  for (const row of inventory.Movies ?? []) {
    const identity = movieIdentity(row);
    const id = uniqueSlug(identity.title, usedSlugs);
    const poster = await copyPoster(row.PosterSource, id, counters);
    movies.push({
      id,
      title: identity.title,
      year: identity.year,
      fileName: String(row.FileName),
      sizeBytes: Number(row.SizeBytes),
      poster,
    });
  }

  return {
    catalog: {
      generatedAt: new Date().toISOString(),
      series,
      movies,
    },
    counters,
  };
}

async function writeCatalog(catalog) {
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  const partial = `${generatedPath}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await fs.rename(partial, generatedPath);
}

async function main() {
  await fs.mkdir(artDirectory, { recursive: true });
  console.log(`Reading Kodi library from ${remote} (read-only)…`);
  const inventory = await runInventory();
  const { catalog, counters } = await buildCatalog(inventory);
  await writeCatalog(catalog);

  const episodeCount = catalog.series.reduce(
    (total, item) => total + item.episodeCount,
    0,
  );
  const totalBytes =
    catalog.series.reduce((total, item) => total + item.totalBytes, 0) +
    catalog.movies.reduce((total, item) => total + item.sizeBytes, 0);

  console.log(`Series: ${catalog.series.length}`);
  console.log(`Episodes: ${episodeCount}`);
  console.log(`Movies: ${catalog.movies.length}`);
  console.log(`Media bytes: ${totalBytes}`);
  console.log(`Posters copied: ${counters.postersCopied}`);
  console.log(`Posters already present: ${counters.postersSkipped}`);
  console.log(`Poster copy failures: ${counters.posterFailures}`);
  console.log(`Wrote ${path.relative(projectRoot, generatedPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
