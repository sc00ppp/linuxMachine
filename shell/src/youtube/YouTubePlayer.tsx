import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFocusable } from '../focus';
import { sound } from '../sound';
import {
  fetchDirectStream,
  fetchSponsorBlockSegments,
  readSponsorBlockSettings,
  readSponsorSegmentCache,
  SPONSOR_CACHE_TTL_MS,
} from './api';
import type {
  SponsorBlockCategory,
  SponsorBlockSegment,
  YouTubeVideo,
} from './types';

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

type PlaybackMode =
  | 'loading'
  | 'controlled-embed'
  | 'native-stream'
  | 'basic-embed';

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

const SPONSOR_LABELS: Record<SponsorBlockCategory, string> = {
  sponsor: 'sponsor',
  selfpromo: 'promotion',
  interaction: 'reminder',
  intro: 'intro',
  outro: 'outro',
  music_offtopic: 'unrelated music',
};

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
  const skippedSegments = useRef(new Set<string>());
  const triedDirectSources = useRef(new Set<string>());
  const toastTimer = useRef<number | null>(null);
  const cachedSponsorSegments = useMemo(
    () => readSponsorSegmentCache(video.id),
    [video.id],
  );
  const sponsorSettings = useMemo(() => readSponsorBlockSettings(), []);
  const [mode, setMode] = useState<PlaybackMode>('loading');
  const [directAttempt, setDirectAttempt] = useState(0);
  const [directUrl, setDirectUrl] = useState('');
  const [directType, setDirectType] = useState<string | undefined>();
  const [directSource, setDirectSource] = useState('');
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    Math.max(0, video.durationSeconds),
  );
  const [notice, setNotice] = useState('Finding an ad-free stream…');
  const [segments, setSegments] = useState<SponsorBlockSegment[]>(
    cachedSponsorSegments?.segments ?? [],
  );
  const [skipToast, setSkipToast] = useState('');

  const startBasicEmbed = useCallback(() => {
    setMode('basic-embed');
    setNotice('Player controls are available in the video');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setMode('loading');
    setNotice(
      directAttempt === 0
        ? 'Finding an ad-free stream…'
        : 'Trying another direct stream…',
    );
    void fetchDirectStream(
      video.id,
      controller.signal,
      [...triedDirectSources.current],
    )
      .then((stream) => {
        if (!active) return;
        setDirectUrl(stream.url);
        setDirectType(stream.mimeType);
        setDirectSource(stream.source);
        setMode('native-stream');
        setNotice('Direct playback');
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setMode('controlled-embed');
        setNotice('Using YouTube playback');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [directAttempt, video.id]);

  useEffect(() => {
    const controller = new AbortController();
    const cached = readSponsorSegmentCache(video.id);
    if (cached) setSegments(cached.segments);
    if (cached && Date.now() - cached.fetchedAt < SPONSOR_CACHE_TTL_MS) {
      return () => controller.abort();
    }
    void fetchSponsorBlockSegments(video.id, controller.signal)
      .then(setSegments)
      .catch(() => undefined);
    return () => controller.abort();
  }, [video.id]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

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
            onError: startBasicEmbed,
          },
        });
        iframePlayer.current = player;
      })
      .catch(startBasicEmbed);

    return () => {
      cancelled = true;
      iframePlayer.current = null;
      try {
        player?.destroy();
      } catch {
        // A cross-origin player can disappear before React cleanup runs.
      }
    };
  }, [mode, startBasicEmbed, video.durationSeconds, video.id]);

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

  useEffect(() => {
    if (mode !== 'native-stream' && mode !== 'controlled-embed') return;
    const segment = segments.find((candidate) => {
      const key = `${candidate.category}:${candidate.start}:${candidate.end}`;
      return (
        sponsorSettings[candidate.category] &&
        !skippedSegments.current.has(key) &&
        currentTime >= candidate.start &&
        currentTime < candidate.end
      );
    });
    if (!segment) return;

    const key = `${segment.category}:${segment.start}:${segment.end}`;
    skippedSegments.current.add(key);
    if (mode === 'native-stream') {
      if (nativeRef.current) nativeRef.current.currentTime = segment.end;
    } else {
      iframePlayer.current?.seekTo(segment.end, true);
    }
    setCurrentTime(segment.end);
    setSkipToast(
      `Skipped ${SPONSOR_LABELS[segment.category]} — ${Math.max(
        1,
        Math.round(segment.end - segment.start),
      )}s`,
    );
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setSkipToast('');
      toastTimer.current = null;
    }, 3_200);
  }, [currentTime, mode, segments, sponsorSettings]);

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
  const canControl = mode === 'native-stream' || mode === 'controlled-embed';

  return (
    <section className="yt-player" aria-label={`Playing ${video.title}`}>
      <div className="yt-player-video">
        {mode === 'loading' ? (
          <div className="yt-player-loading">
            <img src={video.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
            <span className="glass">{notice}</span>
          </div>
        ) : mode === 'native-stream' ? (
          <video
            ref={nativeRef}
            autoPlay
            playsInline
            poster={video.thumbnailUrl}
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
              if (directSource && triedDirectSources.current.has(directSource)) return;
              if (directSource) triedDirectSources.current.add(directSource);
              setNotice('Trying another direct stream…');
              setDirectAttempt((attempt) => attempt + 1);
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

      {skipToast && (
        <div className="yt-skip-toast glass" role="status">
          {skipToast}
        </div>
      )}

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

          {canControl && (
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
            {!canControl
              ? notice
              : `${clockLabel(currentTime)} / ${clockLabel(duration)}`}
          </span>
          {canControl && notice && (
            <span className="yt-transport-mode">{notice}</span>
          )}
        </div>
      </div>
    </section>
  );
}
