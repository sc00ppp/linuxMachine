import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReadOnlySqlite } from './sqlite.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const botRoot = path.resolve(projectRoot, '..', 'customTVBOT');
const configPath = path.join(botRoot, 'config.json');
const fallbackDownloadRoot = 'D:\\customTV';
const fallbackDatabasePath = path.join(botRoot, 'video_tracker.db');
const outputPath = path.join(projectRoot, 'shell', 'src', 'core', 'customtv.generated.json');

const VIDEO_EXTENSIONS = new Set([
  '.3gp', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4',
  '.mpeg', '.mpg', '.ogv', '.ts', '.webm', '.wmv',
]);

function configuredPath(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const configured = value.trim();
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(botRoot, configured);
}

function normalizedFileKey(filePath) {
  return path.resolve(filePath).toLocaleLowerCase();
}

function encodedUrlPath(segments) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function titleFromFilename(filename) {
  const extension = path.extname(filename);
  return path.basename(filename, extension)
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled video';
}

function titleMatchKey(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function categoryDisplayName(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'uncategorized';
}

function stableFileId(relativePath) {
  return createHash('sha1')
    .update(relativePath.toLocaleLowerCase())
    .digest('hex')
    .slice(0, 14);
}

async function readBoxHeader(handle, offset, limit) {
  if (offset < 0 || offset + 8 > limit) return null;
  const header = Buffer.alloc(16);
  const { bytesRead } = await handle.read(
    header,
    0,
    Math.min(header.length, limit - offset),
    offset,
  );
  if (bytesRead < 8) return null;

  let size = header.readUInt32BE(0);
  const type = header.subarray(4, 8).toString('latin1');
  let headerSize = 8;
  if (size === 1) {
    if (bytesRead < 16) return null;
    const largeSize = header.readBigUInt64BE(8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(largeSize);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (size < headerSize || offset + size > limit) return null;
  return { offset, size, type, headerSize };
}

async function mp4Duration(filePath, fileSize) {
  const handle = await fs.open(filePath, 'r');
  try {
    let topOffset = 0;
    let moov = null;
    for (let boxes = 0; topOffset + 8 <= fileSize && boxes < 100_000; boxes += 1) {
      const box = await readBoxHeader(handle, topOffset, fileSize);
      if (!box) break;
      if (box.type === 'moov') {
        moov = box;
        break;
      }
      topOffset += box.size;
    }
    if (!moov) return null;

    const moovEnd = moov.offset + moov.size;
    let childOffset = moov.offset + moov.headerSize;
    while (childOffset + 8 <= moovEnd) {
      const child = await readBoxHeader(handle, childOffset, moovEnd);
      if (!child) break;
      if (child.type === 'mvhd') {
        const payload = Buffer.alloc(40);
        const { bytesRead } = await handle.read(
          payload,
          0,
          Math.min(payload.length, child.size - child.headerSize),
          child.offset + child.headerSize,
        );
        if (bytesRead < 20) return null;
        const version = payload[0];
        const timescaleOffset = version === 1 ? 20 : 12;
        const durationOffset = version === 1 ? 24 : 16;
        if (bytesRead < (version === 1 ? 32 : 20)) return null;
        const timescale = payload.readUInt32BE(timescaleOffset);
        const duration = version === 1
          ? Number(payload.readBigUInt64BE(durationOffset))
          : payload.readUInt32BE(durationOffset);
        if (!timescale || !Number.isFinite(duration) || duration <= 0) return null;
        return duration / timescale;
      }
      childOffset += child.size;
    }
    return null;
  } finally {
    await handle.close();
  }
}

function readEbmlSize(buffer, offset) {
  const first = buffer[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buffer.length) return null;

  let value = BigInt(first & (marker - 1));
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(buffer[offset + index]);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { length, value: Number(value) };
}

function ebmlElementValue(buffer, id) {
  const offset = buffer.indexOf(id);
  if (offset < 0) return null;
  const size = readEbmlSize(buffer, offset + id.length);
  if (!size) return null;
  const valueOffset = offset + id.length + size.length;
  if (valueOffset + size.value > buffer.length) return null;
  return buffer.subarray(valueOffset, valueOffset + size.value);
}

async function webmDuration(filePath, fileSize) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(Math.min(fileSize, 4 * 1024 * 1024));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const scaleBytes = ebmlElementValue(bytes, Buffer.from([0x2a, 0xd7, 0xb1]));
    const durationBytes = ebmlElementValue(bytes, Buffer.from([0x44, 0x89]));
    if (!durationBytes || ![4, 8].includes(durationBytes.length)) return null;

    let timecodeScale = 1_000_000;
    if (scaleBytes && scaleBytes.length > 0 && scaleBytes.length <= 8) {
      let parsedScale = 0n;
      for (const byte of scaleBytes) parsedScale = (parsedScale << 8n) | BigInt(byte);
      if (parsedScale <= BigInt(Number.MAX_SAFE_INTEGER)) {
        timecodeScale = Number(parsedScale);
      }
    }
    const rawDuration = durationBytes.length === 4
      ? durationBytes.readFloatBE(0)
      : durationBytes.readDoubleBE(0);
    const seconds = (rawDuration * timecodeScale) / 1_000_000_000;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } finally {
    await handle.close();
  }
}

async function aviDuration(filePath, fileSize) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(Math.min(fileSize, 1024 * 1024));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF') return null;
    const marker = bytes.indexOf(Buffer.from('avih', 'latin1'));
    if (marker < 0 || marker + 28 > bytes.length) return null;
    const microsecondsPerFrame = bytes.readUInt32LE(marker + 8);
    const totalFrames = bytes.readUInt32LE(marker + 24);
    const seconds = (microsecondsPerFrame * totalFrames) / 1_000_000;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } finally {
    await handle.close();
  }
}

