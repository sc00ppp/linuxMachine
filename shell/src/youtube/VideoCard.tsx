import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusable } from '../focus';
import { PlayIcon } from '../icons';
import type { YouTubeVideo } from './types';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function durationLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'Live';
  const seconds = Math.floor(totalSeconds % 60);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VideoCard({
  video,
  focusId,
  autoFocus = false,
  onOpen,
  secondaryLabel,
}: {
  video: YouTubeVideo;
  focusId: string;
  autoFocus?: boolean;
  onOpen: (video: YouTubeVideo) => void;
  secondaryLabel?: string;
}) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  const [imageFailed, setImageFailed] = useState(false);
  const { ref: focusRef, focused } = useFocusable({
    id: focusId,
    scope: 'youtube',
    autoFocus,
    onAccept: () => latestOpen.current(video),
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

  return (
    <article className="yt-video-slot">
      <button
        className="yt-video-card"
        ref={setRef}
        type="button"
        tabIndex={-1}
        data-focused={focused ? 'true' : undefined}
        onClick={() => onOpen(video)}
        aria-label={`${video.title}, by ${video.channelName}, ${durationLabel(video.durationSeconds)}`}
      >
        <span className="yt-video-art">
          {!imageFailed ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="yt-video-art-fallback" aria-hidden="true">
              <span><PlayIcon /></span>
            </span>
          )}
          <span className="yt-video-duration">
            {durationLabel(video.durationSeconds)}
          </span>
          {secondaryLabel && (
            <span className="yt-video-secondary-action">{secondaryLabel}</span>
          )}
          <span className="yt-video-rim" aria-hidden="true" />
        </span>
        <span className="yt-video-copy">
          <strong>{video.title}</strong>
          <span className="yt-video-byline">{video.channelName}</span>
          <span className="yt-video-age">{video.ageText}</span>
        </span>
      </button>
    </article>
  );
}
