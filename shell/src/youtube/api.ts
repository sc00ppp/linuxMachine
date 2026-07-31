import type {
  DirectStream,
  SponsorBlockCategory,
  SponsorBlockSegment,
  SponsorBlockSettings,
  YouTubeHomePayload,
  YouTubeHomeRow,
  YouTubeSubscription,
  YouTubeSubscriptionFeedPayload,
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
const SUBSCRIPTIONS_KEY = 'console-youtube-subs';
const SUBSCRIPTION_FEED_CACHE_KEY = 'console-youtube-sub-feed';
const SPONSOR_SETTINGS_KEY = 'console-youtube-sponsor-settings';
const SPONSOR_CACHE_PREFIX = 'console-youtube-sponsor-segments:';
const REQUEST_TIMEOUT_MS = 9_000;
export const YOUTUBE_CACHE_TTL_MS = 30 * 60_000;
export const SPONSOR_CACHE_TTL_MS = 24 * 60 * 60_000;

export const SPONSOR_BLOCK_CATEGORIES: readonly SponsorBlockCategory[] = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'music_offtopic',
];

const DEFAULT_SPONSOR_SETTINGS: SponsorBlockSettings = {
  sponsor: true,
  selfpromo: true,
  interaction: false,
  intro: true,
  outro: true,
  music_offtopic: false,
};

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

function channelIdFromUrl(value: string): string {
  const match = value.match(/\/channel\/([A-Za-z0-9_-]{10,40})/);
  return match?.[1] ?? '';
}

function validVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function validChannelId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,40}$/.test(value);
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
    channelId:
      stringValue(value, 'uploaderId') ||
      channelIdFromUrl(stringValue(value, 'uploaderUrl')),
    channelName: stringValue(value, 'uploaderName').trim() || 'YouTube',
    channelAvatarUrl: stringValue(value, 'uploaderAvatar'),
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
    channelId: stringValue(value, 'authorId'),
    channelName: stringValue(value, 'author').trim() || 'YouTube',
    channelAvatarUrl: '',
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

function directStreamFrom(
  payload: unknown,
  kind: InstanceKind,
): Omit<DirectStream, 'source'> | null {
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
 * Stream extraction is attempted on every configured instance concurrently.
 * Volunteer instances often fail independently; racing them avoids making the
 * living room wait through four serial timeouts before the embed fallback.
 */
export async function fetchDirectStream(
  videoId: string,
  signal?: AbortSignal,
  excludedSources: readonly string[] = [],
): Promise<DirectStream> {
  if (!validVideoId(videoId)) throw new Error('invalid video id');
  const instances = orderedInstances().filter(
    (instance) => !excludedSources.includes(instance.baseUrl),
  );
  if (instances.length === 0) throw new Error('no stream instances remain');
  const controller = new AbortController();
  const abortFromOuter = () => controller.abort();
  signal?.addEventListener('abort', abortFromOuter, { once: true });

  try {
    if (signal?.aborted) controller.abort();
    const result = await Promise.any(
      instances.map(async (instance) => {
        const path =
          instance.kind === 'piped'
            ? `/streams/${encodeURIComponent(videoId)}`
            : `/api/v1/videos/${encodeURIComponent(videoId)}`;
        const stream = directStreamFrom(
          await fetchJson(`${instance.baseUrl}${path}`, controller.signal),
          instance.kind,
        );
        if (!stream) throw new Error('no progressive stream');
        return { instance, stream };
      }),
    );
    controller.abort();
    rememberInstance(result.instance);
    return { ...result.stream, source: result.instance.baseUrl };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortFromOuter);
  }
}

function cachedVideo(value: unknown): YouTubeVideo | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value, 'id');
  const title = stringValue(value, 'title');
  const channelName = stringValue(value, 'channelName');
  const thumbnailUrl = stringValue(value, 'thumbnailUrl');
  const ageText = stringValue(value, 'ageText');
  if (
    !validVideoId(id) ||
    !title ||
    !channelName ||
    !thumbnailUrl ||
    typeof value.durationSeconds !== 'number' ||
    !ageText
  ) {
    return null;
  }
  return {
    id,
    title,
    channelId: stringValue(value, 'channelId'),
    channelName,
    channelAvatarUrl: stringValue(value, 'channelAvatarUrl'),
    thumbnailUrl,
    durationSeconds: value.durationSeconds,
    ageText,
  };
}

