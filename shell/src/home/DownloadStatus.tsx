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

/**
 * Two cadences. While something is downloading the indicator is a progress
 * bar, so it has to move like one; idle it costs nothing to check rarely.
 * The bot rewrites status.json every two seconds, so polling faster than that
 * would only re-read the same file.
 */
const POLL_ACTIVE_MS = 2_000;
const POLL_IDLE_MS = 15_000;

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

    const read = async (): Promise<DownloadStatus | null> => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const value: unknown = await response.json();
        if (!isStatus(value)) return null;
        if (!cancelled) setStatus(value);
        return value;
      } catch {
        // The media PC being unreachable is not worth shouting about on the
        // wall; the indicator simply stays as it was.
        return null;
      }
    };

    // Reschedule after each read rather than on a fixed interval, so the
    // cadence can follow whether anything is actually downloading — and so a
    // slow response can never stack requests on top of each other.
    let timer = 0;
    const tick = async () => {
      const status = await read();
      if (cancelled) return;
      timer = window.setTimeout(
        () => void tick(),
        status?.active ? POLL_ACTIVE_MS : POLL_IDLE_MS,
      );
    };
    void tick();

    return () => {
      cancelled = true;
      controller.abort();
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
      <span className="topbar-download-copy">
        <span className="topbar-download-label">{label}</span>
        {status.active ? (
          <span
            className="topbar-download-track"
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="topbar-download-fill"
              // Indeterminate until a percentage arrives, rather than showing
              // a full bar for an unknown value.
              style={{ width: percent === null ? '10%' : `${Math.max(2, percent)}%` }}
              data-indeterminate={percent === null ? 'true' : undefined}
            />
          </span>
        ) : null}
      </span>
      <span className="topbar-download-count">
        {status.active
          ? percent === null
            ? '…'
            : `${Math.round(percent)}%`
          : status.pending}
      </span>
      {status.active && status.pending > 0 && (
        <span className="topbar-download-queue">+{status.pending}</span>
      )}
    </div>
  );
}
