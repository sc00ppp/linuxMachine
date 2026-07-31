import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { focusManager, useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import { sound } from '../sound';
import {
  fetchSubscriptionFeed,
  fetchYouTubeHome,
  readSponsorBlockSettings,
  readSubscriptionFeedCache,
  readYouTubeHomeCache,
  readYouTubeSubscriptions,
  searchYouTube,
  SPONSOR_BLOCK_CATEGORIES,
  writeSponsorBlockSettings,
  writeYouTubeSubscriptions,
  YOUTUBE_CACHE_TTL_MS,
} from './api';
import type {
  SponsorBlockCategory,
  SponsorBlockSettings,
  YouTubeHomePayload,
  YouTubeSubscription,
  YouTubeSubscriptionFeedPayload,
  YouTubeVideo,
} from './types';
import { usePhoneText } from './usePhoneText';
import { VideoCard } from './VideoCard';
import { YouTubePlayer } from './YouTubePlayer';
import './YouTubeChannel.css';

type Screen = 'home' | 'search' | 'subscriptions' | 'playback';
type HomeStatus = 'loading' | 'live' | 'cached' | 'offline';
type YouTubeCssProperties = CSSProperties &
  Record<`--${string}`, string | number>;

const YOUTUBE_ACCENT = '#e53935';
const SPONSOR_CATEGORY_LABELS: Record<SponsorBlockCategory, string> = {
  sponsor: 'Paid sponsors',
  selfpromo: 'Creator promotions',
  interaction: 'Reminders and interaction',
  intro: 'Introductions',
  outro: 'End cards',
  music_offtopic: 'Unrelated music',
};
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
] as const;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * App intentionally leaves the semantic `sort` action unclaimed in this
 * room. Listen only while YouTube is mounted so Y can be a card-level action
 * without expanding the shell-wide input contract.
 */
