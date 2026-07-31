#!/usr/bin/env node

/**
 * Import the read-only Kodi collection from the media PC.
 *
 * There are deliberately no npm dependencies here. The remote machine's
 * default SSH shell is cmd.exe, so the inventory is sent as a UTF-16LE
 * PowerShell EncodedCommand. Only local generated metadata and artwork files
 * are written; the media PC is never modified.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ReadOnlySqlite as SharedReadOnlySqlite } from './sqlite.mjs';

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
const episodeThumbDirectory = path.join(
  projectRoot,
  'shell',
  'public',
  'episode-thumbs',
);
const episodeThumbCachePath = path.join(episodeThumbDirectory, '.cache.json');

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
$kodiUserdata = Join-Path $env:APPDATA 'Kodi\userdata'
$kodiDatabase = Join-Path $kodiUserdata 'Database'
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
          MediaPath = $file.FullName
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
  }
}

[pscustomobject] @{
  KodiUserdata = $kodiUserdata
  VideoDatabase = @(
    Get-ChildItem -LiteralPath $kodiDatabase -File -Filter 'MyVideos*.db' |
      Sort-Object @{ Expression = {
        if ($_.BaseName -match '(\d+)$') { [int] $Matches[1] } else { 0 }
      }; Descending = $true }
  )[0].Name
  TextureDatabase = @(
    Get-ChildItem -LiteralPath $kodiDatabase -File -Filter 'Textures*.db' |
      Sort-Object @{ Expression = {
        if ($_.BaseName -match '(\d+)$') { [int] $Matches[1] } else { 0 }
      }; Descending = $true }
  )[0].Name
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

/**
 * Neither import machine has a sqlite3 executable. This reader implements
 * only the read-only SQLite pieces Kodi needs here: table b-trees, overflow
 * payloads, records, varints, and scalar serial types. It does not implement
 * SQL and never mutates pages.
 */
class ReadOnlySqlite {
  constructor(buffer, label) {
    this.buffer = buffer;
    this.label = label;
    if (buffer.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
      throw new Error(`${label} is not a SQLite 3 database.`);
    }

    const encodedPageSize = buffer.readUInt16BE(16);
    this.pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
    this.usableSize = this.pageSize - buffer[20];
    this.textEncoding = buffer.readUInt32BE(56) || 1;
    this.tables = new Map();

    for (const { values } of this.readBtree(1)) {
      if (values[0] !== 'table' || !values[1] || !values[3]) continue;
      this.tables.set(String(values[1]), Number(values[3]));
    }
  }

  static async open(filePath) {
    return new ReadOnlySqlite(await fs.readFile(filePath), path.basename(filePath));
  }

  table(name) {
    const rootPage = this.tables.get(name);
    if (!rootPage) throw new Error(`${this.label} has no ${name} table.`);
    return this.readBtree(rootPage);
  }

  page(pageNumber) {
    const start = (pageNumber - 1) * this.pageSize;
    const end = start + this.pageSize;
    if (pageNumber < 1 || end > this.buffer.length) {
      throw new Error(`${this.label} references invalid page ${pageNumber}.`);
    }
    return this.buffer.subarray(start, end);
  }

