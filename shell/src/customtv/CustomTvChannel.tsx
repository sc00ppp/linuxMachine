import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { channelById } from '../core/channels';
import { useConsoleStore } from '../core/store';
import { focusManager } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import {
  customTvCatalog,
  refreshCustomTvCatalog,
  useCustomTvCatalogVersion,
  type CustomTvVideo,
} from './catalog';
import { customTvUrl } from '../core/customTvHost';
import { useScreenExit } from '../motion/useScreenExit';
import { CustomTvCard } from './CustomTvCard';
import { CustomTvPlayer } from './CustomTvPlayer';
import { LiveChannel } from './LiveChannel';
import { GuideGrid } from './GuideGrid';
import './CustomTvChannel.css';
import './guide.css';

type CustomTvCssProperties = CSSProperties & Record<`--${string}`, string | number>;
/**
 * Custom TV opens *live* — a station already playing, which you join partway
 * through. That is the whole point of the channel and the thing that separates
 * it from a catalogue: nothing waits for you to choose. `guide` is the flip-
 * through grid, and `library` is the on-demand escape hatch where scrubbing is
 * allowed (you cannot scrub live TV).
 */
type Screen = 'live' | 'guide' | 'library' | 'playback';

/** Live is the surface; the guide is a step in, on-demand a step past it. */
const SCREEN_DEPTH: Record<'live' | 'guide' | 'library', number> = {
  live: 0,
  guide: 1,
  library: 2,
};

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Hint({ badge, label }: { badge: string; label: string }) {
  return (
    <span className="ctv-hint">
      <span className="ctv-hint-badge" aria-hidden="true">{badge}</span>
      <span>{label}</span>
    </span>
  );
}

function EmptyLibrary() {
  return (
    <main className="ctv-empty" aria-live="polite">
      <span className="ctv-empty-set" aria-hidden="true">
        <i />
      </span>
      <h1>The set is quiet tonight.</h1>
      <p>Videos your friends share will appear here after the next library import.</p>
    </main>
  );
}

