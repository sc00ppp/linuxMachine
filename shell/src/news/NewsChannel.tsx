import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { channelById } from '../core/channels';
import { focusManager, useFocusable } from '../focus';
import { tuning } from '../motion/tuning';
import {
  fetchNewsFeed,
  readNewsCache,
  writeNewsCache,
  type NewsStory,
} from './feedClient';
import { NEWS_FEEDS } from './feeds';
import './NewsChannel.css';

const AUTO_ADVANCE_MS = 12_000;
const INTERACTION_PAUSE_MS = 30_000;
const MAX_STORIES = 12;
const NEWS_ACCENT = channelById('news')?.accent;

type FeedStatus = 'loading' | 'live' | 'cached' | 'offline';

interface FeedSlot {
  stories: NewsStory[];
  status: FeedStatus;
}

interface Selection {
  feedIndex: number;
  storyIndex: number;
}

interface ProgressClock {
  elapsed: number;
  lastFrame: number | null;
  pauseUntil: number;
}

type NewsCssProperties = CSSProperties & Record<`--${string}`, string | number>;

function focusId(feedIndex: number, storyIndex: number): string {
  return `news-story-${feedIndex}-${storyIndex}`;
}

function firstAvailable(slots: readonly FeedSlot[]): Selection {
  const feedIndex = slots.findIndex((slot) => slot.stories.length > 0);
  return { feedIndex: Math.max(0, feedIndex), storyIndex: 0 };
}

function initialSlots(): FeedSlot[] {
  return NEWS_FEEDS.map((feed) => {
    const stories = readNewsCache(feed);
    return {
      stories,
      status: stories.length > 0 ? 'cached' : 'loading',
    };
  });
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return 'Recently';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Recently';

  const deltaSeconds = Math.round((then - now) / 1_000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absoluteSeconds < 60) return formatter.format(deltaSeconds, 'second');
  if (absoluteSeconds < 3_600) {
    return formatter.format(Math.round(deltaSeconds / 60), 'minute');
  }
  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(deltaSeconds / 3_600), 'hour');
  }
  if (absoluteSeconds < 2_592_000) {
    return formatter.format(Math.round(deltaSeconds / 86_400), 'day');
  }
  return formatter.format(Math.round(deltaSeconds / 2_592_000), 'month');
}

function headlineSizeClass(title: string): string {
  if (title.length > 122) return 'news-headline--very-long';
  if (title.length > 82) return 'news-headline--long';
  return '';
}

function StoryFocusTarget(props: {
  feedIndex: number;
  storyIndex: number;
  title: string;
  onFocused: (feedIndex: number, storyIndex: number) => void;
}) {
  const { feedIndex, storyIndex, title, onFocused } = props;
  const { ref, focused } = useFocusable({
    id: focusId(feedIndex, storyIndex),
    scope: 'news',
    autoFocus: feedIndex === 0 && storyIndex === 0,
  });

  useEffect(() => {
    if (focused) onFocused(feedIndex, storyIndex);
  }, [feedIndex, focused, onFocused, storyIndex]);

  return (
    <button
      ref={ref}
      className="news-focus-target"
      type="button"
      tabIndex={-1}
      aria-label={`${NEWS_FEEDS[feedIndex]?.label ?? 'News'}: ${title}`}
    />
  );
}

/**
 * News is deliberately a broadcast rather than a list. The transparent focus
 * map is a four-column story matrix: the shared geometric focus engine turns
 * left/right into section changes and up/down into headline changes while the
 * visible layer continues to present exactly one story.
 */
