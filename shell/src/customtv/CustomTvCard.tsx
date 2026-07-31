import { useCallback, useEffect, useRef } from 'react';
import { useFocusable } from '../focus';
import { PlayIcon } from '../icons';
import type { CustomTvVideo } from './catalog';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function CustomTvCard({
  video,
  focusId,
  categoryName,
  autoFocus,
  unavailable,
  onOpen,
}: {
  video: CustomTvVideo;
  focusId: string;
  categoryName: string;
  autoFocus: boolean;
  unavailable: boolean;
  onOpen: (video: CustomTvVideo, focusId: string) => void;
}) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  const { ref: focusRef, focused } = useFocusable({
    id: focusId,
    scope: 'customtv',
    autoFocus,
    onAccept: () => latestOpen.current(video, focusId),
  });
  const setRef = useCallback(
    (element: HTMLButtonElement | null) => {
      elementRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );

  useEffect(() => {
    if (!focused) return;
    elementRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [focused]);

  const duration = durationLabel(video.duration_seconds);
  const size = fileSizeLabel(video.size_bytes);
  const date = dateLabel(video.downloaded_at);

  return (
    <article className="ctv-video-slot">
      <button
        className="ctv-video-card"
        ref={setRef}
        type="button"
        tabIndex={-1}
        data-focused={focused ? 'true' : undefined}
        data-unavailable={unavailable ? 'true' : undefined}
        onClick={() => onOpen(video, focusId)}
        aria-label={`${video.title}, ${categoryName}${duration ? `, ${duration}` : ''}${unavailable ? ', currently unavailable' : ''}`}
      >
        <span className="ctv-video-art">
          {video.thumbnail && (
            <img
              className="ctv-video-thumbnail"
              src={video.thumbnail}
              alt=""
              loading="lazy"
            />
          )}
          <span className="ctv-card-air" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="ctv-card-play" aria-hidden="true"><PlayIcon /></span>
          <span className="ctv-card-extension">{video.extension.toUpperCase()}</span>
          {duration && <span className="ctv-card-duration">{duration}</span>}
          {unavailable && <span className="ctv-card-unavailable">Off shelf</span>}
          <span className="ctv-video-rim" aria-hidden="true" />
        </span>
        <span className="ctv-video-copy">
          <strong>{video.title}</strong>
          <span>{size}</span>
          <span>{date}</span>
        </span>
      </button>
    </article>
  );
}