function cachedVideos(value: unknown): YouTubeVideo[] | null {
  if (!Array.isArray(value)) return null;
  const videos = value.map(cachedVideo);
  return videos.every((video): video is YouTubeVideo => video !== null)
    ? videos
    : null;
}

export function readYouTubeHomeCache(): YouTubeHomePayload | null {
  try {
    const raw = localStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.rows)) return null;
    if (typeof value.fetchedAt !== 'number' || typeof value.source !== 'string') {
      return null;
    }
    const rows: YouTubeHomeRow[] = [];
    for (const rawRow of value.rows) {
      if (!isRecord(rawRow)) return null;
      const id = stringValue(rawRow, 'id');
      if (id !== 'trending' && id !== 'gaming' && id !== 'music') return null;
      const videos = cachedVideos(rawRow.videos);
      if (!videos) return null;
      rows.push({ id, title: stringValue(rawRow, 'title'), videos });
    }
    return rows.length > 0
      ? { fetchedAt: value.fetchedAt, source: value.source, rows }
      : null;
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

function sortedChannelIds(subscriptions: readonly YouTubeSubscription[]): string[] {
  return [...new Set(subscriptions.map((subscription) => subscription.channelId))]
    .filter(validChannelId)
    .sort();
}

export function readYouTubeSubscriptions(): YouTubeSubscription[] {
  try {
    const raw = localStorage.getItem(SUBSCRIPTIONS_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const subscriptions: YouTubeSubscription[] = [];
    for (const item of value) {
      if (!isRecord(item)) continue;
      const channelId = stringValue(item, 'channelId');
      const name = stringValue(item, 'name').trim();
      if (!validChannelId(channelId) || !name || seen.has(channelId)) continue;
      seen.add(channelId);
      subscriptions.push({
        channelId,
        name,
        avatarUrl: stringValue(item, 'avatarUrl'),
      });
    }
    return subscriptions;
  } catch {
    return [];
  }
}

export function writeYouTubeSubscriptions(
  subscriptions: readonly YouTubeSubscription[],
): void {
  try {
    localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
  } catch {
    // Following a channel still works for this visit when storage is full.
  }
}

export function readSubscriptionFeedCache(
  subscriptions: readonly YouTubeSubscription[],
): YouTubeSubscriptionFeedPayload | null {
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_FEED_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.channelIds)) return null;
    if (typeof value.fetchedAt !== 'number' || typeof value.source !== 'string') {
      return null;
    }
    const expected = sortedChannelIds(subscriptions);
    const actual = value.channelIds.filter(
      (channelId): channelId is string => typeof channelId === 'string',
    );
    if (
      actual.length !== expected.length ||
      actual.some((channelId, index) => channelId !== expected[index])
    ) {
      return null;
    }
    const videos = cachedVideos(value.videos);
    return videos
      ? {
          channelIds: expected,
          fetchedAt: value.fetchedAt,
          source: value.source,
          videos,
        }
      : null;
  } catch {
    return null;
  }
}

