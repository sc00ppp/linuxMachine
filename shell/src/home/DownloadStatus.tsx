import { useEffect, useState } from 'react';
import { customTvUrl } from '../core/customTvHost';

/**
 * What the Discord downloader is doing, in the corner of the wall.
 *
 * The bot runs headless on the media PC, so until now the only evidence it was
 * working was files quietly appearing. A small indicator turns that into
 * something you can see from the sofa — and, more usefully, tells you when it
 * has stopped.
 *
 * It reads a status file published beside the media rather than talking to the
 * bot, so nothing here depends on the bot being reachable, and a console with
 * no downloader simply shows nothing.
 */

interface DownloadStatus {
  pending: number;
  completed: number;
  failed: number;
  active: { title: string | null; percent: number | null } | null;
}

/** Slow enough to be free, quick enough that a finished download is noticed. */
const POLL_MS = 20_000;

function isStatus(value: unknown): value is DownloadStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DownloadStatus>;
  return typeof candidate.pending === 'number';
}

export function DownloadStatus() {
  const [status, setStatus] = useState<DownloadStatus | null>(null);

  useEffect(() => {
    const url = customTvUrl('/status.json');
    if (!url) return;

    let cancelled = false;
    const controller = new AbortController();

    const read = async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (!cancelled && isStatus(value)) setStatus(value);
      } catch {
        // The media PC being unreachable is not worth shouting about on the
        // wall; the indicator simply stays as it was.
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      window.clearTimeout(timer);
    };
  }, []);

  // Nothing queued and nothing running is the normal state, and the wall stays
  // quiet for it. This is an indicator, not a dashboard.
  if (!status || (status.pending === 0 && !status.active)) return null;

  const percent = status.active?.percent ?? null;
  const label = status.active?.title
    ? status.active.title
    : `${status.pending} queued`;

  return (
    <div
      className="topbar-status topbar-download"
      title={
        status.active?.title
          ? `Downloading ${status.active.title}${percent === null ? '' : ` — ${Math.round(percent)}%`}`
          : `${status.pending} video${status.pending === 1 ? '' : 's'} queued`
      }
      aria-live="polite"
    >
      <svg className="topbar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v10m0 0 4-4m-4 4-4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="topbar-download-count">
        {status.active ? (percent === null ? '…' : `${Math.round(percent)}%`) : status.pending}
      </span>
      <span className="topbar-download-label">{label}</span>
    </div>
  );
}
