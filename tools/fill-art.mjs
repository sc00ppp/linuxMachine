#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SINGLE_LIBRARY = path.join(ROOT, 'shell', 'src', 'core', 'library.generated.json');
const CHUNK_LIBRARY_DIR = path.join(ROOT, 'shell', 'src', 'core', 'library');
const PUBLIC_ART_DIR = path.join(ROOT, 'shell', 'public', 'art-fill');
const CACHE_PATH = path.join(ROOT, 'tools', '.art-fill-cache.json');
const CACHE_VERSION = 1;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const LIBRETRO_CONCURRENCY = 6;
const SCREENSCRAPER_DELAY_MS = 2_200;

// Verified against the live libretro-thumbnails organization on 2026-07-31.
// null means that the organization currently has no matching repository.
const LIBRETRO_REPOS = Object.freeze({
  '3ds': 'Nintendo_-_Nintendo_3DS',
  atari2600: 'Atari_-_2600',
  atari5200: 'Atari_-_5200',
  atari7800: 'Atari_-_7800',
  atarist: 'Atari_-_ST',
  channelf: 'Fairchild_-_Channel_F',
  colecovision: 'Coleco_-_ColecoVision',
  gamecube: 'Nintendo_-_GameCube',
  gamegear: 'Sega_-_Game_Gear',
  gb: 'Nintendo_-_Game_Boy',
  gba: 'Nintendo_-_Game_Boy_Advance',
  gbc: 'Nintendo_-_Game_Boy_Color',
  jaguar: 'Atari_-_Jaguar',
  jaguarcd: null,
  lynx: 'Atari_-_Lynx',
  mastersystem: 'Sega_-_Master_System_-_Mark_III',
  megadrive: 'Sega_-_Mega_Drive_-_Genesis',
  n64: 'Nintendo_-_Nintendo_64',
  nds: 'Nintendo_-_Nintendo_DS',
  neogeo: 'SNK_-_Neo_Geo',
  nes: 'Nintendo_-_Nintendo_Entertainment_System',
  pokemini: 'Nintendo_-_Pokemon_Mini',
  ps3: 'Sony_-_PlayStation_3',
  psp: 'Sony_-_PlayStation_Portable',
  psx: 'Sony_-_PlayStation',
  saturn: 'Sega_-_Saturn',
  sega32x: 'Sega_-_32X',
  segacd: 'Sega_-_Mega-CD_-_Sega_CD',
  supergrafx: 'NEC_-_PC_Engine_SuperGrafx',
  switch: null,
  wii: 'Nintendo_-_Wii',
  wiiu: 'Nintendo_-_Wii_U',
  windows: null,
  xbox: 'Microsoft_-_Xbox',
});

const SCREENSCRAPER_SYSTEM_IDS = Object.freeze({
  '3ds': 17, atari2600: 26, atari5200: 40, atari7800: 41, atarist: 42,
  channelf: 80, colecovision: 48, gamecube: 13, gamegear: 21, gb: 9,
  gba: 12, gbc: 10, jaguar: 27, jaguarcd: 171, lynx: 28,
  mastersystem: 2, megadrive: 1, n64: 14, nds: 15, neogeo: 142,
  nes: 3, pokemini: 211, ps3: 59, psp: 61, psx: 57, saturn: 22,
  sega32x: 19, segacd: 20, supergrafx: 105, switch: 225, wii: 16,
  wiiu: 18, windows: 138, xbox: 32,
});

// The current systems use portrait or near-square front covers. The generous
// cutoff catches obvious wide captures without rejecting clamshell covers.
const PORTRAIT_SYSTEMS = new Set(Object.keys(SCREENSCRAPER_SYSTEM_IDS));

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function systemsInDocument(data, filePath) {
  if (Array.isArray(data?.systems)) return data.systems;
  if (data?.system && Array.isArray(data.system.games)) return [data.system];
  if (data?.id && Array.isArray(data.games)) return [data];
  if (Array.isArray(data) && data.every((item) => Array.isArray(item?.games))) return data;
  if (Array.isArray(data)) {
    const inferredId = data[0]?.systemId ?? path.basename(filePath, '.generated.json');
    return [{ id: inferredId, gameCount: data.length, games: data }];
  }
  throw new Error(`Unsupported generated-library shape in ${relative(filePath)}`);
}

