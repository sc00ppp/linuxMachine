export const DEFAULT_MEDIA_HOST = 'http://192.168.1.158:8099';

const STORAGE_KEY = 'console-media-host';

function configuredMediaHost(): string {
  if (typeof window === 'undefined') return DEFAULT_MEDIA_HOST;

  try {
    const configured = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (!configured) return DEFAULT_MEDIA_HOST;
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_MEDIA_HOST;
    }
    return configured.replace(/\/+$/, '');
  } catch {
    return DEFAULT_MEDIA_HOST;
  }
}

/** Base URL for immutable media served directly by the media PC. */
export const mediaHost = configuredMediaHost();

/** Resolve an importer-produced server-root path for existing URL consumers. */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('/art-fill/')) return path;

  try {
    return new URL(path, `${mediaHost}/`).toString();
  } catch {
    return null;
  }
}
