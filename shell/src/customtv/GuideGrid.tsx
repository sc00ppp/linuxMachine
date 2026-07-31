import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useFocusable } from '../focus';
import { PlayIcon } from '../icons';
import { customTvCatalog, type CustomTvVideo } from './catalog';
import { scheduleAt } from './schedule';
import './guide.css';

export const CUSTOM_TV_GUIDE_SCOPE = 'customtv';

const MINUTE_MS = 60_000;
const WINDOW_MS = 30 * MINUTE_MS;
const TICK_MS = 5 * MINUTE_MS;
const MAX_SEGMENTS_PER_CHANNEL = 4_096;

interface GuideChannel {
  id: string;
  name: string;
  playlist: readonly CustomTvVideo[];
}

interface GuideSegment {
  programme: CustomTvVideo;
  programmeIndex: number;
  startsAtMs: number;
  endsAtMs: number;
  clippedStartMs: number;
  clippedEndMs: number;
}

interface FocusedProgramme {
  channelName: string;
  title: string;
  startsAtMs: number | null;
  endsAtMs: number | null;
}

type TimelineStyle = CSSProperties & {
  '--guide-left': string;
  '--guide-width': string;
};

export interface GuideGridProps {
  channelId?: string;
  /** Selecting any programme tunes its station and should return to Live. */
  onTune: (channelId: string) => void;
  onOpenOnDemand?: () => void;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function catalogChannels(): GuideChannel[] {
  return customTvCatalog.categories.map((category) => ({
    id: category.id,
    name: category.display_name,
    playlist: customTvCatalog.videos.filter(
      (video) => video.category === category.id,
    ),
  }));
}

function guideWindowStart(wallClockMs: number): number {
  const alignedNow = Math.floor(wallClockMs / TICK_MS) * TICK_MS;
  return alignedNow - TICK_MS;
}

function buildSegments(
  channel: GuideChannel,
  windowStartMs: number,
  windowEndMs: number,
): GuideSegment[] {
  const segments: GuideSegment[] = [];
  let cursorMs = windowStartMs;

  for (
    let count = 0;
    count < MAX_SEGMENTS_PER_CHANNEL && cursorMs < windowEndMs;
    count += 1
  ) {
    const schedule = scheduleAt(
      { id: channel.id, playlist: channel.playlist },
      cursorMs,
    );
    if (!schedule) return [];

    const clippedStartMs = Math.max(windowStartMs, schedule.startsAtMs);
    const clippedEndMs = Math.min(windowEndMs, schedule.endsAtMs);
    if (clippedEndMs > clippedStartMs) {
      segments.push({
        programme: schedule.current,
        programmeIndex: schedule.currentIndex,
        startsAtMs: schedule.startsAtMs,
        endsAtMs: schedule.endsAtMs,
        clippedStartMs,
        clippedEndMs,
      });
    }

    if (schedule.endsAtMs <= cursorMs) break;
    // Sample a hair past the boundary so floating point rounding always lands
    // in the programme that follows it, including one-item looping stations.
    cursorMs = schedule.endsAtMs + 0.01;
  }

  return segments;
}

function timeRange(startsAtMs: number | null, endsAtMs: number | null): string {
  if (startsAtMs === null || endsAtMs === null) return 'No schedule available';
  return `${timeFormatter.format(startsAtMs)} – ${timeFormatter.format(endsAtMs)}`;
}

function OnDemandButton({ onOpen }: { onOpen: () => void }) {
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  const { ref, focused } = useFocusable({
    id: 'ctv-guide-on-demand',
    scope: CUSTOM_TV_GUIDE_SCOPE,
    onAccept: () => latestOpen.current(),
  });

  return (
    <button
      className="ctv-guide-on-demand glass"
      ref={ref}
      type="button"
      tabIndex={-1}
      data-focused={focused ? 'true' : undefined}
      onClick={onOpen}
    >
      <span aria-hidden="true"><PlayIcon /></span>
      <span>
        <strong>On demand</strong>
        <small>Pick from the library</small>
      </span>
    </button>
  );
}

function GuideCell({
  channel,
  channelNumber,
  segment,
  windowStartMs,
  windowEndMs,
  wallClockMs,
  activeChannelId,
  autoFocus,
  onTune,
  onFocused,
}: {
  channel: GuideChannel;
  channelNumber: number;
  segment: GuideSegment | null;
  windowStartMs: number;
  windowEndMs: number;
  wallClockMs: number;
  activeChannelId: string;
  autoFocus: boolean;
  onTune: (channelId: string) => void;
  onFocused: (programme: FocusedProgramme) => void;
}) {
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const latestTune = useRef(onTune);
  const latestFocused = useRef(onFocused);
  latestTune.current = onTune;
  latestFocused.current = onFocused;

  const focusId = segment
    ? `ctv-guide-${channel.id}-${Math.round(segment.startsAtMs)}`
    : `ctv-guide-${channel.id}-off-air`;
  const { ref: focusRef, focused } = useFocusable({
    id: focusId,
    scope: CUSTOM_TV_GUIDE_SCOPE,
    autoFocus,
    onAccept: () => latestTune.current(channel.id),
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
    latestFocused.current({
      channelName: channel.name,
      title: segment?.programme.title ?? 'Off air',
      startsAtMs: segment?.startsAtMs ?? null,
      endsAtMs: segment?.endsAtMs ?? null,
    });
    elementRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [channel.name, focused, segment]);

  const current = Boolean(
    segment &&
      wallClockMs >= segment.startsAtMs &&
      wallClockMs < segment.endsAtMs,
  );
  const totalWindowMs = windowEndMs - windowStartMs;
  const style: TimelineStyle = segment
    ? {
        '--guide-left': `${((segment.clippedStartMs - windowStartMs) / totalWindowMs) * 100}%`,
        '--guide-width': `${((segment.clippedEndMs - segment.clippedStartMs) / totalWindowMs) * 100}%`,
      }
    : { '--guide-left': '0%', '--guide-width': '100%' };

  return (
    <button
      className="ctv-guide-cell"
      ref={setRef}
      style={style}
      type="button"
      tabIndex={-1}
      data-focused={focused ? 'true' : undefined}
      data-current={current ? 'true' : undefined}
      data-active-channel={channel.id === activeChannelId ? 'true' : undefined}
      data-off-air={!segment ? 'true' : undefined}
      onClick={() => onTune(channel.id)}
      aria-label={
        segment
          ? `Channel ${channelNumber}, ${channel.name}: ${segment.programme.title}, ${timeRange(segment.startsAtMs, segment.endsAtMs)}`
          : `Channel ${channelNumber}, ${channel.name}, off air`
      }
    >
      <strong>{segment?.programme.title ?? 'Off air'}</strong>
      {segment && <span>{timeFormatter.format(segment.startsAtMs)}</span>}
    </button>
  );
}

function GuideRow({
  channel,
  channelNumber,
  activeChannelId,
  wallClockMs,
  windowStartMs,
  windowEndMs,
  nowPercent,
  onTune,
  onFocused,
}: {
  channel: GuideChannel;
  channelNumber: number;
  activeChannelId: string;
  wallClockMs: number;
  windowStartMs: number;
  windowEndMs: number;
  nowPercent: number;
  onTune: (channelId: string) => void;
  onFocused: (programme: FocusedProgramme) => void;
}) {
  const segments = useMemo(
    () => buildSegments(channel, windowStartMs, windowEndMs),
    [channel, windowEndMs, windowStartMs],
  );
  const currentIndex = segments.findIndex(
    (segment) =>
      wallClockMs >= segment.startsAtMs && wallClockMs < segment.endsAtMs,
  );

  return (
    <div className="ctv-guide-row">
      <div className="ctv-guide-station">
        <span>{String(channelNumber).padStart(2, '0')}</span>
        <strong>{channel.name}</strong>
      </div>
      <div className="ctv-guide-programmes">
        {segments.length > 0 ? (
          segments.map((segment, index) => (
            <GuideCell
              key={`${segment.programmeIndex}:${segment.startsAtMs}`}
              channel={channel}
              channelNumber={channelNumber}
              segment={segment}
              windowStartMs={windowStartMs}
              windowEndMs={windowEndMs}
              wallClockMs={wallClockMs}
              activeChannelId={activeChannelId}
              autoFocus={channel.id === activeChannelId && index === currentIndex}
              onTune={onTune}
              onFocused={onFocused}
            />
          ))
        ) : (
          <GuideCell
            channel={channel}
            channelNumber={channelNumber}
            segment={null}
            windowStartMs={windowStartMs}
            windowEndMs={windowEndMs}
            wallClockMs={wallClockMs}
            activeChannelId={activeChannelId}
            autoFocus={channel.id === activeChannelId}
            onTune={onTune}
            onFocused={onFocused}
          />
        )}
        <i
          className="ctv-guide-now-line ctv-guide-now-line--row"
          style={{ left: `${nowPercent}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export function GuideGrid({ channelId, onTune, onOpenOnDemand }: GuideGridProps) {
  const channels = useMemo(catalogChannels, []);
  const activeChannelId = channels.some((channel) => channel.id === channelId)
    ? (channelId as string)
    : (channels[0]?.id ?? '');
  const [wallClockMs, setWallClockMs] = useState(() => Date.now());
  const [windowStartMs, setWindowStartMs] = useState(() =>
    guideWindowStart(Date.now()),
  );
  const windowEndMs = windowStartMs + WINDOW_MS;
  const [focusedProgramme, setFocusedProgramme] = useState<FocusedProgramme | null>(
    null,
  );

  useEffect(() => {
    const timer = window.setInterval(() => setWallClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      wallClockMs < windowStartMs ||
      wallClockMs >= windowEndMs - TICK_MS
    ) {
      setWindowStartMs(guideWindowStart(wallClockMs));
    }
  }, [wallClockMs, windowEndMs, windowStartMs]);

  const ticks = useMemo(() => {
    const values: number[] = [];
    for (let time = windowStartMs; time <= windowEndMs; time += TICK_MS) {
      values.push(time);
    }
    return values;
  }, [windowEndMs, windowStartMs]);
  const nowPercent = Math.min(
    100,
    Math.max(0, ((wallClockMs - windowStartMs) / WINDOW_MS) * 100),
  );

  return (
    <section className="ctv-guide" aria-label="Custom TV programme guide">
      <header className="ctv-guide-header">
        <div className="ctv-guide-title">
          <span className="ctv-guide-live-dot" aria-hidden="true" />
          <div>
            <h1>Live guide</h1>
            <p>
              {focusedProgramme
                ? `${focusedProgramme.channelName} · ${focusedProgramme.title}`
                : 'What’s on now'}
            </p>
          </div>
        </div>
        <div className="ctv-guide-selection-time">
          {focusedProgramme &&
            timeRange(focusedProgramme.startsAtMs, focusedProgramme.endsAtMs)}
        </div>
        {onOpenOnDemand && <OnDemandButton onOpen={onOpenOnDemand} />}
      </header>

      {channels.length > 0 ? (
        <main className="ctv-guide-grid">
          <div className="ctv-guide-axis-row">
            <div className="ctv-guide-axis-label">Channels</div>
            <div className="ctv-guide-axis">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  style={{ left: `${((tick - windowStartMs) / WINDOW_MS) * 100}%` }}
                >
                  {timeFormatter.format(tick)}
                </span>
              ))}
              <i className="ctv-guide-now-line" style={{ left: `${nowPercent}%` }}>
                <b>Now</b>
              </i>
            </div>
          </div>

          <div className="ctv-guide-rows">
            {channels.map((channel, index) => (
              <GuideRow
                key={channel.id}
                channel={channel}
                channelNumber={index + 1}
                activeChannelId={activeChannelId}
                wallClockMs={wallClockMs}
                windowStartMs={windowStartMs}
                windowEndMs={windowEndMs}
                nowPercent={nowPercent}
                onTune={onTune}
                onFocused={setFocusedProgramme}
              />
            ))}
          </div>
        </main>
      ) : (
        <main className="ctv-guide-empty" role="status">
          <h2>The guide is waiting for its first station.</h2>
          <p>On-demand videos will appear after the next library import.</p>
        </main>
      )}

      <footer className="ctv-guide-hints glass">
        <span><b aria-hidden="true">↑↓←→</b> Browse</span>
        <span><b aria-hidden="true">A</b> Tune</span>
        <span><b aria-hidden="true">B</b> Live TV</span>
      </footer>
    </section>
  );
}
