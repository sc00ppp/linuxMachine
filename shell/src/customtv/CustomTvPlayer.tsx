import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { customTvUrl } from '../core/customTvHost';
import { useFocusable } from '../focus';
import { sound } from '../sound';
import type { CustomTvVideo } from './catalog';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function TransportButton({
  id,
  label,
  onAccept,
  autoFocus,
  wide,
  children,
}: {
  id: string;
  label: string;
  onAccept: () => void;
  autoFocus?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const latestAccept = useRef(onAccept);
  latestAccept.current = onAccept;
  const { ref, focused } = useFocusable({
    id,
    scope: 'customtv',
    autoFocus,
    onAccept: () => latestAccept.current(),
  });

  return (
    <button
      className={`ctv-transport-button${wide ? ' ctv-transport-button--wide' : ''}`}
      ref={ref}
      type="button"
      tabIndex={-1}
      data-focused={focused ? 'true' : undefined}
      aria-label={label}
      onClick={onAccept}
      data-customtv-player-back={id === 'ctv-player-back' ? 'true' : undefined}
    >
      {children}
    </button>
  );
}

export function CustomTvPlayer({
  video,
  categoryName,
  onBack,
  onUnavailable,
}: {
  video: CustomTvVideo;
  categoryName: string;
  onBack: () => void;
  onUnavailable: (id: string) => void;
}) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const sourceUrl = useMemo(() => customTvUrl(video.url), [video.url]);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration_seconds ?? 0);
  const [failed, setFailed] = useState(sourceUrl === null);

  const togglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    sound.play('accept');
    if (media.paused) {
      void media.play().catch(() => setPlaying(false));
    } else {
      media.pause();
    }
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const media = mediaRef.current;
      if (!media) return;
      sound.play('tick');
      const next = clamp(
        media.currentTime + delta,
        0,
        media.duration || duration || media.currentTime + delta,
      );
      media.currentTime = next;
      setCurrentTime(next);
    },
    [duration],
  );

  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const failCalmly = () => {
    setFailed(true);
    setPlaying(false);
    onUnavailable(video.id);
  };

  return (
    <section className="ctv-player" aria-label={`Playing ${video.title}`}>
      <div className="ctv-player-video">
        {sourceUrl && (
          <video
            ref={mediaRef}
            src={sourceUrl}
            autoPlay
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              const loadedDuration = event.currentTarget.duration;
              if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
                setDuration(loadedDuration);
              }
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={failCalmly}
          />
        )}
        <div className="ctv-player-shade" aria-hidden="true" />
      </div>

      <div className="ctv-player-title">
        <strong>{video.title}</strong>
        <span>{categoryName}</span>
      </div>

      {failed && (
        <div className="ctv-player-error glass glass--strong" role="status">
          <span className="ctv-player-error-mark" aria-hidden="true">◇</span>
          <strong>This tape isn’t on the shelf right now.</strong>
          <span>The rest of Custom TV is still here.</span>
        </div>
      )}

      <div className="ctv-transport glass glass--strong">
        <div className="ctv-transport-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="ctv-transport-row">
          <TransportButton
            id="ctv-player-back"
            label="Back to Custom TV"
            onAccept={() => {
              sound.play('back');
              onBack();
            }}
            autoFocus={failed}
            wide
          >
            <span aria-hidden="true">←</span>
            <span>Channels</span>
          </TransportButton>

          {!failed && (
            <>
              <TransportButton
                id="ctv-player-rewind"
                label="Go back 15 seconds"
                onAccept={() => seekBy(-15)}
              >
                <span aria-hidden="true">↶</span>
                <small>15</small>
              </TransportButton>
              <TransportButton
                id="ctv-player-toggle"
                label={playing ? 'Pause' : 'Play'}
                onAccept={togglePlayback}
                autoFocus
              >
                <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
              </TransportButton>
              <TransportButton
                id="ctv-player-forward"
                label="Go forward 15 seconds"
                onAccept={() => seekBy(15)}
              >
                <span aria-hidden="true">↷</span>
                <small>15</small>
              </TransportButton>
            </>
          )}

          <span className="ctv-transport-time">
            {failed ? 'Unavailable' : `${clockLabel(currentTime)} / ${clockLabel(duration)}`}
          </span>
        </div>
      </div>
    </section>
  );
}
