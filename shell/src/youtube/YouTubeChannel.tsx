import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import {
  fetchYouTubeHome,
  readYouTubeHomeCache,
  searchYouTube,
} from './api';
import type { YouTubeHomePayload, YouTubeVideo } from './types';
import { usePhoneText } from './usePhoneText';
import { VideoCard } from './VideoCard';
import { YouTubePlayer } from './YouTubePlayer';
import './YouTubeChannel.css';

type Screen = 'home' | 'search' | 'playback';
type HomeStatus = 'loading' | 'live' | 'cached' | 'offline';
type YouTubeCssProperties = CSSProperties &
  Record<`--${string}`, string | number>;

const YOUTUBE_ACCENT = '#e53935';
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
] as const;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function FocusButton({
  id,
  label,
  children,
  onAccept,
  autoFocus,
  className = '',
}: {
  id: string;
  label: string;
  children: ReactNode;
  onAccept: () => void;
  autoFocus?: boolean;
  className?: string;
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
      className={className}
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

function Brand() {
  return (
    <div className="yt-brand" aria-label="YouTube">
      <span className="yt-brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>YouTube</span>
    </div>
  );
}

function Hint({ badge, label }: { badge: string; label: string }) {
  return (
    <span className="yt-hint">
      <span className="yt-hint-badge" aria-hidden="true">
        {badge}
      </span>
      <span>{label}</span>
    </span>
  );
}

function RoomHeader({
  searchOpen,
  onHome,
  onSearch,
  searchAutoFocus,
}: {
  searchOpen: boolean;
  onHome: () => void;
  onSearch: () => void;
  searchAutoFocus?: boolean;
}) {
  return (
    <header className="yt-header" data-collapse="y">
      <Brand />
      <div className="yt-header-actions">
        {searchOpen && (
          <FocusButton
            id="yt-search-home"
            label="Return to YouTube home"
            className="yt-header-button"
            onAccept={onHome}
          >
            <span aria-hidden="true">⌂</span>
            <span>Home</span>
          </FocusButton>
        )}
        <FocusButton
          id={searchOpen ? 'yt-search-run-header' : 'yt-open-search'}
          label={searchOpen ? 'Search now' : 'Open search'}
          className="yt-header-button"
          onAccept={onSearch}
          autoFocus={searchAutoFocus}
        >
          <span className="yt-search-icon" aria-hidden="true" />
          <span>{searchOpen ? 'Search' : 'Find videos'}</span>
        </FocusButton>
      </div>
    </header>
  );
}

function HomeScreen({
  payload,
  status,
  onOpenSearch,
  onOpenVideo,
  onRetry,
}: {
  payload: YouTubeHomePayload | null;
  status: HomeStatus;
  onOpenSearch: () => void;
  onOpenVideo: (video: YouTubeVideo) => void;
  onRetry: () => void;
}) {
  const hasVideos = Boolean(payload?.rows.some((row) => row.videos.length));

  return (
    <>
      <RoomHeader
        searchOpen={false}
        onHome={() => undefined}
        onSearch={onOpenSearch}
        searchAutoFocus={!hasVideos}
      />
      <main className="yt-home-stage">
        {status === 'cached' && (
          <span className="yt-saved-note glass">Showing saved picks</span>
        )}
        {hasVideos ? (
          <div className="yt-home-scroll">
            {payload?.rows.map((row, rowIndex) => (
              <section className="yt-shelf" key={row.id}>
                <div className="yt-shelf-heading">
                  <h2>{row.title}</h2>
                  <span>{row.videos.length} videos</span>
                </div>
                <div className="yt-shelf-scroller">
                  <div className="yt-shelf-row">
                    {row.videos.map((video, videoIndex) => (
                      <VideoCard
                        key={`${row.id}-${video.id}`}
                        video={video}
                        focusId={`yt-home-${row.id}-${video.id}`}
                        autoFocus={rowIndex === 0 && videoIndex === 0}
                        onOpen={onOpenVideo}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <section className="yt-empty-state" aria-live="polite">
            <span className="yt-empty-orbit" aria-hidden="true">
              <span />
            </span>
            <h1>
              {status === 'offline'
                ? 'Can’t reach YouTube right now'
                : 'Gathering a few videos…'}
            </h1>
            <p>
              {status === 'offline'
                ? 'The room is quiet for a moment. Your saved picks will return after the first good visit.'
                : 'Trending, games, and music are on their way.'}
            </p>
            {status === 'offline' && (
              <FocusButton
                id="yt-home-retry"
                label="Try YouTube again"
                className="yt-retry-button glass"
                onAccept={onRetry}
                autoFocus
              >
                Try again
              </FocusButton>
            )}
          </section>
        )}
      </main>
      <footer className="yt-hints glass" data-collapse="y">
        <Hint badge="A" label="Watch" />
        <Hint badge="B" label="Back" />
      </footer>
    </>
  );
}

function KeyboardKey({
  id,
  label,
  spokenLabel,
  onAccept,
  autoFocus,
  wide,
}: {
  id: string;
  label: string;
  spokenLabel?: string;
  onAccept: () => void;
  autoFocus?: boolean;
  wide?: boolean;
}) {
  return (
    <FocusButton
      id={id}
      label={spokenLabel ?? label}
      className={`yt-key${wide ? ' yt-key--wide' : ''}`}
      onAccept={onAccept}
      autoFocus={autoFocus}
    >
      {label}
    </FocusButton>
  );
}

function SearchScreen({
  query,
  results,
  searching,
  error,
  onQueryChange,
  onSearch,
  onHome,
  onOpenVideo,
}: {
  query: string;
  results: YouTubeVideo[];
  searching: boolean;
  error: boolean;
  onQueryChange: (value: string) => void;
  onSearch: (term?: string) => void;
  onHome: () => void;
  onOpenVideo: (video: YouTubeVideo) => void;
}) {
  const addCharacter = (character: string) => {
    if (query.length >= 80) return;
    onQueryChange(`${query}${character}`);
    sound.play('tick');
  };

  return (
    <>
      <RoomHeader
        searchOpen
        onHome={onHome}
        onSearch={() => onSearch()}
      />
      <main className="yt-search-stage">
        <section className="yt-search-entry">
          <div className="yt-search-field glass glass--strong" aria-live="polite">
            <span className="yt-search-icon" aria-hidden="true" />
            <span
              className={query ? 'yt-search-value' : 'yt-search-placeholder'}
            >
              {query || 'Type with the phone or gamepad'}
            </span>
            {query && (
              <span className="yt-search-count">{query.length}</span>
            )}
          </div>

          <div className="yt-keyboard" aria-label="On-screen keyboard">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div className="yt-keyboard-row" key={rowIndex}>
                {row.map((letter, letterIndex) => (
                  <KeyboardKey
                    key={letter}
                    id={`yt-key-${letter.toLowerCase()}`}
                    label={letter}
                    onAccept={() => addCharacter(letter)}
                    autoFocus={rowIndex === 0 && letterIndex === 0}
                  />
                ))}
              </div>
            ))}
            <div className="yt-keyboard-row yt-keyboard-row--actions">
              <KeyboardKey
                id="yt-key-space"
                label="Space"
                onAccept={() => addCharacter(' ')}
                wide
              />
              <KeyboardKey
                id="yt-key-backspace"
                label="⌫"
                spokenLabel="Delete last character"
                onAccept={() => {
                  onQueryChange(query.slice(0, -1));
                  sound.play('tick');
                }}
                wide
              />
              <KeyboardKey
                id="yt-key-clear"
                label="Clear"
                onAccept={() => {
                  onQueryChange('');
                  sound.play('back');
                }}
                wide
              />
              <KeyboardKey
                id="yt-key-search"
                label="Search"
                onAccept={() => onSearch()}
                wide
              />
            </div>
          </div>
        </section>

        <section className="yt-results" aria-live="polite">
          <div className="yt-results-heading">
            <h2>
              {searching
                ? 'Looking…'
                : results.length > 0
                  ? 'Results'
                  : 'Search YouTube'}
            </h2>
            {results.length > 0 && <span>{results.length} videos</span>}
          </div>
          {error && (
            <p className="yt-search-message">
              Can’t reach YouTube right now. Your search is still here.
            </p>
          )}
          {!error && !searching && results.length === 0 && (
            <p className="yt-search-message">
              Choose a few letters, or type comfortably from the phone.
            </p>
          )}
          {results.length > 0 && (
            <div className="yt-results-grid">
              {results.map((video, index) => (
                <VideoCard
                  key={`search-${video.id}`}
                  video={video}
                  focusId={`yt-search-result-${video.id}`}
                  autoFocus={false}
                  onOpen={onOpenVideo}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="yt-hints glass" data-collapse="y">
        <Hint badge="A" label="Type / Watch" />
        <Hint badge="B" label="Back" />
        <span className="yt-phone-hint">Phone typing appears here live</span>
      </footer>
    </>
  );
}

export function YouTubeChannel() {
  const initialCache = readYouTubeHomeCache();
  const [screen, setScreen] = useState<Screen>('home');
  const [returnScreen, setReturnScreen] = useState<'home' | 'search'>('home');
  const [home, setHome] = useState<YouTubeHomePayload | null>(initialCache);
  const [homeStatus, setHomeStatus] = useState<HomeStatus>(
    initialCache ? 'cached' : 'loading',
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<YouTubeVideo | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchSequence = useRef(0);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    try {
      element.animate(
        reducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              {
                opacity: 0,
                transform: `translate3d(${tuning.drillSlidePx}px, 0, 0)`,
              },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
        {
          duration: reducedMotion() ? 1 : tuning.drillInMs,
          easing: tuning.drillInEase,
        },
      );
    } catch {
      // Entrance motion is decoration; the room remains fully usable.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setHomeStatus((current) => (home ? 'cached' : current));
    void fetchYouTubeHome(controller.signal)
      .then((payload) => {
        if (!active) return;
        setHome(payload);
        setHomeStatus('live');
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setHomeStatus(home ? 'cached' : 'offline');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshToken]);

  const performSearch = useCallback(
    (term = query) => {
      const cleaned = term.trim();
      if (!cleaned) {
        sound.play('edge');
        return;
      }
      const sequence = ++searchSequence.current;
      setSearching(true);
      setSearchError(false);
      sound.play('accept');
      void searchYouTube(cleaned)
        .then((nextResults) => {
          if (sequence !== searchSequence.current) return;
          setResults(nextResults);
          setSearching(false);
        })
        .catch(() => {
          if (sequence !== searchSequence.current) return;
          setSearchError(true);
          setSearching(false);
        });
    },
    [query],
  );

  usePhoneText(screen === 'search', (text, commit) => {
    setQuery(text.slice(0, 80));
    if (commit && text.trim()) performSearch(text);
  });

  const openVideo = useCallback(
    (video: YouTubeVideo) => {
      sound.play('accept');
      setReturnScreen(screen === 'search' ? 'search' : 'home');
      setPlayingVideo(video);
      setScreen('playback');
    },
    [screen],
  );

  const roomStyle: YouTubeCssProperties = {
    '--accent': YOUTUBE_ACCENT,
    '--yt-focus-ms': `${tuning.focusMoveMs}ms`,
    '--yt-focus-ease': tuning.focusEase,
    '--yt-pop-ease': tuning.popEase,
  };

  return (
    <div
      className="yt-channel"
      ref={rootRef}
      style={roomStyle}
      data-screen={screen}
    >
      <div className="yt-ambient-light" aria-hidden="true" />
      {screen === 'home' && (
        <HomeScreen
          payload={home}
          status={homeStatus}
          onOpenSearch={() => {
            sound.play('accept');
            setScreen('search');
          }}
          onOpenVideo={openVideo}
          onRetry={() => {
            setHomeStatus('loading');
            setRefreshToken((value) => value + 1);
          }}
        />
      )}
      {screen === 'search' && (
        <SearchScreen
          query={query}
          results={results}
          searching={searching}
          error={searchError}
          onQueryChange={setQuery}
          onSearch={performSearch}
          onHome={() => {
            sound.play('back');
            setScreen('home');
          }}
          onOpenVideo={openVideo}
        />
      )}
      {screen === 'playback' && playingVideo && (
        <YouTubePlayer
          key={playingVideo.id}
          video={playingVideo}
          onBack={() => setScreen(returnScreen)}
        />
      )}
    </div>
  );
}
