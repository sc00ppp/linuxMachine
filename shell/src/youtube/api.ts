import type {
  DirectStream,
  YouTubeHomePayload,
  YouTubeHomeRow,
  YouTubeVideo,
} from './types';

type InstanceKind = 'piped' | 'invidious';

interface YouTubeInstance {
  baseUrl: string;
  kind: InstanceKind;
}

type UnknownRecord = Record<string, unknown>;

const LAST_INSTANCE_KEY = 'console-youtube-instance';
const HOME_CACHE_KEY = 'console-youtube-home';
const REQUEST_TIMEOUT_MS = 9_000;

/**
 * Public frontends are volunteer infrastructure and fail independently.
 * private.coffee was live and CORS-enabled when this room was built; the
 * others are deliberately retained as recovery paths rather than assumed
 * healthy. The last successful base URL is promoted to the front on the next
 * request, so a console does not repeatedly wait on a known-bad first hop.
 */
const INSTANCES: readonly YouTubeInstance[] = [
  { baseUrl: 'https://api.piped.private.coffee', kind: 'piped' },
  { baseUrl: 'https://pipedapi.kavin.rocks', kind: 'piped' },
  { baseUrl: 'https://pipedapi.reallyaweso.me', kind: 'piped' },
  { baseUrl: 'https://inv.zoomerville.com', kind: 'invidious' },
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedInstance(): string | null {
  try {
    return localStorage.getItem(LAST_INSTANCE_KEY);
  } catch {
    return null;
  }
}

function rememberInstance(instance: YouTubeInstance): void {
  try {
    localStorage.setItem(LAST_INSTANCE_KEY, instance.baseUrl);
  } catch {
    // Private browsing and full storage should not make live data unusable.
  }
}

function orderedInstances(): YouTubeInstance[] {
  const remembered = storedInstance();
  if (!remembered) return [...INSTANCES];
  return [...INSTANCES].sort((a, b) => {
    if (a.baseUrl === remembered) return -1;
    if (b.baseUrl === remembered) return 1;
    return 0;
  });
}

async function fetchJson(url: string, outerSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromOuter = () => controller.abort();
  outerSignal?.addEventListener('abort', abortFromOuter, { once: true });

  try {
    if (outerSignal?.aborted) controller.abort();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.toLowerCase().includes('json')) {
      throw new Error('unusable response');
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abortFromOuter);
  }
}

async function withInstance<T>(
  operation: (instance: YouTubeInstance) => Promise<T>,
  outerSignal?: AbortSignal,
): Promise<{ value: T; instance: YouTubeInstance }> {
  for (const instance of orderedInstances()) {
    if (outerSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const value = await operation(instance);
      rememberInstance(instance);
      return { value, instance };
    } catch (error) {
      if (outerSignal?.aborted) throw error;
      // A bad payload is equivalent to a down instance. Keep moving quietly.
    }
  }
  throw new Error('youtube instances unavailable');
}

function stringValue(record: UnknownRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function numberValue(record: UnknownRecord, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function videoIdFromUrl(value: string): string {
  const match = value.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
  return match?.[1] ?? '';
}

function validVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function relativeFromTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Recently';
  const timestamp = value > 10_000_000_000 ? value : value * 1_000;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr ago`;
  if (seconds < 2_592_000) {
    const days = Math.floor(seconds / 86_400);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  if (seconds < 31_536_000) {
    const months = Math.floor(seconds / 2_592_000);
    return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  }
  const years = Math.floor(seconds / 31_536_000);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function normalizePipedVideo(value: unknown): YouTubeVideo | null {
  if (!isRecord(value)) return null;
  const type = stringValue(value, 'type');
  if (type && type !== 'stream' && type !== 'video') return null;

  const explicitId = stringValue(value, 'videoId');
  const id = explicitId || videoIdFromUrl(stringValue(value, 'url'));
  const title = stringValue(value, 'title').trim();
  if (!validVideoId(id) || !title) return null;

  return {
    id,
    title,
    channelName: stringValue(value, 'uploaderName').trim() || 'YouTube',
    thumbnailUrl:
      stringValue(value, 'thumbnail') ||
      `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
    durationSeconds: Math.max(0, numberValue(value, 'duration')),
    ageText:
      stringValue(value, 'uploadedDate').trim() ||
      relativeFromTimestamp(numberValue(value, 'uploaded')),
  };
}