function useYouTubeSecondaryAction(
  enabled: boolean,
  onAction: () => void,
): void {
  const latestAction = useRef(onAction);
  latestAction.current = onAction;

  useEffect(() => {
    if (!enabled) return;
    const heldButtons = new Map<number, boolean>();
    let animationFrame = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'KeyY' && event.key.toLowerCase() !== 'y')) {
        return;
      }
      latestAction.current();
      event.preventDefault();
    };
    const pollGamepads = () => {
      for (const gamepad of navigator.getGamepads?.() ?? []) {
        if (!gamepad) continue;
        const pressed = gamepad.buttons[3]?.pressed === true;
        if (pressed && !heldButtons.get(gamepad.index)) latestAction.current();
        heldButtons.set(gamepad.index, pressed);
      }
      animationFrame = window.requestAnimationFrame(pollGamepads);
    };
    window.addEventListener('keydown', onKeyDown);
    animationFrame = window.requestAnimationFrame(pollGamepads);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [enabled]);
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
  onSubscriptions,
  searchAutoFocus,
  homeLabel = 'Home',
}: {
  searchOpen: boolean;
  onHome: () => void;
  onSearch: () => void;
  onSubscriptions?: () => void;
  searchAutoFocus?: boolean;
  homeLabel?: string;
}) {
  return (
    <header className="yt-header" data-collapse="y">
      <Brand />
      <div className="yt-header-actions">
        {searchOpen && (
          <FocusButton
            id="yt-search-home"
            label={`Return to ${homeLabel}`}
            className="yt-header-button"
            onAccept={onHome}
          >
            <span aria-hidden="true">⌂</span>
            <span>{homeLabel}</span>
          </FocusButton>
        )}
        {!searchOpen && onSubscriptions && (
          <FocusButton
            id="yt-open-subscriptions"
            label="Manage subscriptions"
            className="yt-header-button"
            onAccept={onSubscriptions}
          >
            <span>Subscriptions</span>
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
  subscriptions,
  subscriptionFeed,
  subscriptionStatus,
  onOpenSearch,
  onManageSubscriptions,
  onOpenVideo,
  onRetry,
  isSubscribed,
}: {
  payload: YouTubeHomePayload | null;
  status: HomeStatus;
  subscriptions: YouTubeSubscription[];
  subscriptionFeed: YouTubeSubscriptionFeedPayload | null;
  subscriptionStatus: HomeStatus;
  onOpenSearch: () => void;
  onManageSubscriptions: () => void;
  onOpenVideo: (video: YouTubeVideo) => void;
  onRetry: () => void;
  isSubscribed: (channelId: string) => boolean;
}) {
  const hasSubscriptionVideos = Boolean(subscriptionFeed?.videos.length);
  const hasVideos =
    subscriptions.length > 0 ||
    hasSubscriptionVideos ||
    Boolean(payload?.rows.some((row) => row.videos.length));

  return (
    <>
      <RoomHeader
        searchOpen={false}
        onHome={() => undefined}
        onSearch={onOpenSearch}
        onSubscriptions={onManageSubscriptions}
        searchAutoFocus={!hasVideos}
      />
      <main className="yt-home-stage">
        {status === 'cached' && (
          <span className="yt-saved-note glass">Showing saved picks</span>
        )}
        {hasVideos ? (
          <div className="yt-home-scroll">
            {subscriptions.length > 0 && (
              <section className="yt-shelf yt-subscriptions-shelf">
                <div className="yt-shelf-heading">
                  <h2>Subscriptions</h2>
                  <span>
                    {hasSubscriptionVideos
                      ? `${subscriptionFeed?.videos.length ?? 0} new videos`
                      : subscriptionStatus === 'loading'
                        ? 'Checking for new videos…'
                        : 'No recent uploads saved yet'}
                  </span>
                  <FocusButton
                    id="yt-manage-subscriptions-row"
                    label="Manage subscriptions"
                    className="yt-shelf-action"
                    onAccept={onManageSubscriptions}
                    autoFocus={!hasSubscriptionVideos}
                  >
                    Manage
                  </FocusButton>
                </div>
                {hasSubscriptionVideos && (
                  <div className="yt-shelf-scroller">
                    <div className="yt-shelf-row">
                      {subscriptionFeed?.videos.map((video, videoIndex) => (
                        <VideoCard
                          key={`subscriptions-${video.id}`}
                          video={video}
                          focusId={`yt-subscriptions-${video.id}`}
                          autoFocus={videoIndex === 0}
                          onOpen={onOpenVideo}
                          secondaryLabel={
                            video.channelId
                              ? isSubscribed(video.channelId)
                                ? 'Y Unsubscribe'
                                : 'Y Subscribe'
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
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
                        autoFocus={
                          !hasSubscriptionVideos && rowIndex === 0 && videoIndex === 0
                        }
                        onOpen={onOpenVideo}
                        secondaryLabel={
                          video.channelId
                            ? isSubscribed(video.channelId)
                              ? 'Y Unsubscribe'
                              : 'Y Subscribe'
                            : undefined
                        }
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
        <Hint badge="Y" label="Subscribe" />
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
  addMode,
  onQueryChange,
  onSearch,
  onHome,
  onOpenVideo,
  isSubscribed,
}: {
  query: string;
  results: YouTubeVideo[];
  searching: boolean;
  error: boolean;
  addMode: boolean;
  onQueryChange: (value: string) => void;
  onSearch: (term?: string) => void;
  onHome: () => void;
  onOpenVideo: (video: YouTubeVideo) => void;
  isSubscribed: (channelId: string) => boolean;
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
        homeLabel={addMode ? 'Subscriptions' : 'Home'}
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
                  ? addMode
                    ? 'Choose a channel'
                    : 'Results'
                  : addMode
                    ? 'Find a channel'
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
                  secondaryLabel={
                    video.channelId
                      ? isSubscribed(video.channelId)
                        ? 'Y Unsubscribe'
                        : 'Y Subscribe'
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="yt-hints glass" data-collapse="y">
        <Hint badge="A" label={addMode ? 'Type / Add channel' : 'Type / Watch'} />
        <Hint badge="Y" label="Subscribe" />
        <Hint badge="B" label="Back" />
        <span className="yt-phone-hint">Phone typing appears here live</span>
      </footer>
    </>
  );
}

function SubscriptionAvatar({ subscription }: { subscription: YouTubeSubscription }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="yt-subscription-avatar" aria-hidden="true">
      {subscription.avatarUrl && !failed ? (
        <img
          src={subscription.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{subscription.name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function ManageSubscriptionsScreen({
  subscriptions,
  sponsorSettings,
  onHome,
  onAdd,
  onRemove,
  onToggleSponsorCategory,
}: {
  subscriptions: YouTubeSubscription[];
  sponsorSettings: SponsorBlockSettings;
  onHome: () => void;
  onAdd: () => void;
  onRemove: (subscription: YouTubeSubscription) => void;
  onToggleSponsorCategory: (category: SponsorBlockCategory) => void;
}) {
  return (
    <>
      <RoomHeader searchOpen onHome={onHome} onSearch={onAdd} />
      <main className="yt-manage-stage">
        <section className="yt-manage-panel glass glass--strong">
          <div className="yt-manage-heading">
            <div>
              <span className="yt-manage-kicker">Your channels</span>
              <h1>Subscriptions</h1>
            </div>
            <FocusButton
              id="yt-subscriptions-add"
              label="Find a channel to subscribe to"
              className="yt-manage-primary"
              onAccept={onAdd}
              autoFocus={subscriptions.length === 0}
            >
              Add by search
            </FocusButton>
          </div>
          {subscriptions.length > 0 ? (
            <div className="yt-subscription-list">
              {subscriptions.map((subscription, index) => (
                <div className="yt-subscription-row" key={subscription.channelId}>
                  <SubscriptionAvatar subscription={subscription} />
                  <span className="yt-subscription-name">{subscription.name}</span>
                  <FocusButton
                    id={`yt-unsubscribe-${subscription.channelId}`}
                    label={`Unsubscribe from ${subscription.name}`}
                    className="yt-manage-secondary"
                    onAccept={() => onRemove(subscription)}
                    autoFocus={index === 0}
                  >
                    Unsubscribe
                  </FocusButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="yt-manage-empty">
              No subscriptions yet. Search for a video, then add its channel.
            </p>
          )}
        </section>

        <section className="yt-manage-panel glass">
          <div className="yt-manage-heading yt-manage-heading--settings">
            <div>
              <span className="yt-manage-kicker">Playback</span>
              <h2>SponsorBlock</h2>
            </div>
            <p>Choose which quiet interruptions the player skips for you.</p>
          </div>
          <div className="yt-sponsor-settings">
            {SPONSOR_BLOCK_CATEGORIES.map((category) => (
              <FocusButton
                key={category}
                id={`yt-sponsor-setting-${category}`}
                label={`${SPONSOR_CATEGORY_LABELS[category]}: ${
                  sponsorSettings[category] ? 'on' : 'off'
                }`}
                className="yt-sponsor-toggle"
                onAccept={() => onToggleSponsorCategory(category)}
              >
                <span>{SPONSOR_CATEGORY_LABELS[category]}</span>
                <strong>{sponsorSettings[category] ? 'On' : 'Off'}</strong>
              </FocusButton>
            ))}
          </div>
        </section>
      </main>
      <footer className="yt-hints glass" data-collapse="y">
        <Hint badge="A" label="Select" />
        <Hint badge="B" label="Back" />
      </footer>
    </>
  );
}

export function YouTubeChannel() {
  const initialCache = useMemo(() => readYouTubeHomeCache(), []);
  const initialSubscriptions = useMemo(() => readYouTubeSubscriptions(), []);
  const initialSubscriptionFeed = useMemo(
    () => readSubscriptionFeedCache(initialSubscriptions),
    [initialSubscriptions],
  );
  const [screen, setScreen] = useState<Screen>('home');
  const [returnScreen, setReturnScreen] = useState<
    'home' | 'search' | 'subscriptions'
  >('home');
  const [home, setHome] = useState<YouTubeHomePayload | null>(initialCache);
  const [homeStatus, setHomeStatus] = useState<HomeStatus>(
    initialCache ? 'cached' : 'loading',
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [subscriptions, setSubscriptions] = useState<YouTubeSubscription[]>(
    initialSubscriptions,
  );
  const [subscriptionFeed, setSubscriptionFeed] =
    useState<YouTubeSubscriptionFeedPayload | null>(initialSubscriptionFeed);
  const [subscriptionStatus, setSubscriptionStatus] = useState<HomeStatus>(
    initialSubscriptions.length === 0
      ? 'live'
      : initialSubscriptionFeed
        ? 'cached'
        : 'loading',
  );
  const [sponsorSettings, setSponsorSettings] = useState<SponsorBlockSettings>(
    () => readSponsorBlockSettings(),
  );
  const [query, setQuery] = useState('');
  const [searchAddMode, setSearchAddMode] = useState(false);
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<YouTubeVideo | null>(null);
  const [roomToast, setRoomToast] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchSequence = useRef(0);
  const roomToastTimer = useRef<number | null>(null);
  const subscriptionKey = subscriptions
    .map((subscription) => subscription.channelId)
    .sort()
    .join(',');

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

    // Serve the cache and only revalidate when it's actually stale. Without
    // this the room refetched three feeds on EVERY open, which hammers the
    // public Piped instance for no benefit — trending doesn't move minute to
    // minute. Older cards get one metadata refresh for channel IDs.
    const age = home?.fetchedAt ? Date.now() - home.fetchedAt : Infinity;
    const needsChannelMetadata = Boolean(
      home?.rows.some((row) => row.videos.some((video) => !video.channelId)),
    );
    if (
      refreshToken === 0 &&
      age < YOUTUBE_CACHE_TTL_MS &&
      !needsChannelMetadata
    ) {
      setHomeStatus('live');
      return () => {
        active = false;
        controller.abort();
      };
    }

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

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!subscriptionKey) {
      setSubscriptionFeed(null);
      setSubscriptionStatus('live');
      return () => controller.abort();
    }

    const cached = readSubscriptionFeedCache(subscriptions);
    setSubscriptionFeed(cached);
    setSubscriptionStatus(cached ? 'cached' : 'loading');
    const age = cached?.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
    if (cached && age < YOUTUBE_CACHE_TTL_MS) {
      setSubscriptionStatus('live');
      return () => controller.abort();
    }

    void fetchSubscriptionFeed(subscriptions, controller.signal)
      .then((payload) => {
        if (!active) return;
        setSubscriptionFeed(payload);
        setSubscriptionStatus('live');
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setSubscriptionStatus(cached ? 'cached' : 'offline');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [subscriptionKey]);

  useEffect(
    () => () => {
      if (roomToastTimer.current !== null) {
        window.clearTimeout(roomToastTimer.current);
      }
    },
    [],
  );

  const showRoomToast = useCallback((message: string) => {
    setRoomToast(message);
    if (roomToastTimer.current !== null) {
      window.clearTimeout(roomToastTimer.current);
    }
    roomToastTimer.current = window.setTimeout(() => {
      setRoomToast('');
      roomToastTimer.current = null;
    }, 3_000);
  }, []);

  const isSubscribed = useCallback(
    (channelId: string) =>
      Boolean(channelId) &&
      subscriptions.some((subscription) => subscription.channelId === channelId),
    [subscriptions],
  );

  const saveSubscriptions = useCallback(
    (next: YouTubeSubscription[]) => {
      writeYouTubeSubscriptions(next);
      setSubscriptions(next);
      const cached = readSubscriptionFeedCache(next);
      setSubscriptionFeed(cached);
      setSubscriptionStatus(next.length === 0 ? 'live' : cached ? 'cached' : 'loading');
    },
    [],
  );

  const toggleSubscription = useCallback(
    (video: YouTubeVideo) => {
      if (!video.channelId) {
        sound.play('edge');
        showRoomToast('This channel is not ready to follow yet');
        return;
      }
      const existing = subscriptions.find(
        (subscription) => subscription.channelId === video.channelId,
      );
      if (existing) {
        saveSubscriptions(
          subscriptions.filter(
            (subscription) => subscription.channelId !== video.channelId,
          ),
        );
        sound.play('back');
        showRoomToast(`Unsubscribed from ${existing.name}`);
        return;
      }
      const subscription: YouTubeSubscription = {
        channelId: video.channelId,
        name: video.channelName,
        avatarUrl: video.channelAvatarUrl,
      };
      saveSubscriptions([...subscriptions, subscription]);
      sound.play('accept');
      showRoomToast(`Subscribed to ${subscription.name}`);
    },
    [saveSubscriptions, showRoomToast, subscriptions],
  );

  const removeSubscription = useCallback(
    (subscription: YouTubeSubscription) => {
      saveSubscriptions(
        subscriptions.filter(
          (candidate) => candidate.channelId !== subscription.channelId,
        ),
      );
      sound.play('back');
      showRoomToast(`Unsubscribed from ${subscription.name}`);
    },
    [saveSubscriptions, showRoomToast, subscriptions],
  );

  const toggleSponsorCategory = useCallback((category: SponsorBlockCategory) => {
    setSponsorSettings((current) => {
      const next = { ...current, [category]: !current[category] };
      writeSponsorBlockSettings(next);
      return next;
    });
    sound.play('tick');
  }, []);

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

  const handleSecondaryAction = useCallback(() => {
    const focusedId = focusManager.focusedId();
    if (!focusedId) return;
    let video: YouTubeVideo | undefined;
    for (const row of home?.rows ?? []) {
      video = row.videos.find(
        (candidate) => focusedId === `yt-home-${row.id}-${candidate.id}`,
      );
      if (video) break;
    }
    video ??= subscriptionFeed?.videos.find(
      (candidate) => focusedId === `yt-subscriptions-${candidate.id}`,
    );
    video ??= results.find(
      (candidate) => focusedId === `yt-search-result-${candidate.id}`,
    );
    if (video) toggleSubscription(video);
  }, [home, results, subscriptionFeed, toggleSubscription]);

  useYouTubeSecondaryAction(
    screen === 'home' || screen === 'search',
    handleSecondaryAction,
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
      {roomToast && (
        <div className="yt-room-toast glass" role="status">
          {roomToast}
        </div>
      )}
      {screen === 'home' && (
        <HomeScreen
          payload={home}
          status={homeStatus}
          subscriptions={subscriptions}
          subscriptionFeed={subscriptionFeed}
          subscriptionStatus={subscriptionStatus}
          onOpenSearch={() => {
            sound.play('accept');
            setSearchAddMode(false);
            setScreen('search');
          }}
          onManageSubscriptions={() => {
            sound.play('accept');
            setScreen('subscriptions');
          }}
          onOpenVideo={openVideo}
          onRetry={() => {
            setHomeStatus('loading');
            setRefreshToken((value) => value + 1);
          }}
          isSubscribed={isSubscribed}
        />
      )}
      {screen === 'search' && (
        <SearchScreen
          query={query}
          results={results}
          searching={searching}
          error={searchError}
          addMode={searchAddMode}
          onQueryChange={setQuery}
          onSearch={performSearch}
          onHome={() => {
            sound.play('back');
            setScreen(searchAddMode ? 'subscriptions' : 'home');
          }}
          onOpenVideo={searchAddMode ? toggleSubscription : openVideo}
          isSubscribed={isSubscribed}
        />
      )}
      {screen === 'subscriptions' && (
        <ManageSubscriptionsScreen
          subscriptions={subscriptions}
          sponsorSettings={sponsorSettings}
          onHome={() => {
            sound.play('back');
            setScreen('home');
          }}
          onAdd={() => {
            sound.play('accept');
            setSearchAddMode(true);
            setScreen('search');
          }}
          onRemove={removeSubscription}
          onToggleSponsorCategory={toggleSponsorCategory}
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