async function detectLibraryDocuments() {
  let chunkFiles = [];
  if (await exists(CHUNK_LIBRARY_DIR)) {
    chunkFiles = (await readdir(CHUNK_LIBRARY_DIR))
      .filter((name) => name.endsWith('.generated.json') && name !== 'index.generated.json')
      .sort()
      .map((name) => path.join(CHUNK_LIBRARY_DIR, name));
  }
  const files = chunkFiles.length
    ? chunkFiles
    : (await exists(SINGLE_LIBRARY))
      ? [SINGLE_LIBRARY]
      : [];
  if (!files.length) throw new Error('No generated library found (single file or per-system chunks)');
  const documents = [];
  for (const filePath of files) {
    const originalText = await readFile(filePath, 'utf8');
    const data = JSON.parse(originalText);
    documents.push({ path: filePath, originalText, data,
      systems: systemsInDocument(data, filePath), changed: false });
  }
  return { kind: chunkFiles.length ? 'per-system' : 'single-file', documents,
    signature: files.map(relative).join('\n') };
}

async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    if (parsed?.version === CACHE_VERSION && parsed.entries) return parsed;
  } catch {
    // A missing, old, or interrupted cache starts clean.
  }
  return { version: CACHE_VERSION, entries: {} };
}

async function saveCache(cache) {
  cache.updatedAt = new Date().toISOString();
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function entryKey(systemId, game) {
  return createHash('sha1')
    .update(JSON.stringify([systemId, game.path, game.name]))
    .digest('hex');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function romBaseName(game) {
  const normalized = String(game.path ?? '').replaceAll('\\', '/');
  const base = safeDecode(normalized.slice(normalized.lastIndexOf('/') + 1));
  return base.replace(/\.[^.]+$/, '');
}

function libretroSafeTitle(value) {
  return value.replaceAll('&', '_').replace(/[\\/*?:\x22<>|]/g, '_');
}

function isMetadataTag(value) {
  return /^(?:usa|europe|world|japan|korea|china|taiwan|asia|australia|brazil|canada|france|germany|italy|spain|sweden|netherlands|russia|uk|unknown|us|eu|jp|kr|cn|tw|au|br|ca|fr|de|it|es|se|nl|ru|en(?:[,+][a-z]{2})*|[a-z]{2}(?:,[a-z]{2})+|rev(?:ision)?\s*\w+|v(?:er(?:sion)?)?\s*\d[\w. -]*|beta\w*|proto\w*|sample\w*|demo\w*|unl|pirate|aftermarket|virtual\s+console|switch\s+online|disc\s*\d+|disk\s*\d+|side\s*[ab]|\d{4}(?:-\d{2}-\d{2})?|\d+\s*in\s*1|alt(?:ernate)?\s*\w+)$/i.test(value.trim());
}

function stripKnownMetadata(value) {
  let result = value.trim();
  while (true) {
    const match = result.match(/\s*([([])([^\])]+)[\])]\s*$/);
    if (!match) break;
    const shortTag = match[1] === '[' && /^[!a-z]?\d*$/i.test(match[2].trim());
    if (!shortTag && !isMetadataTag(match[2])) break;
    result = result.slice(0, match.index).trim();
  }
  return result;
}

function stripLibretroMetadata(value) {
  let result = stripKnownMetadata(value);
  result = result.replace(/\s*\(\d{4}(?:-\d{2}-\d{2})?\)(?:\([^)]*\))*\s*$/, '');
  result = result.replace(/\s*\[(?:hack|translation|homebrew)[^\]]*]\s*$/i, '');
  return result.trim();
}

function normalizedTitle(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replaceAll('&', ' and ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

function titleKeys(value) {
  const keys = new Set();
  const normalized = normalizedTitle(value);
  if (normalized) keys.add(normalized);
  const noLeadingArticle = normalized.replace(/^(?:the|an|a)\s+/, '');
  if (noLeadingArticle) keys.add(noLeadingArticle);
  const noTrailingArticle = normalized.replace(/\s+(?:the|an|a)$/, '');
  if (noTrailingArticle) keys.add(noTrailingArticle);
  return keys;
}

function gameCandidateTitles(game) {
  return [...new Set([game.name?.trim(), romBaseName(game)].filter(Boolean))];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function buildLibretroIndex(tree) {
  const byExact = new Map();
  const byTitle = new Map();
  let count = 0;
  for (const item of tree) {
    if (item.type !== 'blob' || !item.path.startsWith('Named_Boxarts/') || !item.path.toLowerCase().endsWith('.png')) continue;
    count += 1;
    const baseName = item.path.slice('Named_Boxarts/'.length, -'.png'.length);
    byExact.set(baseName, item.path);
    for (const key of titleKeys(stripLibretroMetadata(baseName))) {
      const matches = byTitle.get(key) ?? [];
      matches.push(item.path);
      byTitle.set(key, matches);
    }
  }
  return { count, byExact, byTitle };
}

async function fetchLibretroIndex(repo) {
  const url = `https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`;
  let response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'linuxmachine-fill-art' },
    });
  } catch {
    return { error: 'request failed or timed out' };
  }
  if (!response.ok) {
    const limited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
    return { error: limited ? 'GitHub API rate limit reached' : `GitHub returned HTTP ${response.status}` };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { error: 'GitHub returned invalid JSON' };
  }
  if (payload.truncated || !Array.isArray(payload.tree)) {
    return { error: 'GitHub repository tree was unavailable or truncated' };
  }
  const index = buildLibretroIndex(payload.tree);
  return index.count ? { index } : { error: 'Named_Boxarts was absent or empty' };
}

function regionScore(filePath, game) {
  const region = String(game.region ?? '').toLowerCase();
  let score = 0;
  const wanted = {
    us: /\(usa\)/i, eu: /\(europe\)/i, jp: /\(japan\)/i,
    ja: /\(japan\)/i, kr: /\(korea\)/i, br: /\(brazil\)/i,
  }[region];
  if (wanted?.test(filePath)) score += 100;
  if (/\(usa\)/i.test(filePath)) score += 30;
  else if (/\(world\)/i.test(filePath)) score += 20;
  else if (/\(europe\)/i.test(filePath)) score += 10;
  const custom = /homebrew|romhack|hack|translation|unlicensed|redux|relocal/i.test(`${game.name} ${game.path}`);
  if (/\b(?:unl|hack|homebrew)\b/i.test(filePath)) score += custom ? 20 : -20;
  return score;
}

function libretroMatches(index, game) {
  const exact = [];
  for (const candidate of gameCandidateTitles(game)) {
    const match = index.byExact.get(libretroSafeTitle(candidate));
    if (match) exact.push(match);
  }
  if (exact.length) return [...new Set(exact)];
  const matches = [];
  for (const candidate of gameCandidateTitles(game)) {
    for (const key of titleKeys(stripKnownMetadata(candidate))) {
      matches.push(...(index.byTitle.get(key) ?? []));
    }
  }
  return [...new Set(matches)].sort((left, right) =>
    regionScore(right, game) - regionScore(left, game) ||
    left.length - right.length || left.localeCompare(right));
}

function pngDimensions(buffer) {
  if (buffer.length < 33 ||
      !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      buffer.toString('ascii', 12, 16) !== 'IHDR' ||
      !buffer.subarray(Math.max(0, buffer.length - 12)).includes(Buffer.from('IEND'))) {
    return null;
  }
  return { ext: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2 || offset + 2 + size > buffer.length) return null;
    if (sof.has(marker)) {
      return { ext: 'jpg', height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return null;
}

function gifDimensions(buffer) {
  const signature = buffer.toString('ascii', 0, 6);
  if (buffer.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return null;
  return { ext: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP' ||
      buffer.toString('ascii', 12, 16) !== 'VP8X') return null;
  return { ext: 'webp', width: 1 + buffer.readUIntLE(24, 3),
    height: 1 + buffer.readUIntLE(27, 3) };
}

function validateImage(buffer, systemId) {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return { error: 'empty or oversized response' };
  const image = pngDimensions(buffer) ?? jpegDimensions(buffer) ??
    gifDimensions(buffer) ?? webpDimensions(buffer);
  if (!image || image.width < 32 || image.height < 32) {
    return { error: 'response did not decode as a supported image' };
  }
  if (PORTRAIT_SYSTEMS.has(systemId) && image.width / image.height > 1.6) {
    return { error: 'image was wider than the box-art limit' };
  }
  return image;
}

async function downloadImage(url, systemId, options = {}) {
  let response;
  try {
    response = await fetchWithTimeout(url, options);
  } catch {
    return { error: 'request failed or timed out' };
  }
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    return { error: 'response was oversized' };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const image = validateImage(buffer, systemId);
  return image.error ? image : { buffer, image };
}

function rawLibretroUrl(repo, repoPath) {
  const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/${encodedPath}`;
}

function slugFor(systemId, game) {
  const base = String(game.name || 'game').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 72) || 'game';
  return `${base}-${entryKey(systemId, game).slice(0, 8)}`;
}

async function saveFoundImage(target, source, downloaded) {
  const systemId = target.system.id;
  const directory = path.join(PUBLIC_ART_DIR, systemId);
  await mkdir(directory, { recursive: true });
  const fileName = `${slugFor(systemId, target.game)}.${downloaded.image.ext}`;
  await writeFile(path.join(directory, fileName), downloaded.buffer);
  const artPath = `/art-fill/${systemId}/${fileName}`;
  target.game.art = artPath;
  target.document.changed = true;
  return { artPath, source, width: downloaded.image.width,
    height: downloaded.image.height };
}

async function workerPool(items, concurrency, callback) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function remoteCredentialScript() {
  return String.raw`
$ProgressPreference = 'SilentlyContinue'
$settingsPath = 'S:\RetroBat\emulationstation\.emulationstation\es_settings.cfg'
if (-not (Test-Path -LiteralPath $settingsPath)) { exit 2 }
$settingsText = Get-Content -LiteralPath $settingsPath -Raw
function Get-SettingValue([string]$name) {
  $tag = [regex]::Match($settingsText, '<string[^>]*\bname=\x22' + [regex]::Escape($name) + '\x22[^>]*>', 'IgnoreCase')
  if (-not $tag.Success) { return $null }
  $value = [regex]::Match($tag.Value, '\bvalue=\x22([^\x22]*)\x22', 'IgnoreCase')
  if (-not $value.Success) { return $null }
  return [System.Net.WebUtility]::HtmlDecode($value.Groups[1].Value)
}
$result = @{
  user = Get-SettingValue 'ScreenScraperUser'
  pass = Get-SettingValue 'ScreenScraperPass'
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;
}

function readScreenScraperCredentials() {
  const encoded = Buffer.from(remoteCredentialScript(), 'utf16le').toString('base64');
  const result = spawnSync('ssh', [
    '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    'david@192.168.1.158', 'powershell', '-NoProfile', '-EncodedCommand', encoded,
  ], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return { error: 'credentials could not be read over SSH' };
  let account;
  try {
    account = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
  } catch {
    return { error: 'the SSH credential response was invalid' };
  }
  if (!account.user || !account.pass) {
    return { error: 'ScreenScraper account settings were missing' };
  }
  return {
    user: account.user,
    pass: account.pass,
    devId: process.env.SCREENSCRAPER_DEV_ID || account.user,
    devPassword: process.env.SCREENSCRAPER_DEV_PASSWORD || account.pass,
  };
}

function collectBoxMedia(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (!Array.isArray(value)) {
    const type = String(value.type ?? value.media ?? '').toLowerCase();
    const url = value.url ?? value.uri;
    if (typeof url === 'string' && (/^box-?2d/.test(type) || /^box-?3d/.test(type))) {
      output.push(value);
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectBoxMedia(child, output);
  }
  return output;
}

function screenScraperMediaScore(media, game) {
  const type = String(media.type ?? media.media ?? '').toLowerCase();
  const region = String(media.region ?? '').toLowerCase();
  const wanted = String(game.region ?? '').toLowerCase();
  let score = type.includes('2d') ? 100 : 0;
  if (region === wanted) score += 50;
  if (region === 'us') score += 20;
  else if (region === 'wor') score += 15;
  else if (region === 'eu') score += 10;
  return score;
}

function classifyScreenScraperFailure(response, body) {
  const lower = body.toLowerCase();
  if (response.status === 429 || response.status === 430 || response.status === 431 ||
      /quota|too many|maximum|limite|faites? du tri|thread.*(?:maximum|limit)/i.test(lower)) {
    return 'quota';
  }
  if (response.status === 401 || response.status === 403 ||
      /erreur de login|identifiants|authentication|unauthori[sz]ed/i.test(lower)) {
    return 'auth';
  }
  if (/crc|md5|sha1|romtaille|file size/i.test(lower)) return 'unsupported';
  if (response.status === 404 ||
      /jeu.*non trouv|rom.*non trouv|game.*not found|no game|aucun jeu/i.test(lower)) {
    return 'miss';
  }
  return response.ok ? 'invalid' : 'error';
}

async function screenScraperLookup(target, credentials) {
  const systemId = SCREENSCRAPER_SYSTEM_IDS[target.system.id];
  if (!systemId) return { status: 'unsupported' };
  const url = new URL('https://api.screenscraper.fr/api2/jeuInfos.php');
  const params = {
    devid: credentials.devId,
    devpassword: credentials.devPassword,
    softname: 'linuxmachine-fill-art',
    ssid: credentials.user,
    sspassword: credentials.pass,
    output: 'json',
    systemeid: String(systemId),
    romtype: 'rom',
    romnom: safeDecode(String(target.game.path).replaceAll('\\', '/').split('/').pop()),
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response;
  let body;
  try {
    response = await fetchWithTimeout(url);
    body = await response.text();
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) return { status: classifyScreenScraperFailure(response, body) };
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: classifyScreenScraperFailure(response, body) };
  }
  const media = collectBoxMedia(payload).sort((left, right) =>
    screenScraperMediaScore(right, target.game) -
    screenScraperMediaScore(left, target.game));
  if (!media.length) return { status: 'miss' };
  for (const item of media.slice(0, 6)) {
    const downloaded = await downloadImage(item.url ?? item.uri, target.system.id);
    if (!downloaded.error) return { status: 'found', downloaded };
  }
  return { status: 'miss' };
}

async function restoreCachedHit(target, entry) {
  if (!entry?.artPath || !entry.artPath.startsWith('/art-fill/')) return false;
  const filePath = path.join(ROOT, 'shell', 'public',
    ...entry.artPath.split('/').filter(Boolean));
  try {
    const buffer = await readFile(filePath);
    if (validateImage(buffer, target.system.id).error) return false;
  } catch {
    return false;
  }
  target.game.art = entry.artPath;
  target.document.changed = true;
  return true;
}

async function writeChangedLibraries(layout) {
  const current = await detectLibraryDocuments();
  if (current.signature !== layout.signature) {
    throw new Error('Generated-library layout changed during the run; rerun to apply cached hits safely');
  }
  for (const document of layout.documents) {
    if (document.changed && (await readFile(document.path, 'utf8')) !== document.originalText) {
      throw new Error(`${relative(document.path)} changed during the run; rerun to avoid overwriting it`);
    }
  }
  for (const document of layout.documents) {
    if (document.changed) {
      await writeFile(document.path, `${JSON.stringify(document.data, null, 2)}\n`, 'utf8');
    }
  }
}

function remainingBreakdown(targets) {
  const counts = {};
  for (const target of targets) {
    if (target.game.art === null) {
      counts[target.system.id] = (counts[target.system.id] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(
    ([leftSystem, left], [rightSystem, right]) =>
      right - left || leftSystem.localeCompare(rightSystem)));
}

async function main() {
  const layout = await detectLibraryDocuments();
  const cache = await loadCache();
  const targets = [];
  for (const document of layout.documents) {
    for (const system of document.systems) {
      for (const game of system.games) {
        if (game.art === null) targets.push({ document, system, game });
      }
    }
  }
  const stats = {
    attempted: targets.length,
    cacheRestored: 0,
    cacheMissSkipped: 0,
    libretro: 0,
    screenscraper: 0,
    rejectedImages: 0,
  };
  console.log(`Library: ${layout.kind} (${layout.documents.length} file${layout.documents.length === 1 ? '' : 's'}), ${targets.length} missing art entries`);
  if (!targets.length) {
    console.log('Nothing to do.');
    return;
  }
  await mkdir(PUBLIC_ART_DIR, { recursive: true });

  for (const target of targets) {
    const cached = cache.entries[entryKey(target.system.id, target.game)];
    if (await restoreCachedHit(target, cached)) stats.cacheRestored += 1;
  }

  const bySystem = new Map();
  for (const target of targets) {
    if (target.game.art !== null) continue;
    const key = entryKey(target.system.id, target.game);
    const cached = cache.entries[key];
    if (cached?.libretro === 'miss') {
      stats.cacheMissSkipped += 1;
      continue;
    }
    const group = bySystem.get(target.system.id) ?? [];
    group.push(target);
    bySystem.set(target.system.id, group);
  }

  for (const [systemId, systemTargets] of bySystem) {
    const repo = LIBRETRO_REPOS[systemId];
    if (!repo) continue;
    const fetched = await fetchLibretroIndex(repo);
    if (fetched.error) {
      console.log(`libretro ${systemId}: skipped (${fetched.error})`);
      continue;
    }
    console.log(`libretro ${systemId}: ${fetched.index.count.toLocaleString()} Named_Boxarts indexed`);
    await workerPool(systemTargets, LIBRETRO_CONCURRENCY, async (target) => {
      const key = entryKey(systemId, target.game);
      const matches = libretroMatches(fetched.index, target.game);
      let found = null;
      for (const match of matches.slice(0, 6)) {
        const downloaded = await downloadImage(rawLibretroUrl(repo, match), systemId);
        if (!downloaded.error) {
          found = await saveFoundImage(target, 'libretro', downloaded);
          break;
        }
        stats.rejectedImages += 1;
      }
      if (found) {
        cache.entries[key] = { system: systemId, name: target.game.name,
          path: target.game.path, ...found };
        stats.libretro += 1;
      } else {
        cache.entries[key] = { ...(cache.entries[key] ?? {}), system: systemId,
          name: target.game.name, path: target.game.path, libretro: 'miss' };
      }
    });
    await saveCache(cache);
  }

  const fallbackTargets = targets.filter((target) => {
    if (target.game.art !== null) return false;
    const cached = cache.entries[entryKey(target.system.id, target.game)];
    if (cached?.screenscraper === 'miss') {
      stats.cacheMissSkipped += 1;
      return false;
    }
    return Boolean(SCREENSCRAPER_SYSTEM_IDS[target.system.id]);
  });

  let screenScraperStatus = fallbackTargets.length ? 'not attempted' : 'not needed';
  if (fallbackTargets.length) {
    const credentials = readScreenScraperCredentials();
    if (credentials.error) {
      screenScraperStatus = `skipped: ${credentials.error}`;
    } else {
      screenScraperStatus = 'completed';
      let lastRequestAt = 0;
      let completedSinceCheckpoint = 0;
      for (const target of fallbackTargets) {
        const waitMs = SCREENSCRAPER_DELAY_MS - (Date.now() - lastRequestAt);
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        lastRequestAt = Date.now();
        const result = await screenScraperLookup(target, credentials);
        const key = entryKey(target.system.id, target.game);
        if (result.status === 'found') {
          const found = await saveFoundImage(target, 'screenscraper', result.downloaded);
          cache.entries[key] = { ...(cache.entries[key] ?? {}),
            system: target.system.id, name: target.game.name,
            path: target.game.path, ...found };
          stats.screenscraper += 1;
        } else if (result.status === 'miss') {
          cache.entries[key] = { ...(cache.entries[key] ?? {}),
            system: target.system.id, name: target.game.name,
            path: target.game.path, screenscraper: 'miss' };
        } else if (result.status === 'auth') {
          screenScraperStatus = 'stopped: account/API authentication was rejected';
          break;
        } else if (result.status === 'quota') {
          screenScraperStatus = 'stopped: API quota/rate limit reached';
          break;
        } else if (result.status === 'unsupported') {
          screenScraperStatus = 'stopped: API requires ROM hashes/sizes unavailable to this tool';
          break;
        } else {
          screenScraperStatus = 'stopped: API request failed';
          break;
        }
        completedSinceCheckpoint += 1;
        if (completedSinceCheckpoint >= 10) {
          await saveCache(cache);
          completedSinceCheckpoint = 0;
        }
      }
      await saveCache(cache);
    }
  }

  await saveCache(cache);
  await writeChangedLibraries(layout);
  const remaining = remainingBreakdown(targets);
  const stillMissing = Object.values(remaining).reduce((sum, count) => sum + count, 0);

  console.log('\nArt fill summary');
  console.log(`attempted: ${stats.attempted}`);
  console.log(`filled from libretro: ${stats.libretro}`);
  console.log(`filled from ScreenScraper: ${stats.screenscraper}`);
  console.log(`restored from cache: ${stats.cacheRestored}`);
  console.log(`still missing: ${stillMissing}`);
  console.log(`ScreenScraper: ${screenScraperStatus}`);
  console.log(`validated/rejected image responses: ${stats.rejectedImages}`);
  console.log(`images: ${relative(PUBLIC_ART_DIR)}/`);
  console.log(`cache: ${relative(CACHE_PATH)}`);
  console.log('remaining by system:');
  for (const [systemId, count] of Object.entries(remaining)) {
    console.log(`  ${systemId}: ${count}`);
  }
}

main().catch((error) => {
  console.error(`fill-art: ${error.message}`);
  process.exitCode = 1;
});
