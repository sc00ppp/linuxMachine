import type { NewsFeedDefinition } from './feeds';

const RSS2JSON_ENDPOINT = 'https://api.rss2json.com/v1/api.json';
const CACHE_PREFIX = 'console-news:v1:';
const MAX_STORIES = 12;

export interface NewsStory {
  id: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  imageUrl: string | null;
  link: string | null;
}

interface CacheEnvelope {
  savedAt: string;
  stories: NewsStory[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Feed descriptions are arbitrary internet HTML. DOMParser creates an inert
 * document, after which executable/non-content nodes are removed and only
 * textContent leaves this function. Nothing from a feed is ever injected into
 * the live document.
 */
export function stripFeedHtml(value: string): string {
  if (!value) return '';

  if (typeof DOMParser === 'undefined') {
    // The app is browser-only; this conservative fallback exists for unusual
    // pre-render/test environments where DOMParser is absent.
    return compactWhitespace(value.replace(/<[^>]*>/g, ' '));
  }

  const document = new DOMParser().parseFromString(value, 'text/html');
  for (const node of document.querySelectorAll(
    'script, style, template, noscript, iframe, object, embed',
  )) {
    node.remove();
  }
  return compactWhitespace(document.body.textContent ?? '');
}

function safeHttpUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizedDate(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const value =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
      ? `${raw.replace(' ', 'T')}Z`
      : raw;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function storyId(
  feed: NewsFeedDefinition,
  index: number,
  title: string,
  publishedAt: string | null,
): string {
  // A readable, stable-enough identifier without pulling in a hashing package.
  const seed = `${title}|${publishedAt ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${feed.id}-${index}-${(hash >>> 0).toString(36)}`;
}

function imageFromHtml(html: string, base?: string): string | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  return safeHttpUrl(document.querySelector('img')?.getAttribute('src'), base);
}

function normalizeStory(
  feed: NewsFeedDefinition,
  value: {
    title: unknown;
    summary?: unknown;
    publishedAt?: unknown;
    imageUrl?: unknown;
    link?: unknown;
  },
  index: number,
): NewsStory | null {
  const title =
    typeof value.title === 'string' ? stripFeedHtml(value.title) : '';
  if (!title) return null;

  const rawSummary =
    typeof value.summary === 'string' ? value.summary : '';
  const summary =
    stripFeedHtml(rawSummary) ||
    `A new story from ${feed.source}, ready when you are.`;
  const publishedAt = normalizedDate(value.publishedAt);

  return {
    id: storyId(feed, index, title, publishedAt),
    title,
    summary,
    publishedAt,
    imageUrl: safeHttpUrl(value.imageUrl, feed.url),
    link: safeHttpUrl(value.link, feed.url),
  };
}

function parseRss2Json(
  feed: NewsFeedDefinition,
  payload: unknown,
): NewsStory[] {
  if (!isRecord(payload) || payload.status !== 'ok' || !Array.isArray(payload.items)) {
    throw new Error('The RSS bridge returned an invalid payload');
  }

  const stories = payload.items
    .slice(0, MAX_STORIES)
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const enclosure = isRecord(item.enclosure) ? item.enclosure : null;
      const rawSummary =
        typeof item.description === 'string' && item.description.trim() !== ''
          ? item.description
          : typeof item.content === 'string'
            ? item.content
            : '';
      const embeddedImage = imageFromHtml(rawSummary, feed.url);

      return normalizeStory(
        feed,
        {
          title: item.title,
          summary: rawSummary,
          publishedAt: item.pubDate,
          imageUrl:
            item.thumbnail ||
            embeddedImage ||
            enclosure?.link ||
            enclosure?.url,
          link: item.link,
        },
        index,
      );
    })
    .filter((story): story is NewsStory => story !== null);

  if (stories.length === 0) throw new Error('The RSS bridge returned no stories');
  return stories;
}

function directChild(
  element: Element,
  names: readonly string[],
): Element | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return (
    Array.from(element.children).find((child) =>
      wanted.has(child.localName.toLowerCase()),
    ) ?? null
  );
}

function childText(element: Element, names: readonly string[]): string {
  return directChild(element, names)?.textContent ?? '';
}