  readVarint(buffer, start) {
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      const byte = buffer[start + index];
      value = (value << 7n) | BigInt(byte & 0x7f);
      if ((byte & 0x80) === 0) return [Number(value), index + 1];
    }
    value = (value << 8n) | BigInt(buffer[start + 8]);
    return [Number(value), 9];
  }

  readSignedInteger(buffer, start, byteCount) {
    let value = 0n;
    for (let index = 0; index < byteCount; index += 1) {
      value = (value << 8n) | BigInt(buffer[start + index]);
    }
    const bits = BigInt(byteCount * 8);
    if (value & (1n << (bits - 1n))) value -= 1n << bits;
    return Number(value);
  }

  decodeText(bytes) {
    if (this.textEncoding === 2) return bytes.toString('utf16le');
    if (this.textEncoding === 3) {
      const swapped = Buffer.allocUnsafe(bytes.length);
      for (let index = 0; index < bytes.length; index += 2) {
        swapped[index] = bytes[index + 1];
        swapped[index + 1] = bytes[index];
      }
      return swapped.toString('utf16le');
    }
    return bytes.toString('utf8');
  }

  decodeRecord(payload) {
    const [headerSize, headerVarintSize] = this.readVarint(payload, 0);
    const serialTypes = [];
    let headerOffset = headerVarintSize;
    while (headerOffset < headerSize) {
      const [serialType, length] = this.readVarint(payload, headerOffset);
      serialTypes.push(serialType);
      headerOffset += length;
    }

    let valueOffset = headerSize;
    return serialTypes.map((serialType) => {
      if (serialType === 0) return null;
      if (serialType >= 1 && serialType <= 6) {
        const byteCount = [0, 1, 2, 3, 4, 6, 8][serialType];
        const value = this.readSignedInteger(payload, valueOffset, byteCount);
        valueOffset += byteCount;
        return value;
      }
      if (serialType === 7) {
        const value = payload.readDoubleBE(valueOffset);
        valueOffset += 8;
        return value;
      }
      if (serialType === 8) return 0;
      if (serialType === 9) return 1;
      if (serialType === 10 || serialType === 11) {
        throw new Error(`${this.label} contains a reserved SQLite serial type.`);
      }

      const byteCount =
        serialType % 2 === 0
          ? (serialType - 12) / 2
          : (serialType - 13) / 2;
      const bytes = payload.subarray(valueOffset, valueOffset + byteCount);
      valueOffset += byteCount;
      return serialType % 2 === 0 ? Buffer.from(bytes) : this.decodeText(bytes);
    });
  }

  readCellPayload(pageBuffer, cellOffset, payloadSize, cellHeaderSize) {
    const maxLocal = this.usableSize - 35;
    let localSize = payloadSize;
    if (payloadSize > maxLocal) {
      const minLocal = Math.floor(((this.usableSize - 12) * 32) / 255) - 23;
      const candidate =
        minLocal + ((payloadSize - minLocal) % (this.usableSize - 4));
      localSize = candidate <= maxLocal ? candidate : minLocal;
    }

    const chunks = [
      pageBuffer.subarray(
        cellOffset + cellHeaderSize,
        cellOffset + cellHeaderSize + localSize,
      ),
    ];
    let remaining = payloadSize - localSize;
    let overflowPage =
      remaining > 0
        ? pageBuffer.readUInt32BE(cellOffset + cellHeaderSize + localSize)
        : 0;

    while (remaining > 0) {
      const overflow = this.page(overflowPage);
      overflowPage = overflow.readUInt32BE(0);
      const chunkSize = Math.min(remaining, this.usableSize - 4);
      chunks.push(overflow.subarray(4, 4 + chunkSize));
      remaining -= chunkSize;
    }

    return Buffer.concat(chunks, payloadSize);
  }

  readBtree(rootPage) {
    const rows = [];
    const visited = new Set();
    const walk = (pageNumber) => {
      if (visited.has(pageNumber)) {
        throw new Error(`${this.label} contains a cyclic b-tree.`);
      }
      visited.add(pageNumber);

      const pageBuffer = this.page(pageNumber);
      const base = pageNumber === 1 ? 100 : 0;
      const type = pageBuffer[base];
      const cellCount = pageBuffer.readUInt16BE(base + 3);
      const headerSize = type === 0x05 ? 12 : 8;

      if (type === 0x05) {
        for (let index = 0; index < cellCount; index += 1) {
          const cellOffset = pageBuffer.readUInt16BE(
            base + headerSize + index * 2,
          );
          walk(pageBuffer.readUInt32BE(cellOffset));
        }
        walk(pageBuffer.readUInt32BE(base + 8));
        return;
      }

      if (type !== 0x0d) {
        throw new Error(
          `${this.label} uses unsupported b-tree page type 0x${type.toString(16)}.`,
        );
      }

      for (let index = 0; index < cellCount; index += 1) {
        const cellOffset = pageBuffer.readUInt16BE(
          base + headerSize + index * 2,
        );
        const [payloadSize, payloadVarintSize] = this.readVarint(
          pageBuffer,
          cellOffset,
        );
        const [rowid, rowidVarintSize] = this.readVarint(
          pageBuffer,
          cellOffset + payloadVarintSize,
        );
        const cellHeaderSize = payloadVarintSize + rowidVarintSize;
        const payload = this.readCellPayload(
          pageBuffer,
          cellOffset,
          payloadSize,
          cellHeaderSize,
        );
        rows.push({ rowid, values: this.decodeRecord(payload) });
      }
    };

    walk(rootPage);
    return rows;
  }
}

function mediaMatchKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
    .replace(/&/g, ' and ')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function mediaPathKey(value) {
  return String(value ?? '')
    .replaceAll('/', '\\')
    .replace(/\\+/g, '\\')
    .toLocaleLowerCase();
}

