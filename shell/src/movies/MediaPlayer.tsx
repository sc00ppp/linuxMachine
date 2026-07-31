import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFocusable } from '../focus';
import { sound } from '../sound';
import type { MediaPlaybackItem } from './mediaPlayback';

const RESUME_PREFIX = 'console-media-resume-v1:';

interface ResumeRecord {
  position: number;
  duration: number;
  updatedAt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function readResume(key: string): ResumeRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(`${RESUME_PREFIX}${key}`) ?? 'null') as
      | Partial<ResumeRecord>
      | null;
    if (!value || !Number.isFinite(value.position) || !Number.isFinite(value.duration)) {
      return null;
    }
    const position = Number(value.position);
    const duration = Number(value.duration);
    return position >= 30 && duration - position >= 60
      ? { position, duration, updatedAt: Number(value.updatedAt) || 0 }
      : null;
  } catch {
    return null;
  }
}

function saveResume(key: string, position: number, duration: number): void {
  try {
    if (position < 10 || (duration > 0 && duration - position < 45)) {
      localStorage.removeItem(`${RESUME_PREFIX}${key}`);
      return;
    }
    localStorage.setItem(
      `${RESUME_PREFIX}${key}`,
      JSON.stringify({ position, duration, updatedAt: Date.now() } satisfies ResumeRecord),
    );
  } catch {
    // Storage pressure must not interrupt playback.
  }
}

function clearResume(key: string): void {
  try {
    localStorage.removeItem(`${RESUME_PREFIX}${key}`);
  } catch {
    // Private mode can reject writes; playback still works.
  }
}

function subtitleUrl(sourceUrl: string, suffix: string): string {
  return sourceUrl.replace(/\.[^./?]+(?=\?|$)/, suffix);
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
    scope: 'movies',
    autoFocus,
    onAccept: () => latestAccept.current(),
  });
  return (
    <button
      className={`movies-transport-button${wide ? ' movies-transport-button--wide' : ''}`}
      ref={ref}
      type="button"
      tabIndex={-1}
      data-focused={focused ? 'true' : undefined}
      aria-label={label}
      onClick={onAccept}
    >
      {children}
    </button>
  );
}