function xmlLink(item: Element, feedUrl: string): string | null {
  const linkElements = Array.from(item.children).filter(
    (child) => child.localName.toLowerCase() === 'link',
  );
  const atomLink =
    linkElements.find((link) => {
      const rel = link.getAttribute('rel');
      return !rel || rel === 'alternate';
    }) ?? linkElements[0];
  return safeHttpUrl(
    atomLink?.getAttribute('href') ?? atomLink?.textContent,
    feedUrl,
  );
}

function xmlImage(
  item: Element,
  description: string,
  feedUrl: string,
): string | null {
  for (const child of Array.from(item.children)) {
    const name = child.localName.toLowerCase();
    if (name !== 'thumbnail' && name !== 'content' && name !== 'enclosure') {
      continue;
    }

    const type = child.getAttribute('type') ?? '';
    const medium = child.getAttribute('medium') ?? '';
    if (
      (type && !type.startsWith('image/')) ||
      (medium && medium !== 'image')
    ) {
      continue;
    }

    const url = safeHttpUrl(
      child.getAttribute('url') ?? child.getAttribute('href'),
      feedUrl,
    );
    if (url) return url;
  }

  return imageFromHtml(description, feedUrl);
}

function parseXmlFeed(feed: NewsFeedDefinition, xml: string): NewsStory[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('The direct feed response was not valid XML');
  }

  const entries = Array.from(document.querySelectorAll('item, entry')).slice(
    0,
    MAX_STORIES,
  );
  const stories = entries
    .map((item, index) => {
      const summary = childText(item, [
        'description',
        'summary',
        'content',
        'encoded',
      ]);
      return normalizeStory(
        feed,
        {
          title: childText(item, ['title']),
          summary,
          publishedAt: childText(item, [
            'pubdate',
            'published',
            'updated',
            'date',
          ]),
          imageUrl: xmlImage(item, summary, feed.url),
          link: xmlLink(item, feed.url),
        },
        index,
      );
    })
    .filter((story): story is NewsStory => story !== null);

  if (stories.length === 0) throw new Error('The direct feed returned no stories');
  return stories;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

/**
 * rss2json is the CORS-friendly path. Some publishers allow browser CORS
 * directly, so a local XML/Atom parser is the useful fallback when the bridge
 * is rate-limited or unavailable.
 */
export async function fetchNewsFeed(
  feed: NewsFeedDefinition,
  signal: AbortSignal,
): Promise<NewsStory[]> {
  const bridgeUrl = new URL(RSS2JSON_ENDPOINT);
  bridgeUrl.searchParams.set('rss_url', feed.url);

  try {
    const response = await fetch(bridgeUrl, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('The RSS bridge is unavailable');
    return parseRss2Json(feed, await response.json());
  } catch {
    throwIfAborted(signal);
  }

  const response = await fetch(feed.url, {
    signal,
    headers: {
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (!response.ok) throw new Error('The direct feed is unavailable');
  return parseXmlFeed(feed, await response.text());
}

function normalizeCachedStory(
  feed: NewsFeedDefinition,
  value: unknown,
  index: number,
): NewsStory | null {
  if (!isRecord(value)) return null;
  return normalizeStory(
    feed,
    {
      title: value.title,
      summary: value.summary,
      publishedAt: value.publishedAt,
      imageUrl: value.imageUrl,
      link: value.link,
    },
    index,
  );
}

export function readNewsCache(feed: NewsFeedDefinition): NewsStory[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${feed.id}`);
    if (!raw) return [];
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || !Array.isArray(envelope.stories)) return [];
    return envelope.stories
      .slice(0, MAX_STORIES)
      .map((story, index) => normalizeCachedStory(feed, story, index))
      .filter((story): story is NewsStory => story !== null);
  } catch {
    return [];
  }
}

export function writeNewsCache(
  feed: NewsFeedDefinition,
  stories: readonly NewsStory[],
): void {
  if (typeof localStorage === 'undefined' || stories.length === 0) return;

  const envelope: CacheEnvelope = {
    savedAt: new Date().toISOString(),
    stories: stories.slice(0, MAX_STORIES),
  };

  try {
    localStorage.setItem(`${CACHE_PREFIX}${feed.id}`, JSON.stringify(envelope));
  } catch {
    // Private browsing and full storage quotas should never break the channel.
  }
}