function yearFromDate(value) {
  const match = /^((?:19|20)\d{2})/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitLegacyGenres(value) {
  return String(value ?? '')
    .split(/\s*\/\s*|\s*,\s*/)
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function bestTimestamp(values) {
  return (
    values
      .filter((value) => typeof value === 'string' && value)
      .sort((left, right) => right.localeCompare(left))[0] ?? null
  );
}

function createKodiMetadata(videoDb, textureDb) {
  const files = new Map(
    videoDb.table('files').map(({ rowid, values }) => [
      rowid,
      {
        id: rowid,
        pathId: Number(values[1]),
        fileName: String(values[2] ?? ''),
        playCount: finiteNumber(values[3]) ?? 0,
        lastPlayed: values[4] ? String(values[4]) : null,
        addedAt: values[5] ? String(values[5]) : null,
      },
    ]),
  );
  const paths = new Map(
    videoDb.table('path').map(({ rowid, values }) => [
      rowid,
      {
        value: String(values[1] ?? ''),
        addedAt: values[11] ? String(values[11]) : null,
      },
    ]),
  );

  const textureSizes = new Map();
  for (const { values } of textureDb.table('sizes')) {
    textureSizes.set(Number(values[0]), {
      width: finiteNumber(values[2]) ?? 0,
      height: finiteNumber(values[3]) ?? 0,
      useCount: finiteNumber(values[4]) ?? 0,
    });
  }

  const texturesByUrl = new Map();
  for (const { rowid, values } of textureDb.table('texture')) {
    const url = String(values[1] ?? '');
    const cachedUrl = String(values[2] ?? '').replaceAll('\\', '/');
    if (!url || !/^[0-9a-f]\/[0-9a-f]+\.jpe?g$/i.test(cachedUrl)) continue;
    const texture = {
      cachedUrl,
      ...(textureSizes.get(rowid) ?? { width: 0, height: 0, useCount: 0 }),
    };
    const existing = texturesByUrl.get(url);
    if (
      !existing ||
      texture.width * texture.height > existing.width * existing.height
    ) {
      texturesByUrl.set(url, texture);
    }
  }

  const artByMedia = new Map();
  for (const { values } of videoDb.table('art')) {
    const mediaId = Number(values[1]);
    const mediaType = String(values[2] ?? '');
    const type = String(values[3] ?? '');
    const url = String(values[4] ?? '');
    const texture = texturesByUrl.get(url);
    if (!mediaId || !mediaType || !type || !texture) continue;
    const key = `${mediaType}:${mediaId}`;
    const entries = artByMedia.get(key) ?? [];
    entries.push({ type, ...texture });
    artByMedia.set(key, entries);
  }

  const pickArtwork = (mediaType, mediaId, priorities, shape) => {
    const entries = artByMedia.get(`${mediaType}:${mediaId}`) ?? [];
    for (const type of priorities) {
      const matches = entries
        .filter((entry) => entry.type === type)
        .sort((left, right) => {
          const leftShape =
            shape === 'portrait'
              ? left.height - left.width
              : left.width - left.height;
          const rightShape =
            shape === 'portrait'
              ? right.height - right.width
              : right.width - right.height;
          return (
            rightShape - leftShape ||
            right.width * right.height - left.width * left.height ||
            right.useCount - left.useCount
          );
        });
      if (matches[0]) return matches[0].cachedUrl;
    }
    return null;
  };

  const genreNames = new Map(
    videoDb
      .table('genre')
      .map(({ rowid, values }) => [rowid, String(values[1] ?? '')]),
  );
  const genresByMedia = new Map();
  for (const { values } of videoDb.table('genre_link')) {
    const genre = genreNames.get(Number(values[0]));
    const mediaId = Number(values[1]);
    const mediaType = String(values[2] ?? '');
    if (!genre || !mediaId || !mediaType) continue;
    const key = `${mediaType}:${mediaId}`;
    const genres = genresByMedia.get(key) ?? [];
    if (!genres.includes(genre)) genres.push(genre);
    genresByMedia.set(key, genres);
  }

  const ratingsByMedia = new Map();
  for (const { values } of videoDb.table('rating')) {
    const mediaId = Number(values[1]);
    const mediaType = String(values[2] ?? '');
    const rating = finiteNumber(values[4]);
    const votes = finiteNumber(values[5]) ?? 0;
    if (!mediaId || !mediaType || rating === null) continue;
    const key = `${mediaType}:${mediaId}`;
    const current = ratingsByMedia.get(key);
    if (!current || votes > current.votes) {
      ratingsByMedia.set(key, { rating, votes });
    }
  }

  const bookmarksByFile = new Map();
  for (const { values } of videoDb.table('bookmark')) {
    const fileId = Number(values[1]);
    const positionSeconds = finiteNumber(values[2]);
    const totalSeconds = finiteNumber(values[3]);
    const type = Number(values[7]);
    if (
      type !== 1 ||
      !fileId ||
      positionSeconds === null ||
      totalSeconds === null ||
      positionSeconds <= 0 ||
      totalSeconds <= 0
    ) {
      continue;
    }
    const resume = { positionSeconds, totalSeconds };
    const current = bookmarksByFile.get(fileId);
    if (!current || positionSeconds > current.positionSeconds) {
      bookmarksByFile.set(fileId, resume);
    }
  }

  const resumeForFile = (fileId, episode = null) => {
    const bookmark = bookmarksByFile.get(fileId);
    if (!bookmark) return null;
    const file = files.get(fileId);
    return {
      ...bookmark,
      lastPlayed: file?.lastPlayed ?? null,
      ...(episode
        ? {
            episodeTitle: episode.title,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
          }
        : {}),
    };
  };

  const showPaths = new Map();
  for (const { values } of videoDb.table('tvshowlinkpath')) {
    const showId = Number(values[0]);
    const pathId = Number(values[1]);
    const list = showPaths.get(showId) ?? [];
    list.push(pathId);
    showPaths.set(showId, list);
  }

  const episodesByShow = new Map();
  for (const { rowid, values } of videoDb.table('episode')) {
    const showId = Number(values[26]);
    const fileId = Number(values[1]);
    const file = files.get(fileId);
    const filePath = file
      ? windowsJoin(paths.get(file.pathId)?.value ?? '', file.fileName)
      : '';
    const episode = {
      id: rowid,
      fileId,
      fileName: file?.fileName ?? '',
      mediaPath: String(values[20] ?? filePath),
      title: String(values[2] ?? '').trim(),
      plot: String(values[3] ?? '').trim() || null,
      airDate: String(values[7] ?? '').trim() || null,
      seasonNumber: finiteNumber(values[14]),
      episodeNumber: finiteNumber(values[15]),
      thumbnailCachedUrl: pickArtwork(
        'episode',
        rowid,
        ['thumb', 'landscape', 'fanart'],
        'landscape',
      ),
    };
    const list = episodesByShow.get(showId) ?? [];
    list.push(episode);
    episodesByShow.set(showId, list);
  }

  const seriesByKey = new Map();
  for (const { rowid, values } of videoDb.table('tvshow')) {
    const title = String(values[1] ?? '');
    const episodes = episodesByShow.get(rowid) ?? [];
    const episodesByPath = new Map();
    const episodesByIdentity = new Map();
    const episodesByFileName = new Map();
    for (const episode of episodes) {
      const pathKey = mediaPathKey(episode.mediaPath);
      if (pathKey) episodesByPath.set(pathKey, episode);
      const identity = `${episode.seasonNumber ?? ''}:${episode.episodeNumber ?? ''}`;
      const identityRows = episodesByIdentity.get(identity) ?? [];
      identityRows.push(episode);
      episodesByIdentity.set(identity, identityRows);
      const fileKey = episode.fileName.toLocaleLowerCase();
      const fileRows = episodesByFileName.get(fileKey) ?? [];
      fileRows.push(episode);
      episodesByFileName.set(fileKey, fileRows);
    }
    const episodeRatings = episodes
      .map((episode) => ratingsByMedia.get(`episode:${episode.id}`)?.rating)
      .filter((rating) => rating !== undefined);
    const rating =
      episodeRatings.length > 0
        ? episodeRatings.reduce((sum, value) => sum + value, 0) /
          episodeRatings.length
        : null;
    const resumes = episodes
      .map((episode) => resumeForFile(episode.fileId, episode))
      .filter(Boolean)
      .sort((left, right) =>
        String(right.lastPlayed ?? '').localeCompare(
          String(left.lastPlayed ?? ''),
        ),
      );
    const pathDates = (showPaths.get(rowid) ?? [])
      .map((pathId) => paths.get(pathId)?.addedAt)
      .filter(Boolean);
    const episodeDates = episodes
      .map((episode) => files.get(episode.fileId)?.addedAt)
      .filter(Boolean);
    const linkedGenres = genresByMedia.get(`tvshow:${rowid}`) ?? [];

    seriesByKey.set(mediaMatchKey(title), {
      kodiId: rowid,
      title,
      year: yearFromDate(values[6]),
      rating,
      genres:
        linkedGenres.length > 0 ? linkedGenres : splitLegacyGenres(values[9]),
      addedAt: bestTimestamp([...pathDates, ...episodeDates]),
      resume: resumes[0] ?? null,
      posterCachedUrl: pickArtwork(
        'tvshow',
        rowid,
        ['poster', 'thumb', 'keyart', 'landscape', 'banner', 'fanart'],
        'portrait',
      ),
      fanartCachedUrl: pickArtwork(
        'tvshow',
        rowid,
        ['fanart', 'landscape', 'thumb', 'banner'],
        'landscape',
      ),
      episode(row) {
        const pathMatch = episodesByPath.get(mediaPathKey(row.MediaPath));
        if (pathMatch) return pathMatch;
        const identity = `${row.Season ?? ''}:${row.Episode ?? ''}`;
        const identityRows = episodesByIdentity.get(identity) ?? [];
        if (identityRows.length === 1) return identityRows[0];
        const fileRows = episodesByFileName.get(
          String(row.FileName ?? '').toLocaleLowerCase(),
        ) ?? [];
        return fileRows.length === 1 ? fileRows[0] : null;
      },
    });
  }

  const moviesByFile = new Map();
  const moviesByKey = new Map();
  for (const { rowid, values } of videoDb.table('movie')) {
    const fileId = Number(values[1]);
    const file = files.get(fileId);
    const title = String(values[2] ?? '');
    const premiered = values[28] ? String(values[28]) : null;
    const metadata = {
      kodiId: rowid,
      fileId,
      title,
      year: yearFromDate(premiered),
      rating: ratingsByMedia.get(`movie:${rowid}`)?.rating ?? null,
      genres: genresByMedia.get(`movie:${rowid}`) ?? [],
      addedAt: file?.addedAt ?? null,
      resume: resumeForFile(fileId),
      posterCachedUrl: pickArtwork(
        'movie',
        rowid,
        ['poster', 'thumb', 'keyart', 'landscape', 'banner', 'fanart'],
        'portrait',
      ),
    };
    if (file?.fileName) {
      moviesByFile.set(file.fileName.toLocaleLowerCase(), metadata);
    }
    moviesByKey.set(
      `${mediaMatchKey(title)}:${metadata.year ?? ''}`,
      metadata,
    );
  }

  return {
    series(title) {
      return seriesByKey.get(mediaMatchKey(title)) ?? null;
    },
    movie(row, identity) {
      return (
        moviesByFile.get(String(row.FileName).toLocaleLowerCase()) ??
        moviesByKey.get(
          `${mediaMatchKey(identity.title)}:${identity.year ?? ''}`,
        ) ??
        null
      );
    },
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isUsableJpeg(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(3);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const stats = await handle.stat();
      return (
        bytesRead === 3 &&
        stats.size > 128 &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function readEpisodeThumbCache() {
  try {
    const value = JSON.parse(await fs.readFile(episodeThumbCachePath, 'utf8'));
    value.version = 1;
    value.items ??= {};
    return value;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { version: 1, items: {} };
    }
    throw error;
  }
}

async function writeEpisodeThumbCache(cache) {
  await fs.mkdir(episodeThumbDirectory, { recursive: true });
  const partial = `${episodeThumbCachePath}.${process.pid}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await fs.rename(partial, episodeThumbCachePath);
}

function remoteScpPath(remotePath) {
  // OpenSSH's SFTP-backed scp accepts a Windows drive path with forward
  // slashes. Passing this as one execFile argument preserves spaces and
  // apostrophes without shell quoting.
  return `${remote}:${remotePath.replaceAll('\\', '/')}`;
}

function windowsJoin(...parts) {
  return parts
    .map((part, index) =>
      String(part)
        .replaceAll('/', '\\')
        .replace(index === 0 ? /\\+$/g : /^\\+|\\+$/g, ''),
    )
    .filter(Boolean)
    .join('\\');
}

function mediaUrlFromWindowsPath(value) {
  const withoutDrive = String(value ?? '')
    .replace(/^[a-z]:[\\/]+/i, '')
    .replaceAll('\\', '/');
  const segments = withoutDrive.split('/').filter(Boolean);
  return segments.length > 0
    ? `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
    : null;
}

async function copyKodiDatabases(
  kodiUserdata,
  videoDatabase,
  textureDatabase,
  temporaryDirectory,
) {
  const databaseDirectory = windowsJoin(kodiUserdata, 'Database');
  const copies = [
    [videoDatabase, path.join(temporaryDirectory, videoDatabase)],
    [textureDatabase, path.join(temporaryDirectory, textureDatabase)],
  ];

  for (const [name, destination] of copies) {
    try {
      await execFile(
        scpBinary,
        [
          '-q',
          remoteScpPath(windowsJoin(databaseDirectory, name)),
          destination,
        ],
        {
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'stderr' in error
          ? String(error.stderr).trim()
          : String(error);
      throw new Error(`Kodi database copy failed for ${name}: ${detail}`);
    }
  }

  return {
    videos: copies[0][1],
    textures: copies[1][1],
  };
}

async function copyArtwork(
  requests,
  kodiUserdata,
  temporaryDirectory,
  counters,
  episodeThumbCache,
) {
  const downloadDirectory = path.join(temporaryDirectory, 'thumbnails');
  await fs.mkdir(downloadDirectory, { recursive: true });
  let episodeCacheChanges = 0;
  const checkpointEpisodeCache = async () => {
    episodeCacheChanges += 1;
    if (episodeCacheChanges % 25 === 0) {
      await writeEpisodeThumbCache(episodeThumbCache);
    }
  };

  const pending = [];
  for (const request of requests) {
    const cacheEntry = request.cacheKey
      ? episodeThumbCache.items[request.cacheKey]
      : null;
    const reusableKodiThumb =
      request.cacheKey &&
      cacheEntry?.status === 'ok' &&
      cacheEntry.source === 'kodi' &&
      cacheEntry.fingerprint === request.cachedUrl;
    if ((await isUsableJpeg(request.destination)) && (!request.cacheKey || reusableKodiThumb)) {
      request.target[request.field] = request.publicPath;
      if (request.sourceField) request.target[request.sourceField] = request.source;
      counters.artSkipped += 1;
      continue;
    }
    if (
      request.cacheKey &&
      cacheEntry?.kodiStatus === 'failed' &&
      cacheEntry.kodiFingerprint === request.cachedUrl
    ) {
      counters.artFailures += 1;
      continue;
    }
    if (!request.cacheKey && (await exists(request.destination))) {
      counters.artFailures += 1;
      console.warn(
        `Existing artwork is not a usable JPEG; left untouched: ${request.destination}`,
      );
      continue;
    }
    pending.push(request);
  }

  const byCachedUrl = new Map();
  for (const request of pending) {
    const list = byCachedUrl.get(request.cachedUrl) ?? [];
    list.push(request);
    byCachedUrl.set(request.cachedUrl, list);
  }

  const cachedUrls = [...byCachedUrl.keys()];
  const chunkSize = 48;
  for (let start = 0; start < cachedUrls.length; start += chunkSize) {
    const chunk = cachedUrls.slice(start, start + chunkSize);
    const sources = chunk.map((cachedUrl) =>
      remoteScpPath(windowsJoin(kodiUserdata, 'Thumbnails', cachedUrl)),
    );
    try {
      await execFile(scpBinary, ['-q', ...sources, downloadDirectory], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'stderr' in error
          ? String(error.stderr).trim()
          : String(error);
      // A multi-source scp can still copy the other files in its batch. Each
      // expected file is validated below, so retain successful copies.
      console.warn(`Artwork batch reported an error: ${detail || error}`);
    }
  }

  for (const request of pending) {
    const staged = path.join(
      downloadDirectory,
      path.posix.basename(request.cachedUrl),
    );
    if (!(await isUsableJpeg(staged))) {
      counters.artFailures += 1;
      if (request.cacheKey) {
        episodeThumbCache.items[request.cacheKey] = {
          ...(episodeThumbCache.items[request.cacheKey] ?? {}),
          kodiStatus: 'failed',
          kodiFingerprint: request.cachedUrl,
          kodiReason: 'cached Kodi artwork was unavailable or not a JPEG',
          updatedAt: new Date().toISOString(),
        };
        await checkpointEpisodeCache();
      }
      console.warn(`Cached Kodi artwork was unavailable: ${request.cachedUrl}`);
      continue;
    }

    const partial = `${request.destination}.part`;
    await fs.mkdir(path.dirname(request.destination), { recursive: true });
    await fs.rm(partial, { force: true });
    try {
      await fs.copyFile(staged, partial);
      await fs.rm(request.destination, { force: true });
      await fs.rename(partial, request.destination);
      request.target[request.field] = request.publicPath;
      if (request.sourceField) request.target[request.sourceField] = request.source;
      if (request.cacheKey) {
        episodeThumbCache.items[request.cacheKey] = {
          status: 'ok',
          source: request.source,
          fingerprint: request.cachedUrl,
          updatedAt: new Date().toISOString(),
        };
        await checkpointEpisodeCache();
      }
      counters.artCopied += 1;
    } catch (error) {
      counters.artFailures += 1;
      await fs.rm(partial, { force: true });
      console.warn(`Artwork install failed for ${request.destination}: ${error}`);
    }
  }
  if (episodeCacheChanges % 25 !== 0) {
    await writeEpisodeThumbCache(episodeThumbCache);
  }
}

async function applyExistingEpisodeThumbs(catalog, episodeThumbCache) {
  for (const series of catalog.series) {
    for (const season of series.seasons) {
      for (const episode of season.episodes) {
        const destination = path.join(
          episodeThumbDirectory,
          series.id,
          `${episode.id}.jpg`,
        );
        if (!(await isUsableJpeg(destination))) continue;
        episode.thumbnail = `/episode-thumbs/${series.id}/${episode.id}.jpg`;
        const source = episodeThumbCache.items[episode.id]?.source;
        episode.thumbnailSource = source === 'extracted' ? 'extracted' : 'kodi';
      }
    }
  }
}

function buildCatalog(inventory, kodiMetadata) {
  const usedSlugs = new Set();
  const artworkRequests = [];
  const counters = {
    seriesMetadataMatches: 0,
    episodeMetadataMatches: 0,
    episodeTitlesApplied: 0,
    episodeArtworkMatches: 0,
    movieMetadataMatches: 0,
    artCopied: 0,
    artSkipped: 0,
    artFailures: 0,
  };

  const series = [];
  for (const row of inventory.Series ?? []) {
    const id = uniqueSlug(String(row.Title), usedSlugs);
    const kodi = kodiMetadata.series(row.Title);
    if (kodi) counters.seriesMetadataMatches += 1;
    const seasons = (row.Seasons ?? []).map((season) => {
      const number = Number(season.Number);
      const episodes = (season.Episodes ?? []).map((episode, index) => {
        const episodeNumber =
          episode.Episode === null || episode.Episode === undefined
            ? null
            : Number(episode.Episode);
        const ordinal = episodeNumber ?? index + 1;
        const kodiEpisode = kodi?.episode({
          ...episode,
          Season: number,
          Episode: episodeNumber,
        }) ?? null;
        if (kodiEpisode) counters.episodeMetadataMatches += 1;
        // Kodi is the authority for names. When it has no matching row, keep
        // the honest ordinal instead of guessing a title from a filename.
        const fallbackTitle = `Episode ${episodeNumber ?? index + 1}`;
        const item = {
          id: `${id}-s${String(number).padStart(2, '0')}-e${String(ordinal).padStart(3, '0')}-${index + 1}`,
          title: kodiEpisode?.title || fallbackTitle,
          plot: kodiEpisode?.plot ?? null,
          airDate: kodiEpisode?.airDate ?? null,
          fileName: String(episode.FileName),
          mediaUrl: mediaUrlFromWindowsPath(episode.MediaPath),
          episodeNumber,
          sizeBytes: Number(episode.SizeBytes),
          thumbnail: null,
          thumbnailSource: null,
        };
        if (kodiEpisode?.title) counters.episodeTitlesApplied += 1;
        if (kodiEpisode?.thumbnailCachedUrl) {
          counters.episodeArtworkMatches += 1;
          artworkRequests.push({
            target: item,
            field: 'thumbnail',
            sourceField: 'thumbnailSource',
            source: 'kodi',
            cacheKey: item.id,
            cachedUrl: kodiEpisode.thumbnailCachedUrl,
            destination: path.join(episodeThumbDirectory, id, `${item.id}.jpg`),
            publicPath: `/episode-thumbs/${id}/${item.id}.jpg`,
          });
        }
        return item;
      });

      return {
        number,
        title: number === 0 ? 'Specials' : `Season ${number}`,
        episodeCount: Number(season.EpisodeCount),
        totalBytes: Number(season.TotalBytes),
        episodes,
      };
    });

    const item = {
      id,
      title: String(row.Title),
      year: kodi?.year ?? null,
      rating: kodi?.rating ?? null,
      genres: kodi?.genres ?? [],
      addedAt: kodi?.addedAt ?? null,
      resume: kodi?.resume ?? null,
      seasons,
      episodeCount: Number(row.EpisodeCount),
      totalBytes: Number(row.TotalBytes),
      poster: null,
      fanart: null,
    };
    series.push(item);

    if (kodi?.posterCachedUrl) {
      artworkRequests.push({
        target: item,
        field: 'poster',
        cachedUrl: kodi.posterCachedUrl,
        destination: path.join(artDirectory, `${id}.jpg`),
        publicPath: `/media-art/${id}.jpg`,
      });
    }
    if (kodi?.fanartCachedUrl) {
      artworkRequests.push({
        target: item,
        field: 'fanart',
        cachedUrl: kodi.fanartCachedUrl,
        destination: path.join(artDirectory, `${id}-fanart.jpg`),
        publicPath: `/media-art/${id}-fanart.jpg`,
      });
    }
  }

  const movies = [];
  for (const row of inventory.Movies ?? []) {
    const identity = movieIdentity(row);
    const id = uniqueSlug(identity.title, usedSlugs);
    const kodi = kodiMetadata.movie(row, identity);
    if (kodi) counters.movieMetadataMatches += 1;
    const item = {
      id,
      title: identity.title,
      year: identity.year ?? kodi?.year ?? null,
      rating: kodi?.rating ?? null,
      genres: kodi?.genres ?? [],
      addedAt: kodi?.addedAt ?? null,
      resume: kodi?.resume ?? null,
      fileName: String(row.FileName),
      sizeBytes: Number(row.SizeBytes),
      poster: null,
    };
    movies.push(item);

    if (kodi?.posterCachedUrl) {
      artworkRequests.push({
        target: item,
        field: 'poster',
        cachedUrl: kodi.posterCachedUrl,
        destination: path.join(artDirectory, `${id}.jpg`),
        publicPath: `/media-art/${id}.jpg`,
      });
    }
  }

  return {
    catalog: {
      generatedAt: new Date().toISOString(),
      series,
      movies,
    },
    artworkRequests,
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
  await fs.mkdir(episodeThumbDirectory, { recursive: true });
  const temporaryDirectory = path.join(
    artDirectory,
    `.kodi-import-${process.pid}-${Date.now()}`,
  );
  await fs.mkdir(temporaryDirectory, { recursive: true });

  try {
    console.log(`Reading Kodi library from ${remote} (read-only)...`);
    const inventory = await runInventory();
    if (!inventory.KodiUserdata) {
      throw new Error('The media PC did not report Kodi userdata.');
    }
    if (!inventory.VideoDatabase || !inventory.TextureDatabase) {
      throw new Error('The media PC did not report Kodi video/texture databases.');
    }

    console.log('Copying Kodi databases for local read-only parsing...');
    const databasePaths = await copyKodiDatabases(
      String(inventory.KodiUserdata),
      String(inventory.VideoDatabase),
      String(inventory.TextureDatabase),
      temporaryDirectory,
    );
    const [videoDb, textureDb] = await Promise.all([
      SharedReadOnlySqlite.open(databasePaths.videos),
      SharedReadOnlySqlite.open(databasePaths.textures),
    ]);
    const episodeThumbCache = await readEpisodeThumbCache();
    const kodiMetadata = createKodiMetadata(videoDb, textureDb);
    const { catalog, artworkRequests, counters } = buildCatalog(
      inventory,
      kodiMetadata,
    );

    await copyArtwork(
      artworkRequests,
      String(inventory.KodiUserdata),
      temporaryDirectory,
      counters,
      episodeThumbCache,
    );
    await applyExistingEpisodeThumbs(catalog, episodeThumbCache);
    await writeCatalog(catalog);

    const episodeCount = catalog.series.reduce(
      (total, item) => total + item.episodeCount,
      0,
    );
    const totalBytes =
      catalog.series.reduce((total, item) => total + item.totalBytes, 0) +
      catalog.movies.reduce((total, item) => total + item.sizeBytes, 0);
    const seriesPosters = catalog.series.filter((item) => item.poster).length;
    const moviePosters = catalog.movies.filter((item) => item.poster).length;
    const seriesFanart = catalog.series.filter((item) => item.fanart).length;
    const episodes = catalog.series.flatMap((item) =>
      item.seasons.flatMap((season) => season.episodes),
    );
    const kodiEpisodeThumbs = episodes.filter(
      (episode) => episode.thumbnailSource === 'kodi',
    ).length;
    const extractedEpisodeThumbs = episodes.filter(
      (episode) => episode.thumbnailSource === 'extracted',
    ).length;
    const missingEpisodeThumbs = episodes.length - kodiEpisodeThumbs - extractedEpisodeThumbs;

    console.log(
      'SQLite route: copied DBs + tools/sqlite.mjs read-only b-tree reader',
    );
    console.log(`Series: ${catalog.series.length}`);
    console.log(`Episodes: ${episodeCount}`);
    console.log(`Movies: ${catalog.movies.length}`);
    console.log(`Media bytes: ${totalBytes}`);
    console.log(
      `Kodi metadata matched: ${counters.seriesMetadataMatches} series, ${counters.movieMetadataMatches} movies`,
    );
    console.log(
      `Kodi episodes matched: ${counters.episodeMetadataMatches}/${episodeCount}`,
    );
    console.log(
      `Kodi episode titles applied: ${counters.episodeTitlesApplied}/${episodeCount}`,
    );
    console.log(
      `Episode thumbnails: ${kodiEpisodeThumbs} Kodi, ${extractedEpisodeThumbs} extracted, ${missingEpisodeThumbs} missing`,
    );
    console.log(
      `Posters recovered: ${seriesPosters}/${catalog.series.length} series, ${moviePosters}/${catalog.movies.length} movies`,
    );
    console.log(
      `Series fanart recovered: ${seriesFanart}/${catalog.series.length}`,
    );
    console.log(`Artwork copied: ${counters.artCopied}`);
    console.log(`Artwork already present: ${counters.artSkipped}`);
    console.log(`Artwork failures: ${counters.artFailures}`);
    console.log(`Wrote ${path.relative(projectRoot, generatedPath)}`);
  } finally {
    const resolvedArt = path.resolve(artDirectory);
    const resolvedTemporary = path.resolve(temporaryDirectory);
    if (
      resolvedTemporary.startsWith(`${resolvedArt}${path.sep}`) &&
      path.basename(resolvedTemporary).startsWith('.kodi-import-')
    ) {
      await fs.rm(resolvedTemporary, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