export function NewsChannel() {
  const [slots, setSlots] = useState<FeedSlot[]>(initialSlots);
  const initialSelection = firstAvailable(slots);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [imageFailedFor, setImageFailedFor] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [progressPaused, setProgressPaused] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLElement | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const selectionRef = useRef(selection);
  const autoSelectingRef = useRef(false);
  const sawFocusSelectionRef = useRef(false);
  const progressClockRef = useRef<ProgressClock>({
    elapsed: 0,
    lastFrame: null,
    pauseUntil: 0,
  });
  const advanceRef = useRef<() => void>(() => undefined);

  selectionRef.current = selection;

  const selectedSlot = slots[selection.feedIndex];
  const selectedStory = selectedSlot?.stories[selection.storyIndex] ?? null;
  const selectedFeed = NEWS_FEEDS[selection.feedIndex] ?? NEWS_FEEDS[0];
  const storyKey = selectedStory?.id ?? 'no-story';

  useEffect(() => {
    const controller = new AbortController();

    const refreshAll = () => {
      NEWS_FEEDS.forEach((feed, feedIndex) => {
        void fetchNewsFeed(feed, controller.signal)
          .then((stories) => {
            writeNewsCache(feed, stories);
            setSlots((current) =>
              current.map((slot, index) =>
                index === feedIndex ? { stories, status: 'live' } : slot,
              ),
            );
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setSlots((current) =>
              current.map((slot, index) =>
                index === feedIndex
                  ? {
                      ...slot,
                      status: slot.stories.length > 0 ? 'cached' : 'offline',
                    }
                  : slot,
              ),
            );
          });
      });
    };

    refreshAll();
    window.addEventListener('online', refreshAll);
    return () => {
      controller.abort();
      window.removeEventListener('online', refreshAll);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
      // Entrance motion is decorative; unsupported WAAPI leaves final layout.
    }
  }, []);

  useLayoutEffect(() => {
    const element = storyRef.current;
    if (!element || !selectedStory) return;
    try {
      element.animate(
        reducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translate3d(0, 1.15rem, 0)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
        {
          duration: reducedMotion() ? 1 : tuning.drillInMs,
          easing: tuning.drillInEase,
        },
      );
    } catch {
      // Story changes remain fully usable without motion support.
    }
  }, [selectedStory, storyKey]);

  useEffect(() => {
    setImageFailedFor(null);
  }, [storyKey]);

  useEffect(() => {
    if (selectedStory) return;
    const next = firstAvailable(slots);
    if (!slots[next.feedIndex]?.stories[next.storyIndex]) return;
    focusManager.focusId(focusId(next.feedIndex, next.storyIndex));
  }, [selectedStory, slots]);

  const handleFocused = useCallback(
    (feedIndex: number, storyIndex: number) => {
      const clock = progressClockRef.current;
      const firstFocus = !sawFocusSelectionRef.current;
      sawFocusSelectionRef.current = true;

      clock.elapsed = 0;
      if (autoSelectingRef.current || firstFocus) {
        autoSelectingRef.current = false;
        clock.pauseUntil = 0;
        setProgressPaused(false);
      } else {
        clock.pauseUntil = performance.now() + INTERACTION_PAUSE_MS;
        setProgressPaused(true);
      }

      const previous = selectionRef.current;
      if (
        previous.feedIndex !== feedIndex ||
        previous.storyIndex !== storyIndex
      ) {
        const next = { feedIndex, storyIndex };
        selectionRef.current = next;
        setSelection(next);
      }
    },
    [],
  );

  advanceRef.current = () => {
    const current = selectionRef.current;
    const stories = slots[current.feedIndex]?.stories ?? [];
    if (stories.length === 0) {
      const next = firstAvailable(slots);
      if (!slots[next.feedIndex]?.stories.length) return;
      autoSelectingRef.current = true;
      focusManager.focusId(focusId(next.feedIndex, next.storyIndex));
      return;
    }

    const nextStoryIndex = (current.storyIndex + 1) % stories.length;
    autoSelectingRef.current = true;
    focusManager.focusId(focusId(current.feedIndex, nextStoryIndex));
  };

  useEffect(() => {
    let frame = 0;
    let wasPaused = progressPaused;

    const update = (timestamp: number) => {
      const clock = progressClockRef.current;
      const previousFrame = clock.lastFrame ?? timestamp;
      const delta = Math.min(250, timestamp - previousFrame);
      clock.lastFrame = timestamp;

      const paused = timestamp < clock.pauseUntil || !selectedStory;
      if (paused !== wasPaused) {
        wasPaused = paused;
        setProgressPaused(paused);
      }

      if (!paused) {
        clock.elapsed += delta;
        if (clock.elapsed >= AUTO_ADVANCE_MS) {
          clock.elapsed = 0;
          advanceRef.current();
        }
      }

      if (progressRef.current) {
        const progress = Math.min(1, clock.elapsed / AUTO_ADVANCE_MS);
        progressRef.current.style.transform = `scaleX(${progress})`;
      }
      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [progressPaused, selectedStory]);

  const anyStories = slots.some((slot) => slot.stories.length > 0);
  const allSettled = slots.every((slot) => slot.status !== 'loading');
  const showingImage =
    selectedStory?.imageUrl && imageFailedFor !== selectedStory.id;
  const roomStyle: NewsCssProperties = {
    ...(NEWS_ACCENT ? { '--accent': NEWS_ACCENT } : {}),
    '--focus-ms': `${tuning.focusMoveMs}ms`,
    '--focus-ease': tuning.focusEase,
    '--story-ms': `${tuning.drillInMs}ms`,
  };

  return (
    <div className="news-channel" ref={rootRef} style={roomStyle}>
      <div className="news-ambient-light" aria-hidden="true" />

      <header className="news-header" data-collapse="y">
        <div className="news-brand">
          <span className="news-brand-mark" aria-hidden="true">
            N
          </span>
          <span>Evening News</span>
        </div>
        <nav className="news-sections" aria-label="News sections">
          {NEWS_FEEDS.map((feed, index) => (
            <span
              className="news-section"
              data-current={index === selection.feedIndex ? 'true' : undefined}
              key={feed.id}
            >
              {feed.label}
            </span>
          ))}
        </nav>
        <div className="news-live-mark">
          <span className="news-live-dot" aria-hidden="true" />
          On now
        </div>
      </header>

      <div className="news-focus-map" aria-label="Headline navigation">
        {slots.map((slot, feedIndex) => (
          <div className="news-focus-column" key={NEWS_FEEDS[feedIndex]?.id}>
            {slot.stories.slice(0, MAX_STORIES).map((story, storyIndex) => (
              <StoryFocusTarget
                feedIndex={feedIndex}
                storyIndex={storyIndex}
                title={story.title}
                onFocused={handleFocused}
                key={focusId(feedIndex, storyIndex)}
              />
            ))}
          </div>
        ))}
      </div>

      <main className="news-stage">
        {selectedStory && selectedFeed ? (
          <article
            className={`news-story ${showingImage ? 'news-story--with-image' : 'news-story--text-only'}`}
            ref={storyRef}
            key={storyKey}
          >
            <div className="news-copy">
              <div className="news-kicker">
                <span>{selectedFeed.label}</span>
                <span className="news-kicker-rule" aria-hidden="true" />
                <span>
                  {selectedSlot?.status === 'cached'
                    ? 'From the last broadcast'
                    : 'Latest dispatch'}
                </span>
              </div>
              <h1
                className={`news-headline ${headlineSizeClass(selectedStory.title)}`}
              >
                {selectedStory.title}
              </h1>
              <p className="news-byline">
                <span>{selectedFeed.source}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={selectedStory.publishedAt ?? undefined}>
                  {relativeTime(selectedStory.publishedAt, now)}
                </time>
              </p>
              <p className="news-summary">{selectedStory.summary}</p>
            </div>

            {showingImage && (
              <figure className="news-image-frame">
                <img
                  className="news-image"
                  src={selectedStory.imageUrl ?? undefined}
                  alt=""
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailedFor(selectedStory.id)}
                />
                <span className="news-image-wash" aria-hidden="true" />
              </figure>
            )}

            <div className="news-story-count" aria-label="Story position">
              {String(selection.storyIndex + 1).padStart(2, '0')}
              <span aria-hidden="true"> / </span>
              {String(selectedSlot?.stories.length ?? 0).padStart(2, '0')}
            </div>
          </article>
        ) : (
          <section className="news-tuning-state" aria-live="polite">
            <span className="news-tuning-eyebrow">Evening News</span>
            <h1>
              {allSettled
                ? 'Can’t reach the news right now.'
                : 'Tuning into the newsroom…'}
            </h1>
            <p>
              {allSettled
                ? 'The channel is resting quietly. We’ll try the wires again next time.'
                : 'Gathering a few thoughtful things for the room.'}
            </p>
          </section>
        )}
      </main>

      <div
        className="news-progress"
        data-paused={progressPaused ? 'true' : undefined}
        aria-hidden="true"
      >
        <span ref={progressRef} />
      </div>

      <footer className="news-hints" data-collapse="y">
        <span className="news-hint">
          <span className="news-hint-badge news-hint-badge--wide" aria-hidden="true">
            ← →
          </span>
          <span>Section</span>
        </span>
        <span className="news-hint">
          <span className="news-hint-badge news-hint-badge--wide" aria-hidden="true">
            ↑ ↓
          </span>
          <span>Stories</span>
        </span>
        <span className="news-hint">
          <span className="news-hint-badge" aria-hidden="true">
            B
          </span>
          <span>Back</span>
        </span>
      </footer>

      {!anyStories && !allSettled && (
        <span className="news-loading-sr" role="status">
          Loading news
        </span>
      )}
    </div>
  );
}
