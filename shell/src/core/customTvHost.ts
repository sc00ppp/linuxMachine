/**
 * Custom TV videos are NOT on the media PC.
 *
 * Game art lives on 192.168.1.158 (S:\RetroBat) and is served by the mediaserve
 * instance on :8099. The Discord bot downloads to `D:\customTV` on the desktop,
 * so these come off a *second* mediaserve instance on this machine:
 *
 *   mediaserve --root "D:\customTV" --bind 0.0.0.0:8100
 *
 * Pointing this at .158 was verified unreachable — those files are not there.
 * Override with `localStorage['console-customtv-host']` when the bot moves to
 * the console itself and the videos become local.
 */
export const DEFAULT_CUSTOM_TV_HOST = 'http://192.168.1.155:8100';

const STORAGE_KEY = 'console-customtv-host';

function configuredCustomTvHost(): string {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_TV_HOST;

  try {
    const configured = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (!configured) return DEFAULT_CUSTOM_TV_HOST;
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_CUSTOM_TV_HOST;
    }
    return configured.replace(/\/+$/, '');
  } catch {
    return DEFAULT_CUSTOM_TV_HOST;
  }
}

/** Base URL for the read-only Custom TV media server. */
export const customTvHost = configuredCustomTvHost();

/** Resolve an importer-produced server-root path to its playable URL. */
export function customTvUrl(path: string | null): string | null {
  if (!path) return null;

  try {
    return new URL(path, `${customTvHost}/`).toString();
  } catch {
    return null;
  }
}