export function MediaPlayer({
  item,
  onBack,
}: {
  item: MediaPlaybackItem;
  onBack: () => void;
}) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedSecond = useRef(0);
  const resume = useMemo(() => readResume(item.key), [item.key]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [playing, setPlaying] = useState(!resume);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(resume?.duration ?? 0);
  const [offerResume, setOfferResume] = useState(Boolean(resume));
  const [failed, setFailed] = useState(item.sourceCandidates.length === 0);
  const sourceUrl = item.sourceCandidates[sourceIndex] ?? null;

  const persist = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    saveResume(item.key, media.currentTime, media.duration || duration);
  }, [duration, item.key]);

  useEffect(() => () => persist(), [persist]);

  const back = useCallback(() => {
    persist();
    sound.play('back');
    sound.duck(false);
    onBack();
  }, [onBack, persist]);

  const togglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    sound.play('accept');
    if (media.paused) {
      void media.play().catch(() => setPlaying(false));
    } else {
      media.pause();
      persist();
    }
  }, [persist]);

  const seekBy = useCallback((delta: number) => {
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
  }, [duration]);

  const continuePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media || !resume) return;
    sound.play('accept');
    media.currentTime = clamp(resume.position, 0, media.duration || resume.duration);
    setCurrentTime(media.currentTime);
    setOfferResume(false);
    void media.play().catch(() => setPlaying(false));
  }, [resume]);

  const startOver = useCallback(() => {
    const media = mediaRef.current;
    sound.play('accept');
    clearResume(item.key);
    if (media) media.currentTime = 0;
    setCurrentTime(0);
    setOfferResume(false);
    void media?.play().catch(() => setPlaying(false));
  }, [item.key]);

  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;

  return (
    <section className="movies-player" aria-label={`Playing ${item.title}`}>
      <div className="movies-player-video">
        {sourceUrl && (
          <video
            key={sourceUrl}
            ref={mediaRef}
            src={sourceUrl}
            autoPlay={!offerResume}
            playsInline
            preload="metadata"
            poster={item.poster ?? undefined}
            onLoadedMetadata={(event) => {
              const loadedDuration = event.currentTarget.duration;
              if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
                setDuration(loadedDuration);
              }
            }}
            onTimeUpdate={(event) => {
              const next = event.currentTarget.currentTime;
              setCurrentTime(next);
              if (Math.abs(next - lastSavedSecond.current) >= 5) {
                lastSavedSecond.current = next;
                saveResume(item.key, next, event.currentTarget.duration || duration);
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              clearResume(item.key);
            }}
            onError={() => {
              if (sourceIndex + 1 < item.sourceCandidates.length) {
                setSourceIndex((index) => index + 1);
              } else {
                setFailed(true);
                setPlaying(false);
              }
            }}
          >
            <track
              kind="subtitles"
              srcLang="en"
              label="English"
              src={subtitleUrl(sourceUrl, '.en.vtt')}
            />
            <track
              kind="subtitles"
              srcLang="en"
              label="Subtitles"
              src={subtitleUrl(sourceUrl, '.vtt')}
            />
          </video>
        )}
        <div className="movies-player-shade" aria-hidden="true" />
      </div>

      <div className="movies-player-title">
        <strong>{item.title}</strong>
        <span>{item.context}</span>
      </div>

      {offerResume && resume && !failed && (
        <div className="movies-resume glass glass--strong" role="dialog" aria-label="Resume playback">
          <span>Continue watching?</span>
          <strong>{clockLabel(resume.position)} into {item.title}</strong>
          <div className="movies-resume-actions">
            <TransportButton
              id="movies-player-continue"
              label={`Continue from ${clockLabel(resume.position)}`}
              onAccept={continuePlayback}
              autoFocus
              wide
            >
              <span aria-hidden="true">▶</span>
              <span>Continue</span>
            </TransportButton>
            <TransportButton
              id="movies-player-restart"
              label="Start from the beginning"
              onAccept={startOver}
              wide
            >
              <span aria-hidden="true">↺</span>
              <span>Start over</span>
            </TransportButton>
          </div>
        </div>
      )}

      {failed && (
        <div className="movies-player-error glass glass--strong" role="status">
          <span aria-hidden="true">◇</span>
          <strong>Video could not be played.</strong>
          <p>The file was not found under the measured Kodi folder layouts, or Edge does not support its codec.</p>
        </div>
      )}

      <div className="movies-transport glass glass--strong">
        <div className="movies-transport-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="movies-transport-row">
          <TransportButton
            id="movies-player-back"
            label="Back to Movies and TV"
            onAccept={back}
            autoFocus={failed}
            wide
          >
            <span aria-hidden="true">←</span>
            <span>Library</span>
          </TransportButton>
          {!failed && !offerResume && (
            <>
              <TransportButton
                id="movies-player-rewind"
                label="Go back 15 seconds"
                onAccept={() => seekBy(-15)}
              >
                <span aria-hidden="true">↶</span><small>15</small>
              </TransportButton>
              <TransportButton
                id="movies-player-toggle"
                label={playing ? 'Pause' : 'Play'}
                onAccept={togglePlayback}
                autoFocus
              >
                <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
              </TransportButton>
              <TransportButton
                id="movies-player-forward"
                label="Go forward 15 seconds"
                onAccept={() => seekBy(15)}
              >
                <span aria-hidden="true">↷</span><small>15</small>
              </TransportButton>
            </>
          )}
          <span className="movies-transport-time">
            {failed ? 'Unavailable' : `${clockLabel(currentTime)} / ${clockLabel(duration)}`}
          </span>
        </div>
      </div>
    </section>
  );
}