async function cheapDuration(filePath, fileSize, extension) {
  try {
    if (['mp4', 'm4v', 'mov', '3gp'].includes(extension)) {
      return await mp4Duration(filePath, fileSize);
    }
    if (extension === 'webm' || extension === 'mkv') {
      return await webmDuration(filePath, fileSize);
    }
    if (extension === 'avi') return await aviDuration(filePath, fileSize);
  } catch {
    // Duration is optional. One malformed container must not hide the video.
  }
  return null;
}

async function scanVideoFiles(downloadRoot) {
  const files = [];
  const walk = async (directory, relativeSegments) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      const nextSegments = [...relativeSegments, entry.name];
      if (entry.isDirectory()) {
        await walk(absolutePath, nextSegments);
        continue;
      }
      if (!entry.isFile()) continue;
      const extensionWithDot = path.extname(entry.name).toLocaleLowerCase();
      if (!VIDEO_EXTENSIONS.has(extensionWithDot)) continue;
      const stats = await fs.stat(absolutePath);
      const extension = extensionWithDot.slice(1);
      files.push({
        absolutePath,
        key: normalizedFileKey(absolutePath),
        relativeSegments: nextSegments,
        relativePath: nextSegments.join('/'),
        filename: entry.name,
        categoryFolder: nextSegments.length > 1 ? nextSegments[0] : 'uncategorized',
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        extension,
        durationSeconds: await cheapDuration(absolutePath, stats.size, extension),
      });
    }
  };

  await walk(downloadRoot, []);
  return files;
}

function downloadRow({ rowid, values }) {
  return {
    id: values[0] ?? rowid,
    sourceUrl: String(values[1] ?? '').trim(),
    folderPath: String(values[4] ?? ''),
    downloadedAt: values[5] ? String(values[5]) : null,
    status: String(values[6] ?? ''),
    title: String(values[7] ?? '').trim(),
    filename: String(values[8] ?? '').trim(),
  };
}

function matchCompletedRow(
  row,
  fileByKey,
  filesByName,
  filesByTitle,
  downloadRoot,
) {
  const candidates = [];
  if (row.filename) {
    if (path.isAbsolute(row.filename)) candidates.push(row.filename);
    if (row.folderPath) candidates.push(path.join(row.folderPath, row.filename));
    candidates.push(path.join(downloadRoot, row.filename));
  }
  if (row.folderPath && path.extname(row.folderPath)) candidates.push(row.folderPath);

  for (const candidate of candidates) {
    const matched = fileByKey.get(normalizedFileKey(candidate));
    if (matched) return matched;
  }

  if (row.filename) {
    const named = filesByName.get(row.filename.toLocaleLowerCase()) ?? [];
    if (named.length === 1) return named[0];
    if (row.folderPath) {
      const expectedCategory = path.basename(path.normalize(row.folderPath));
      const namedInCategory = named.find(
        (file) => file.categoryFolder.toLocaleLowerCase() === expectedCategory.toLocaleLowerCase(),
      );
      if (namedInCategory) return namedInCategory;
    }
  }

  const titleKey = titleMatchKey(row.title);
  if (!titleKey) return null;
  const titled = filesByTitle.get(titleKey) ?? [];
  if (row.folderPath) {
    const expectedCategory = path.basename(path.normalize(row.folderPath));
    const titledInCategory = titled.filter(
      (file) => file.categoryFolder.toLocaleLowerCase() === expectedCategory.toLocaleLowerCase(),
    );
    if (titledInCategory.length === 1) return titledInCategory[0];
  }
  return titled.length === 1 ? titled[0] : null;
}