function invidiousThumbnail(record: UnknownRecord, id: string): string {
  const thumbnails = record.videoThumbnails;
  if (Array.isArray(thumbnails)) {
    const candidates = thumbnails
      .filter(isRecord)
      .map((thumbnail) => ({
        url: stringValue(thumbnail, 'url'),
        width: numberValue(thumbnail, 'width'),
      }))
      .filter((thumbnail) => thumbnail.url);
    candidates.sort((a, b) => b.width - a.width);
    if (candidates[0]?.url) return candidates[0].url;
  }
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

function normalizeInvidiousVideo(value: unknown): YouTubeVideo | null {
  if (!isRecord(value)) return null;
  const type = stringValue(value, 'type');
  if (type && type !== 'video') return null;

  const id = stringValue(value, 'videoId');
  const title = stringValue(value, 'title').trim();
  if (!validVideoId(id) || !title) return null;

  return {
    id,
    title,
    channelName: stringValue(value, 'author').trim() || 'YouTube',
    thumbnailUrl: invidiousThumbnail(value, id),
    durationSeconds: Math.max(0, numberValue(value, 'lengthSeconds')),
    ageText:
      stringValue(value, 'publishedText').trim() ||
      relativeFromTimestamp(numberValue(value, 'published')),
  };
}

function normalizeVideos(
  payload: unknown,
  kind: InstanceKind,
  limit: number,
): YouTubeVideo[] {
  const rawItems =
    kind === 'piped' && isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];
  const normalize =
    kind === 'piped' ? normalizePipedVideo : normalizeInvidiousVideo;
  const seen = new Set<string>();
  const videos: YouTubeVideo[] = [];

  for (const item of rawItems) {
    const video = normalize(item);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  return videos;
}

async function fetchTrending(
  instance: YouTubeInstance,
  signal?: AbortSignal,
): Promise<YouTubeVideo[]> {
  const path =
    instance.kind === 'piped'
      ? '/trending?region=US'
      : '/api/v1/trending?region=US';
  return normalizeVideos(
    await fetchJson(`${instance.baseUrl}${path}`, signal),
    instance.kind,
    12,
  );
}

async function fetchSearchOn(
  instance: YouTubeInstance,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<YouTubeVideo[]> {
  const encoded = encodeURIComponent(query);
  const path =
    instance.kind === 'piped'
      ? `/search?q=${encoded}&filter=videos`
      : `/api/v1/search?q=${encoded}&type=video&sort_by=relevance`;
  return normalizeVideos(
    await fetchJson(`${instance.baseUrl}${path}`, signal),
    instance.kind,
    limit,
  );
}

function requireVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  if (videos.length === 0) throw new Error('empty video payload');
  return videos;
}

export async function fetchYouTubeHome(
  signal?: AbortSignal,
): Promise<YouTubeHomePayload> {
  const { value, instance } = await withInstance(
    async (candidate) => {
      const [trending, gaming, music] = await Promise.all([
        fetchTrending(candidate, signal),
        fetchSearchOn(candidate, 'Gaming', 12, signal),
        fetchSearchOn(candidate, 'Music', 12, signal),
      ]);
      return {
        trending: requireVideos(trending),
        gaming: requireVideos(gaming),
        music: requireVideos(music),
      };
    },
    signal,
  );

  const rows: YouTubeHomeRow[] = [
    { id: 'trending', title: 'Trending', videos: value.trending },
    { id: 'gaming', title: 'Gaming', videos: value.gaming },
    { id: 'music', title: 'Music', videos: value.music },
  ];
  const payload: YouTubeHomePayload = {
    fetchedAt: Date.now(),
    source: instance.baseUrl,
    rows,
  };
  writeYouTubeHomeCache(payload);
  return payload;
}

export async function searchYouTube(
  query: string,
  signal?: AbortSignal,
): Promise<YouTubeVideo[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const { value } = await withInstance(
    async (instance) =>
      requireVideos(await fetchSearchOn(instance, cleaned, 28, signal)),
    signal,
  );
  return value;
}

function directStreamFrom(payload: unknown, kind: InstanceKind): DirectStream | null {
  if (!isRecord(payload)) return null;
  const key = kind === 'piped' ? 'videoStreams' : 'formatStreams';
  const rawStreams = payload[key];
  if (!Array.isArray(rawStreams)) return null;

  const candidates = rawStreams
    .filter(isRecord)
    .filter((stream) =>
      kind === 'piped' ? stream.videoOnly !== true : true,
    )
    .map((stream) => ({
      url: stringValue(stream, 'url'),
      mimeType:
        stringValue(stream, 'mimeType') || stringValue(stream, 'type') || undefined,
      height:
        numberValue(stream, 'height') ||
        Number.parseInt(stringValue(stream, 'qualityLabel'), 10) ||
        0,
    }))
    .filter((stream) => stream.url && stream.height <= 1_080)
    .sort((a, b) => b.height - a.height);

  const best = candidates[0];
  return best ? { url: best.url, mimeType: best.mimeType } : null;
}

/**
 * Secondary playback only. Public extractor IPs are frequently challenged by
 * YouTube, so the room first uses the official privacy-enhanced embed.
 */
export async function fetchDirectStream(
  videoId: string,
  signal?: AbortSignal,
): Promise<DirectStream> {
  if (!validVideoId(videoId)) throw new Error('invalid video id');
  const { value } = await withInstance(
    async (instance) => {
      const path =
        instance.kind === 'piped'
          ? `/streams/${encodeURIComponent(videoId)}`
          : `/api/v1/videos/${encodeURIComponent(videoId)}`;
      const stream = directStreamFrom(
        await fetchJson(`${instance.baseUrl}${path}`, signal),
        instance.kind,
      );
      if (!stream) throw new Error('no progressive stream');
      return stream;
    },
    signal,
  );
  return value;
}

function isCachedVideo(value: unknown): value is YouTubeVideo {
  if (!isRecord(value)) return false;
  return (
    validVideoId(stringValue(value, 'id')) &&
    Boolean(stringValue(value, 'title')) &&
    Boolean(stringValue(value, 'channelName')) &&
    Boolean(stringValue(value, 'thumbnailUrl')) &&
    typeof value.durationSeconds === 'number' &&
    Boolean(stringValue(value, 'ageText'))
  );
}

function isCachedHome(value: unknown): value is YouTubeHomePayload {
  if (!isRecord(value) || !Array.isArray(value.rows)) return false;
  return (
    typeof value.fetchedAt === 'number' &&
    typeof value.source === 'string' &&
    value.rows.length > 0 &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        typeof row.title === 'string' &&
        Array.isArray(row.videos) &&
        row.videos.every(isCachedVideo),
    )
  );
}

export function readYouTubeHomeCache(): YouTubeHomePayload | null {
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isCachedHome(value) ? value : null;
  } catch {
    return null;
  }
}

function writeYouTubeHomeCache(payload: YouTubeHomePayload): void {
  try {
    localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // The live room is still useful when storage is unavailable.
  }
}
