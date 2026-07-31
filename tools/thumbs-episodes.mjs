#!/usr/bin/env node

/**
 * Extract fallback episode frames over mediaserve for episodes without Kodi art.
 * Kodi thumbnails installed by import-media.mjs always win. Successful and
 * failed extraction attempts are cached under the gitignored thumbnail root.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'shell', 'src', 'core', 'media.generated.json');
const thumbnailRoot = path.join(projectRoot, 'shell', 'public', 'episode-thumbs');
const cachePath = path.join(thumbnailRoot, '.cache.json');
const ffmpeg =
  process.env.FFMPEG_BIN ??
  'C:\\Users\\david\\AppData\\Local\\ffmpegio\\ffmpeg-downloader\\ffmpeg\\bin\\ffmpeg.exe';
const mediaHost = (process.env.MEDIA_HTTP ?? 'http://192.168.1.158:8099').replace(/\/+$/, '');
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

function durationFromFfmpegOutput(value) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function probeDuration(mediaUrl) {
  try {
    const result = await execFile(
      ffmpeg,
      ['-hide_banner', '-i', mediaUrl],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 60_000 },
    );
    const duration = durationFromFfmpegOutput(result.stderr ?? '');
    if (duration) return duration;
  } catch (error) {
    const duration = durationFromFfmpegOutput(String(error?.stderr ?? ''));
    if (duration) return duration;
    throw error;
  }
  throw new Error('ffmpeg did not report a duration');
}

async function installJpeg(partial, destination) {
  if (!(await isUsableJpeg(partial))) {
    throw new Error('ffmpeg output was not a valid JPEG');
  }
  await fs.rm(destination, { force: true });
  await fs.rename(partial, destination);
}

async function extractFrame(mediaUrl, destination) {
  const duration = await probeDuration(mediaUrl);
  const seek = Math.min(duration - 1, Math.max(1, duration * 0.2));
  const partial = `${destination}.${process.pid}.part.jpg`;
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
        partial,
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 120_000 },
    );
    await installJpeg(partial, destination);
  } finally {
    await fs.rm(partial, { force: true });
  }
}

async function main() {
  const manifest = await readJson(manifestPath, null);
  if (!manifest || !Array.isArray(manifest.series)) {
    throw new Error('Run tools/import-media.mjs before extracting episode thumbnails.');
  }
  const cache = await readJson(cachePath, { version: 1, items: {} });
  cache.version = 1;
  cache.items ??= {};
  const counts = { kodi: 0, extracted: 0, missing: 0 };

  for (const series of manifest.series) {
    for (const season of series.seasons ?? []) {
      for (const episode of season.episodes ?? []) {
        const destination = path.join(thumbnailRoot, series.id, `${episode.id}.jpg`);
        const publicPath = `/episode-thumbs/${series.id}/${episode.id}.jpg`;
        const cached = cache.items[episode.id];
        await fs.mkdir(path.dirname(destination), { recursive: true });

        if (await isUsableJpeg(destination)) {
          const source = cached?.source ?? episode.thumbnailSource;
          episode.thumbnail = publicPath;
          episode.thumbnailSource = source === 'extracted' ? 'extracted' : 'kodi';
          counts[episode.thumbnailSource] += 1;
          continue;
        }

        if (cached?.status === 'failed' && !retryFailed) {
          episode.thumbnail = null;
          episode.thumbnailSource = null;
          counts.missing += 1;
          console.warn(`[cached:missing] ${episode.id}: ${cached.reason}`);
          continue;
        }

        if (!episode.mediaUrl) {
          const reason = 'manifest has no mediaserve URL';
          cache.items[episode.id] = {
            status: 'failed',
            reason,
            updatedAt: new Date().toISOString(),
          };
          episode.thumbnail = null;
          episode.thumbnailSource = null;
          counts.missing += 1;
          await writeJson(cachePath, cache);
          console.warn(`[missing] ${episode.id}: ${reason}`);
          continue;
        }

        const mediaUrl = new URL(episode.mediaUrl, `${mediaHost}/`).toString();
        try {
          await extractFrame(mediaUrl, destination);
          episode.thumbnail = publicPath;
          episode.thumbnailSource = 'extracted';
          cache.items[episode.id] = {
            status: 'ok',
            source: 'extracted',
            mediaUrl: episode.mediaUrl,
            updatedAt: new Date().toISOString(),
          };
          counts.extracted += 1;
          console.log(`[extracted] ${episode.id}`);
        } catch (error) {
          const reason = detail(error);
          episode.thumbnail = null;
          episode.thumbnailSource = null;
          cache.items[episode.id] = {
            status: 'failed',
            reason,
            mediaUrl: episode.mediaUrl,
            updatedAt: new Date().toISOString(),
          };
          counts.missing += 1;
          console.warn(`[missing] ${episode.id}: ${reason}`);
        }
        await writeJson(cachePath, cache);
      }
    }
  }

  await writeJson(manifestPath, manifest);
  console.log(`Kodi thumbnails: ${counts.kodi}`);
  console.log(`Extracted frames: ${counts.extracted}`);
  console.log(`Still missing: ${counts.missing}`);
  console.log(`Wrote ${path.relative(projectRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error(detail(error));
  process.exitCode = 1;
});
