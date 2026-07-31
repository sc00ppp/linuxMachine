#!/usr/bin/env node

/**
 * Populate Custom TV thumbnails without downloading the source videos.
 *
 * Source artwork wins. When it is unavailable, ffmpeg seeks into the local
 * mediaserve URL and extracts one scaled frame. A sidecar cache makes both
 * successes and terminal failures resumable; pass --retry-failed to revisit
 * cached failures.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(
  projectRoot,
  'shell',
  'src',
  'core',
  'customtv.generated.json',
);
const thumbnailRoot = path.join(projectRoot, 'shell', 'public', 'customtv-thumbs');
const cachePath = path.join(thumbnailRoot, '.cache.json');
const ffmpeg =
  process.env.FFMPEG_BIN ??
  'C:\\Users\\david\\AppData\\Local\\ffmpegio\\ffmpeg-downloader\\ffmpeg\\bin\\ffmpeg.exe';
const ytDlp =
  process.env.YTDLP_BIN ??
  'C:\\Users\\david\\AppData\\Roaming\\Python\\Python313\\Scripts\\yt-dlp.exe';
const customTvHost = (process.env.CUSTOMTV_HTTP ?? 'http://192.168.1.155:8100')
  .replace(/\/+$/, '');
const retryFailed = process.argv.includes('--retry-failed');

function detail(error) {
  if (error && typeof error === 'object') {
    if ('stderr' in error && String(error.stderr).trim()) {
      return String(error.stderr).trim().split(/\r?\n/).at(-1);
    }
    if ('message' in error) return String(error.message);
  }
  return String(error);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const partial = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(partial, filePath);
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

function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const match = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(url.pathname);
      return match?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function rankedThumbnailUrls(info) {
  const rows = Array.isArray(info?.thumbnails) ? info.thumbnails : [];
  const ranked = rows
    .filter((row) => typeof row?.url === 'string' && row.url)
    .sort((left, right) => {
      const leftPixels = Number(left.width ?? 0) * Number(left.height ?? 0);
      const rightPixels = Number(right.width ?? 0) * Number(right.height ?? 0);
      return rightPixels - leftPixels || Number(right.preference ?? 0) - Number(left.preference ?? 0);
    })
    .map((row) => row.url);
  if (typeof info?.thumbnail === 'string') ranked.push(info.thumbnail);
  return [...new Set(ranked)];
}

async function sourceThumbnailUrls(sourceUrl) {
  const id = youtubeId(sourceUrl);
  if (id) {
    return {
      provider: 'youtube',
      urls: [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      ],
    };
  }

  const { stdout } = await execFile(
    ytDlp,
    [
      '--skip-download',
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      sourceUrl,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      timeout: 90_000,
    },
  );
  const info = JSON.parse(stdout);
  return { provider: String(info.extractor_key ?? info.extractor ?? 'yt-dlp'), urls: rankedThumbnailUrls(info) };
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 thumbnail-importer/1.0' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLocaleLowerCase().startsWith('image/')) {
    throw new Error(`unexpected content-type ${contentType || '(missing)'}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 128) throw new Error(`image response was only ${bytes.length} bytes`);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('image response exceeded 25 MiB');
  await fs.writeFile(destination, bytes);
}

async function installJpeg(partial, destination) {
  if (!(await isUsableJpeg(partial))) {
    throw new Error('ffmpeg output was not a valid JPEG');
  }
  await fs.rm(destination, { force: true });
  await fs.rename(partial, destination);
}

async function renderSourceThumbnail(sourceUrl, destination) {
  const { provider, urls } = await sourceThumbnailUrls(sourceUrl);
  if (urls.length === 0) throw new Error(`${provider} returned no thumbnail URL`);

  const sourcePartial = `${destination}.${process.pid}.source`;
  const outputPartial = `${destination}.${process.pid}.part.jpg`;
  const failures = [];
  try {
    for (const url of urls.slice(0, 8)) {
      try {
        await download(url, sourcePartial);
        await execFile(
          ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            sourcePartial,
            '-frames:v',
            '1',
            '-vf',
            'scale=640:-2:force_original_aspect_ratio=decrease',
            '-q:v',
            '3',
            outputPartial,
          ],
          { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 60_000 },
        );
        await installJpeg(outputPartial, destination);
        return provider;
      } catch (error) {
        failures.push(detail(error));
        await fs.rm(outputPartial, { force: true });
      }
    }
  } finally {
    await fs.rm(sourcePartial, { force: true });
    await fs.rm(outputPartial, { force: true });
  }
  throw new Error(`${provider} thumbnail candidates failed: ${failures.join(' | ')}`);
}

async function extractFrame(video, destination) {
  if (!video.media_url) throw new Error('manifest has no media_url');
  const mediaUrl = new URL(video.media_url, `${customTvHost}/`).toString();
  const duration = Number(video.duration_seconds);
  const seek = Number.isFinite(duration) && duration > 2
    ? Math.min(duration - 1, Math.max(1, duration * 0.18))
    : 10;
  const outputPartial = `${destination}.${process.pid}.part.jpg`;
  try {
    await execFile(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        seek.toFixed(3),
        '-i',
        mediaUrl,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2:force_original_aspect_ratio=decrease',
        '-q:v',
        '3',
        outputPartial,
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 90_000 },
    );
    await installJpeg(outputPartial, destination);
  } finally {
    await fs.rm(outputPartial, { force: true });
  }
}

async function main() {
  const manifest = await readJson(manifestPath, null);
  if (!manifest || !Array.isArray(manifest.videos)) {
    throw new Error('Run tools/import-customtv.mjs before generating thumbnails.');
  }
  const cache = await readJson(cachePath, { version: 1, items: {} });
  cache.version = 1;
  cache.items ??= {};
  const counts = { source: 0, extracted: 0, missing: 0 };

  for (const video of manifest.videos) {
    const destination = path.join(thumbnailRoot, video.category, `${video.id}.jpg`);
    const publicPath = `/customtv-thumbs/${video.category}/${video.id}.jpg`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const cached = cache.items[video.id];

    if (await isUsableJpeg(destination)) {
      const source = cached?.status === 'ok' ? cached.source : video.thumbnail_source;
      video.thumbnail = publicPath;
      video.thumbnail_source = source === 'extracted' ? 'extracted' : 'source';
      counts[video.thumbnail_source] += 1;
      console.log(`[cached:${video.thumbnail_source}] ${video.category}/${video.id}`);
      continue;
    }

    if (cached?.status === 'failed' && !retryFailed) {
      video.thumbnail = null;
      video.thumbnail_source = null;
      counts.missing += 1;
      console.warn(`[cached:missing] ${video.category}/${video.id}: ${cached.reason}`);
      continue;
    }

    let sourceError = 'manifest has no original source URL';
    if (video.url) {
      try {
        const provider = await renderSourceThumbnail(video.url, destination);
        video.thumbnail = publicPath;
        video.thumbnail_source = 'source';
        cache.items[video.id] = {
          status: 'ok',
          source: 'source',
          provider,
          sourceUrl: video.url,
          updatedAt: new Date().toISOString(),
        };
        counts.source += 1;
        await writeJson(cachePath, cache);
        console.log(`[source:${provider}] ${video.category}/${video.id}`);
        continue;
      } catch (error) {
        sourceError = detail(error);
      }
    }

    try {
      await extractFrame(video, destination);
      video.thumbnail = publicPath;
      video.thumbnail_source = 'extracted';
      cache.items[video.id] = {
        status: 'ok',
        source: 'extracted',
        sourceError,
        mediaUrl: video.media_url,
        updatedAt: new Date().toISOString(),
      };
      counts.extracted += 1;
      console.log(`[extracted] ${video.category}/${video.id} (source failed: ${sourceError})`);
    } catch (error) {
      const reason = `source: ${sourceError}; extraction: ${detail(error)}`;
      video.thumbnail = null;
      video.thumbnail_source = null;
      cache.items[video.id] = {
        status: 'failed',
        reason,
        sourceUrl: video.url,
        mediaUrl: video.media_url,
        updatedAt: new Date().toISOString(),
      };
      counts.missing += 1;
      console.warn(`[missing] ${video.category}/${video.id}: ${reason}`);
    }
    await writeJson(cachePath, cache);
  }

  await writeJson(manifestPath, manifest);
  console.log(`Source thumbnails: ${counts.source}`);
  console.log(`Extracted frames: ${counts.extracted}`);
  console.log(`Still missing: ${counts.missing}`);
  console.log(`Wrote ${path.relative(projectRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error(detail(error));
  process.exitCode = 1;
});
