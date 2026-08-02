/**
 * Where Custom TV's video files are served from.
 *
 * These now live on the media PC at `S:\customTV`, and mediaserve's main
 * instance is already rooted at `S:\` — so the existing `:8099` server hosts
 * them at `/customTV/...` and no second server is needed. The videos used to
 * sit on the desktop behind their own instance on `:8100`; that arrangement
 * meant the deployed console pointed at a machine that might be off.
 *
 * The base therefore carries a PATH PREFIX, not just an origin, which is why
 * joining is string concatenation rather than `new URL(path, base)` — an
 * absolute path like `/gamer/clip.mp4` resolves against the origin and would
 * silently discard `/customTV`.
 */
const DEFAULT_ORIGIN = 'http://192.168.1.158:8099';
const DEFAULT_PREFIX = '/customTV';

export const DEFAULT_CUSTOM_TV_HOST = `${DEFAULT_ORIGIN}${DEFAULT_PREFIX}`;

const STORAGE_KEY = 'console-customtv-host';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function configuredCustomTvHost(): string {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_TV_HOST;

  try {
    const configured = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (!configured) return DEFAULT_CUSTOM_TV_HOST;
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_CUSTOM_TV_HOST;
    }
    return trimTrailingSlashes(configured);
  } catch {
    return DEFAULT_CUSTOM_TV_HOST;
  }
}

/** Base URL (origin plus any path prefix) for Custom TV media. */
export const customTvHost = configuredCustomTvHost();

/** Resolve an importer-produced, already-encoded root-relative media path. */
export function customTvUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${customTvHost}${suffix}`;
}

/** Resolve runtime sidecars while keeping bundled importer art on this origin. */
export function customTvThumbnailUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('/customtv-thumbs/')) return path;
  return customTvUrl(path);
}
