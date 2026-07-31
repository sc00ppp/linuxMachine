import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { channelById } from '../core/channels';
import { focusManager } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import { customTvCatalog, type CustomTvVideo } from './catalog';
import { CustomTvCard } from './CustomTvCard';
import { CustomTvPlayer } from './CustomTvPlayer';
import './CustomTvChannel.css';

type CustomTvCssProperties = CSSProperties & Record<`--${string}`, string | number>;
type Screen = 'library' | 'playback';

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
  const [screen, setScreen] = useState<Screen>('library');
  const [playingVideo, setPlayingVideo] = useState<CustomTvVideo | null>(null);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const returnFocusId = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const categoryNames = useMemo(
    () => new Map(customTvCatalog.categories.map((category) => [category.id, category.display_name])),
    [],
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