function uniqueCategoryIds(files) {
  const ids = new Map();
  const used = new Set();
  for (const name of [...new Set(files.map((file) => file.categoryFolder))].sort()) {
    const base = slug(name);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    ids.set(name, id);
  }
  return ids;
}

async function writeCatalog(catalog) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const partial = `${outputPath}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await fs.rename(partial, outputPath);
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const downloadRoot = configuredPath(config.download_base_path, fallbackDownloadRoot);
  const databasePath = configuredPath(config.database_path, fallbackDatabasePath);

  const [database, diskFiles] = await Promise.all([
    ReadOnlySqlite.open(databasePath),
    scanVideoFiles(downloadRoot),
  ]);
  const rows = database.table('downloads').map(downloadRow);
  const completedRows = rows.filter((row) => row.status === 'completed');
  const fileByKey = new Map(diskFiles.map((file) => [file.key, file]));
  const filesByName = new Map();
  const filesByTitle = new Map();
  for (const file of diskFiles) {
    const key = file.filename.toLocaleLowerCase();
    const matches = filesByName.get(key) ?? [];
    matches.push(file);
    filesByName.set(key, matches);

    const titleKey = titleMatchKey(titleFromFilename(file.filename));
    const titleMatches = filesByTitle.get(titleKey) ?? [];
    titleMatches.push(file);
    filesByTitle.set(titleKey, titleMatches);
  }

  const metadataByFile = new Map();
  let completedRowsMissingFiles = 0;
  for (const row of completedRows) {
    const file = matchCompletedRow(
      row,
      fileByKey,
      filesByName,
      filesByTitle,
      downloadRoot,
    );
    if (!file) {
      completedRowsMissingFiles += 1;
      continue;
    }
    const current = metadataByFile.get(file.key);
    if (!current || String(row.downloadedAt ?? '').localeCompare(String(current.downloadedAt ?? '')) > 0) {
      metadataByFile.set(file.key, row);
    }
  }

  const diskVideosWithoutCompletedRow = diskFiles.filter(
    (file) => !metadataByFile.has(file.key),
  ).length;
  const categoryIds = uniqueCategoryIds(diskFiles);
  const videos = diskFiles.map((file) => {
    const row = metadataByFile.get(file.key);
    return {
      id: row ? `db-${row.id}` : `file-${stableFileId(file.relativePath)}`,
      category: categoryIds.get(file.categoryFolder),
      title: row?.title || titleFromFilename(file.filename),
      filename: file.filename,
      // `url` is the original post/video URL. Keep the local mediaserve path
      // separate so source provenance is never lost during an import.
      url: row?.sourceUrl ?? '',
      media_url: encodedUrlPath(file.relativeSegments),
      thumbnail: null,
      thumbnail_source: null,
      size_bytes: file.sizeBytes,
      extension: file.extension,
      duration_seconds: file.durationSeconds === null
        ? null
        : Math.round(file.durationSeconds * 1000) / 1000,
      downloaded_at: row?.downloadedAt ?? file.modifiedAt,
    };
  });

  videos.sort(
    (left, right) => left.category.localeCompare(right.category)
      || String(right.downloaded_at).localeCompare(String(left.downloaded_at))
      || left.title.localeCompare(right.title),
  );
  const categories = [...categoryIds.entries()]
    .map(([name, id]) => ({
      id,
      display_name: categoryDisplayName(name),
      video_count: videos.filter((video) => video.category === id).length,
    }))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));

  const catalog = {
    generated_at: new Date().toISOString(),
    categories,
    videos,
    mismatches: {
      completed_rows_missing_files: completedRowsMissingFiles,
      disk_videos_without_completed_row: diskVideosWithoutCompletedRow,
    },
  };
  await writeCatalog(catalog);

  const durationsRead = videos.filter((video) => video.duration_seconds !== null).length;
  console.log(`Categories: ${categories.length}`);
  console.log(`Videos: ${videos.length}`);
  console.log(`Completed DB rows without files: ${completedRowsMissingFiles}`);
  console.log(`Disk videos without completed DB row: ${diskVideosWithoutCompletedRow}`);
  console.log(`Container durations read: ${durationsRead}/${videos.length}`);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
