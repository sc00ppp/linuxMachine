import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFocusable } from '../focus';
import { sound } from '../sound';
import { fetchDirectStream } from './api';
import type { YouTubeVideo } from './types';

interface PlayerEvent {
  target: YouTubeIframePlayer;
  data: number;
}

interface YouTubeIframePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      events: {
        onReady: (event: PlayerEvent) => void;
        onStateChange: (event: PlayerEvent) => void;
        onError: () => void;
      };
    },
  ) => YouTubeIframePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type PlaybackMode = 'controlled-embed' | 'native-stream' | 'basic-embed';

let iframeApiPromise: Promise<YouTubeNamespace> | null = null;

/**
 * The iframe player is the one deliberate external script in this channel.
 * Loading it lazily keeps the rest of the shell script-free and means merely
 * browsing thumbnails never contacts the player runtime.
 */
function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(
      () => reject(new Error('iframe api timeout')),
      15_000,
    );

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('iframe api missing'));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-console-youtube-api]',
    );
    if (existing) return;

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.consoleYoutubeApi = 'true';
    script.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        reject(new Error('iframe api unavailable'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    iframeApiPromise = null;
    throw error;
  });

  return iframeApiPromise;
}

function embedUrl(videoId: string, controls: boolean): string {
  const query = new URLSearchParams({
    autoplay: '1',
    controls: controls ? '1' : '0',
    disablekb: controls ? '0' : '1',
    enablejsapi: '1',
    fs: '0',
    playsinline: '1',
    rel: '0',
  });
  if (window.location.origin.startsWith('http')) {
    query.set('origin', window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${query}`;
}

function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function TransportButton({
  id,
  label,
  children,
  onAccept,
  autoFocus,
  wide,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  onAccept: () => void;
  autoFocus?: boolean;
  wide?: boolean;
}) {
  const latestAccept = useRef(onAccept);
  latestAccept.current = onAccept;
  const { ref, focused } = useFocusable({
    id,
    scope: 'youtube',
    autoFocus,
    onAccept: () => latestAccept.current(),
  });

  return (
    <button
      className={`yt-transport-button${wide ? ' yt-transport-button--wide' : ''}`}
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

export function YouTubePlayer({
  video,
  onBack,
}: {
  video: YouTubeVideo;
  onBack: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nativeRef = useRef<HTMLVideoElement | null>(null);
  const iframePlayer = useRef<YouTubeIframePlayer | null>(null);
  const mounted = useRef(true);
  const fallbackStarted = useRef(false);
  const [mode, setMode] = useState<PlaybackMode>('controlled-embed');
  const [directUrl, setDirectUrl] = useState('');
  const [directType, setDirectType] = useState<string | undefined>();
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    Math.max(0, video.durationSeconds),
  );
  const [notice, setNotice] = useState('');

  const startFallback = useCallback(async () => {
    if (fallbackStarted.current) return;
    fallbackStarted.current = true;
    const controller = new AbortController();
    try {
      const stream = await fetchDirectStream(video.id, controller.signal);
      if (!mounted.current) return;
      setDirectUrl(stream.url);
      setDirectType(stream.mimeType);
      setMode('native-stream');
      setNotice('Using direct playback');
    } catch {
      if (!mounted.current) return;
      // Last-resort embed keeps the video usable even if both remote-control
      // APIs are being filtered. YouTube's own controls become visible.
      setMode('basic-embed');
      setNotice('Player controls are available in the video');
    }
  }, [video.id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'controlled-embed' || !iframeRef.current) return;
    let cancelled = false;
    let player: YouTubeIframePlayer | null = null;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !iframeRef.current) return;
        player = new YT.Player(iframeRef.current, {
          events: {
            onReady: (event) => {
              iframePlayer.current = event.target;
              setDuration(
                event.target.getDuration() || Math.max(0, video.durationSeconds),
              );
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (event.data === 1) setPlaying(true);
              if (event.data === 0 || event.data === 2) setPlaying(false);
            },
            onError: () => void startFallback(),
          },
        });
        iframePlayer.current = player;
      })
      .catch(() => void startFallback());

    return () => {
      cancelled = true;
      iframePlayer.current = null;
      try {
        player?.destroy();
      } catch {
        // A cross-origin player can disappear before React cleanup runs.
      }
    };
  }, [mode, startFallback, video.durationSeconds, video.id]);

  useEffect(() => {
    if (mode !== 'controlled-embed') return;
    const timer = window.setInterval(() => {
      const player = iframePlayer.current;
      if (!player) return;
      try {
        setCurrentTime(player.getCurrentTime());
        setDuration(player.getDuration() || Math.max(0, video.durationSeconds));
      } catch {
        // The iframe may be between navigation and ready; the next tick wins.
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [mode, video.durationSeconds]);

  const togglePlayback = useCallback(() => {
    sound.play('accept');
    if (mode === 'native-stream') {
      const media = nativeRef.current;
      if (!media) return;
      if (media.paused) void media.play().catch(() => undefined);
      else media.pause();
      return;
    }
    const player = iframePlayer.current;
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  }, [mode, playing]);

  const seekBy = useCallback(
    (delta: number) => {
      sound.play('tick');
      const next = clamp(currentTime + delta, 0, duration || currentTime + delta);
      if (mode === 'native-stream') {
        if (nativeRef.current) nativeRef.current.currentTime = next;
      } else {
        iframePlayer.current?.seekTo(next, true);
      }
      setCurrentTime(next);
    },
    [currentTime, duration, mode],
  );

  const progress = useMemo(
    () => (duration > 0 ? clamp(currentTime / duration, 0, 1) : 0),
    [currentTime, duration],
  );
  const isBasic = mode === 'basic-embed';

  return (
    <section className="yt-player" aria-label={`Playing ${video.title}`}>
      <div className="yt-player-video">
        {mode === 'native-stream' ? (
          <video
            ref={nativeRef}
            autoPlay
            playsInline
            onLoadedMetadata={(event) =>
              setDuration(event.currentTarget.duration || video.durationSeconds)
            }
            onTimeUpdate={(event) =>
              setCurrentTime(event.currentTarget.currentTime)
            }
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setMode('basic-embed');
              setNotice('Player controls are available in the video');
            }}
          >
            <source src={directUrl} type={directType} />
          </video>
        ) : (
          <iframe
            key={`${video.id}-${mode}`}
            ref={iframeRef}
            className={isBasic ? 'yt-player-basic-embed' : undefined}
            src={embedUrl(video.id, isBasic)}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen={false}
          />
        )}
        <div className="yt-player-shade" aria-hidden="true" />
      </div>

      <div className="yt-player-title">
        <strong>{video.title}</strong>
        <span>{video.channelName}</span>
      </div>

      <div className="yt-transport glass glass--strong">
        <div className="yt-transport-progress">
          <span
            className="yt-transport-progress-fill"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
        <div className="yt-transport-row">
          <TransportButton
            id="yt-player-back"
            label="Back to videos"
            onAccept={() => {
              sound.play('back');
              onBack();
            }}
            wide
          >
            <span aria-hidden="true">←</span>
            <span>Videos</span>
          </TransportButton>

          {!isBasic && (
            <>
              <TransportButton
                id="yt-player-rewind"
                label="Go back 15 seconds"
                onAccept={() => seekBy(-15)}
              >
                <span aria-hidden="true">↶</span>
                <small>15</small>
              </TransportButton>
              <TransportButton
                id="yt-player-toggle"
                label={playing ? 'Pause' : 'Play'}
                onAccept={togglePlayback}
                autoFocus
              >
                <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
              </TransportButton>
              <TransportButton
                id="yt-player-forward"
                label="Go forward 15 seconds"
                onAccept={() => seekBy(15)}
              >
                <span aria-hidden="true">↷</span>
                <small>15</small>
              </TransportButton>
            </>
          )}

          <span className="yt-transport-time">
            {isBasic
              ? notice
              : `${clockLabel(currentTime)} / ${clockLabel(duration)}`}
          </span>
          {!isBasic && notice && (
            <span className="yt-transport-mode">{notice}</span>
          )}
        </div>
      </div>
    </section>
  );
}