export function CustomTvChannel() {
  // live/guide/library live in the store so App's B handler can walk back up
  // them (guide → live → wall) instead of dumping you straight to the wall.
  // Playback stays local: it is tied to the selected video object.
  // Opening the room pulls a fresh catalog, so videos the bot downloaded since
  // this build was made show up without anyone rebuilding the shell.
  const catalogVersion = useCustomTvCatalogVersion();
  useEffect(() => {
    const controller = new AbortController();
    const url = customTvUrl('/catalog.json');
    const refresh = () => {
      if (url) void refreshCustomTvCatalog(url, controller.signal);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);

  const storeScreen = useConsoleStore((s) => s.customTvScreen);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const screen: Screen = playbackOpen ? 'playback' : storeScreen;
  const setScreen = useCallback((next: Screen) => {
    if (next === 'playback') {
      setPlaybackOpen(true);
      return;
    }
    setPlaybackOpen(false);
    useConsoleStore.getState().setCustomTvScreen(next);
  }, []);
  const [tunedChannel, setTunedChannel] = useState<string | undefined>(undefined);
  const [playingVideo, setPlayingVideo] = useState<CustomTvVideo | null>(null);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const returnFocusId = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Flipping between live, the guide and on-demand animates the screen that
  // arrives; this drifts the one being left out from under it, so a flip
  // reads as a move rather than a cut. Playback is excluded — it opens over
  // the room rather than replacing it.
  useScreenExit(rootRef, (state) =>
    state.view === 'customtv' ? SCREEN_DEPTH[state.customTvScreen] : Number.NaN,
  );
  const categoryNames = useMemo(
    () => new Map(customTvCatalog.categories.map((category) => [category.id, category.display_name])),
    // Rebuilt when a runtime refresh swaps the catalog behind us.
    [catalogVersion],
  );

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    try {
      element.animate(
        reducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: `translate3d(${tuning.drillSlidePx}px, 0, 0)` },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
        {
          duration: reducedMotion() ? 1 : tuning.drillInMs,
          easing: tuning.drillInEase,
        },
      );
    } catch {
      // Entrance motion is decorative; the room remains fully usable.
    }
  }, []);

  useLayoutEffect(() => {
    if (screen !== 'library' || !returnFocusId.current) return;
    focusManager.focusId(returnFocusId.current);
  }, [screen]);

  const openVideo = useCallback((video: CustomTvVideo, focusId: string) => {
    returnFocusId.current = focusId;
    setPlayingVideo(video);
    setScreen('playback');
    sound.play('accept');
  }, []);

  const markUnavailable = useCallback((id: string) => {
    setUnavailable((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const accent = channelById('customtv')?.accent;
  const roomStyle: CustomTvCssProperties = {
    ...(accent ? { '--accent': accent } : {}),
    '--ctv-focus-ms': `${tuning.focusMoveMs}ms`,
    '--ctv-focus-ease': tuning.focusEase,
  };
  const hasVideos = customTvCatalog.videos.length > 0;

  return (
    <div
      className="ctv-channel"
      ref={rootRef}
      style={roomStyle}
      data-customtv-screen={screen}
    >
      <div className="ctv-ambient-light" aria-hidden="true" />

      {screen === 'live' && (
        <LiveChannel
          channelId={tunedChannel}
          onTune={setTunedChannel}
          onOpenGuide={(id) => {
            setTunedChannel(id);
            setScreen('guide');
          }}
        />
      )}

      {screen === 'guide' && (
        <GuideGrid
          channelId={tunedChannel}
          onTune={(id) => {
            setTunedChannel(id);
            setScreen('live');
          }}
          onOpenOnDemand={() => setScreen('library')}
        />
      )}

      {screen === 'library' && (
        <>
          <header className="ctv-header" data-collapse="y">
            <div className="ctv-brand">
              <span className="ctv-brand-mark" aria-hidden="true"><i /></span>
              <span>Custom TV</span>
            </div>
            <div className="ctv-library-count">
              <strong>{customTvCatalog.videos.length}</strong>
              <span>{customTvCatalog.videos.length === 1 ? 'video' : 'videos'} from friends</span>
            </div>
          </header>

          {hasVideos ? (
            <main className="ctv-library-scroll">
              {customTvCatalog.categories.map((category, categoryIndex) => {
                const videos = customTvCatalog.videos.filter(
                  (video) => video.category === category.id,
                );
                if (videos.length === 0) return null;
                const headingId = `ctv-heading-${category.id}`;
                return (
                  <section className="ctv-shelf" key={category.id} aria-labelledby={headingId}>
                    <div className="ctv-shelf-heading">
                      <h2 id={headingId}>{category.display_name}</h2>
                      <span>{videos.length} {videos.length === 1 ? 'video' : 'videos'}</span>
                    </div>
                    <div className="ctv-shelf-scroller">
                      <div className="ctv-shelf-row">
                        {videos.map((video, videoIndex) => {
                          const focusId = `ctv-video-${video.id}`;
                          return (
                            <CustomTvCard
                              key={video.id}
                              video={video}
                              focusId={focusId}
                              categoryName={category.display_name}
                              autoFocus={categoryIndex === 0 && videoIndex === 0}
                              unavailable={unavailable.has(video.id)}
                              onOpen={openVideo}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </main>
          ) : (
            <EmptyLibrary />
          )}

          <footer className="ctv-hints glass" data-collapse="y">
            {hasVideos && <Hint badge="A" label="Watch" />}
            <Hint badge="B" label="Back" />
          </footer>
        </>
      )}

      {screen === 'playback' && playingVideo && (
        <CustomTvPlayer
          key={playingVideo.id}
          video={playingVideo}
          categoryName={categoryNames.get(playingVideo.category) ?? 'Custom TV'}
          onBack={() => setScreen('library')}
          onUnavailable={markUnavailable}
        />
      )}
    </div>
  );
}