function writeSubscriptionFeedCache(payload: YouTubeSubscriptionFeedPayload): void {
  try {
    localStorage.setItem(SUBSCRIPTION_FEED_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // A live feed remains useful even if this console cannot persist it.
  }
}

export async function fetchSubscriptionFeed(
  subscriptions: readonly YouTubeSubscription[],
  signal?: AbortSignal,
): Promise<YouTubeSubscriptionFeedPayload> {
  const channelIds = sortedChannelIds(subscriptions);
  if (channelIds.length === 0) {
    return { channelIds, fetchedAt: Date.now(), source: '', videos: [] };
  }
  const { value, instance } = await withInstance(
    async (candidate) => {
      if (candidate.kind !== 'piped') throw new Error('feed requires Piped');
      const payload = await fetchJson(
        `${candidate.baseUrl}/feed/unauthenticated?channels=${channelIds.join(',')}`,
        signal,
      );
      return normalizeVideos(payload, 'piped', 48);
    },
    signal,
  );
  const payload: YouTubeSubscriptionFeedPayload = {
    channelIds,
    fetchedAt: Date.now(),
    source: instance.baseUrl,
    videos: value,
  };
  writeSubscriptionFeedCache(payload);
  return payload;
}

export function readSponsorBlockSettings(): SponsorBlockSettings {
  try {
    const raw = localStorage.getItem(SPONSOR_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SPONSOR_SETTINGS };
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return { ...DEFAULT_SPONSOR_SETTINGS };
    return Object.fromEntries(
      SPONSOR_BLOCK_CATEGORIES.map((category) => [
        category,
        typeof value[category] === 'boolean'
          ? value[category]
          : DEFAULT_SPONSOR_SETTINGS[category],
      ]),
    ) as SponsorBlockSettings;
  } catch {
    return { ...DEFAULT_SPONSOR_SETTINGS };
  }
}

export function writeSponsorBlockSettings(settings: SponsorBlockSettings): void {
  try {
    localStorage.setItem(SPONSOR_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings remain active until this room closes even without persistence.
  }
}

interface SponsorSegmentCache {
  fetchedAt: number;
  segments: SponsorBlockSegment[];
}

function sponsorSegment(value: unknown): SponsorBlockSegment | null {
  if (!isRecord(value)) return null;
  if (typeof value.actionType === 'string' && value.actionType !== 'skip') {
    return null;
  }
  const category = stringValue(value, 'category') as SponsorBlockCategory;
  if (!SPONSOR_BLOCK_CATEGORIES.includes(category)) return null;
  const [start, end] = Array.isArray(value.segment)
    ? value.segment
    : [value.start, value.end];
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  ) {
    return null;
  }
  return { category, start, end };
}

export function readSponsorSegmentCache(videoId: string): SponsorSegmentCache | null {
  if (!validVideoId(videoId)) return null;
  try {
    const raw = localStorage.getItem(`${SPONSOR_CACHE_PREFIX}${videoId}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.fetchedAt !== 'number') return null;
    if (!Array.isArray(value.segments)) return null;
    const segments = value.segments.map(sponsorSegment);
    if (!segments.every((segment): segment is SponsorBlockSegment => segment !== null)) {
      return null;
    }
    return { fetchedAt: value.fetchedAt, segments };
  } catch {
    return null;
  }
}

function writeSponsorSegmentCache(
  videoId: string,
  segments: readonly SponsorBlockSegment[],
): void {
  try {
    localStorage.setItem(
      `${SPONSOR_CACHE_PREFIX}${videoId}`,
      JSON.stringify({ fetchedAt: Date.now(), segments }),
    );
  } catch {
    // Skipping still works for the current playback when storage is blocked.
  }
}

export async function fetchSponsorBlockSegments(
  videoId: string,
  signal?: AbortSignal,
): Promise<SponsorBlockSegment[]> {
  if (!validVideoId(videoId)) throw new Error('invalid video id');
  const params = new URLSearchParams({ videoID: videoId });
  for (const category of SPONSOR_BLOCK_CATEGORIES) {
    params.append('category', category);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromOuter = () => controller.abort();
  signal?.addEventListener('abort', abortFromOuter, { once: true });

  try {
    if (signal?.aborted) controller.abort();
    const response = await fetch(
      `https://sponsor.ajay.app/api/skipSegments?${params}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      },
    );
    if (response.status === 404) {
      writeSponsorSegmentCache(videoId, []);
      return [];
    }
    if (!response.ok) throw new Error('sponsor data unavailable');
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error('invalid sponsor data');
    const segments = payload
      .map(sponsorSegment)
      .filter((segment): segment is SponsorBlockSegment => segment !== null)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    writeSponsorSegmentCache(videoId, segments);
    return segments;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromOuter);
  }
}
