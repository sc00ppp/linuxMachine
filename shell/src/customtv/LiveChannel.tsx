import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { customTvUrl } from '../core/customTvHost';
import { useFocusable } from '../focus';
import { customTvCatalog, type CustomTvVideo } from './catalog';
import { scheduleAt, type ChannelSchedule } from './schedule';
import './guide.css';

export const CUSTOM_TV_LIVE_SCOPE = 'customtv';

const BUG_VISIBLE_MS = 4_200;
const LOAD_WATCHDOG_MS = 8_000;

interface BroadcastChannel {
  id: string;
  name: string;
  playlist: readonly CustomTvVideo[];
}

interface PlaybackState {
  channelId: string;
  index: number;
  initialOffsetSeconds: number;
  startedAtMs: number;
  canonicalIndexAtStart: number;
  serial: number;
}

type TunerStyle = CSSProperties & { '--channel-offset': string };

export interface LiveChannelProps {
  /** Controlled station id. Invalid ids calmly fall back to the first station. */
  channelId?: string;
  onTune: (channelId: string) => void;
  onOpenGuide: (channelId: string) => void;
}

function catalogChannels(): BroadcastChannel[] {
  return customTvCatalog.categories.map((category) => ({
    id: category.id,
    name: category.display_name,
    playlist: customTvCatalog.videos.filter(
      (video) => video.category === category.id,
    ),
  }));
}

function validProgramme(programme: CustomTvVideo): boolean {
  const duration = programme.duration_seconds;
  return (
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Boolean(programme.media_url || programme.url)
  );
}

function nextPlayableIndex(
  playlist: readonly CustomTvVideo[],
  afterIndex: number,
  unavailable: ReadonlySet<string>,
): number | null {
  for (let step = 1; step <= playlist.length; step += 1) {
    const index = (afterIndex + step) % playlist.length;
    const candidate = playlist[index];
    if (candidate && validProgramme(candidate) && !unavailable.has(candidate.id)) {
      return index;
    }
  }
  return null;
}

function playbackFromSchedule(
  channel: BroadcastChannel,
  schedule: ChannelSchedule<CustomTvVideo> | null,
  wallClockMs: number,
  unavailable: ReadonlySet<string>,
  serial: number,
): PlaybackState | null {
  if (!schedule) return null;

  if (!unavailable.has(schedule.current.id)) {
    return {
      channelId: channel.id,
      index: schedule.currentIndex,
      initialOffsetSeconds: schedule.secondsInto,
      startedAtMs: wallClockMs,
      canonicalIndexAtStart: schedule.currentIndex,
      serial,
    };
  }

  const fallbackIndex = nextPlayableIndex(
    channel.playlist,
    schedule.currentIndex,
    unavailable,
  );
  if (fallbackIndex === null) return null;

  return {
    channelId: channel.id,
    index: fallbackIndex,
    initialOffsetSeconds: 0,
    startedAtMs: wallClockMs,
    canonicalIndexAtStart: schedule.currentIndex,
    serial,
  };
}

function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function circularChannels(
  channels: readonly BroadcastChannel[],
  activeIndex: number,
): Array<{ channel: BroadcastChannel; offset: number }> {
  return channels.map((_, step) => {
    const index = (activeIndex + step) % channels.length;
    // Keep the current station centered, with its immediate predecessor and
    // successor geometrically above/below. Re-centering after every move gives
    // the focus engine an endless, wrapping channel dial.
    const offset = step > channels.length / 2 ? step - channels.length : step;
    return { channel: channels[index], offset };
  });
}

function TuneTarget({
  channel,
  channelNumber,
  offset,
  activeChannelId,
  onTune,
  onOpenGuide,
}: {
  channel: BroadcastChannel;
  channelNumber: number;
  offset: number;
  activeChannelId: string;
  onTune: (channelId: string) => void;
  onOpenGuide: (channelId: string) => void;
}) {
  const latestTune = useRef(onTune);
  const latestGuide = useRef(onOpenGuide);
  latestTune.current = onTune;
  latestGuide.current = onOpenGuide;

  const { ref, focused } = useFocusable({
    id: `ctv-live-channel-${channel.id}`,
    scope: CUSTOM_TV_LIVE_SCOPE,
    autoFocus: channel.id === activeChannelId,
    onAccept: () => latestGuide.current(activeChannelId),
  });

  useLayoutEffect(() => {
    if (focused && channel.id !== activeChannelId) {
      latestTune.current(channel.id);
    }
  }, [activeChannelId, channel.id, focused]);

  const style: TunerStyle = { '--channel-offset': `${offset * 5}rem` };
  return (
    <button
      className="ctv-live-tune-target"
      ref={ref}
      style={style}
      type="button"
      tabIndex={-1}
      onClick={() => onTune(channel.id)}
      aria-label={`Channel ${channelNumber}, ${channel.name}. Press A for the guide.`}
    />
  );
}

export function LiveChannel({ channelId, onTune, onOpenGuide }: LiveChannelProps) {
  const channels = useMemo(catalogChannels, []);
  const activeIndex = Math.max(
    0,
    channels.findIndex((channel) => channel.id === channelId),
  );
  const activeChannel = channels[activeIndex] ?? null;
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const serialRef = useRef(0);

  const canonicalSchedule = useMemo(
    () =>
      activeChannel
        ? scheduleAt(
            { id: activeChannel.id, playlist: activeChannel.playlist },
            clockMs,
          )
        : null,
    [activeChannel, clockMs],
  );

  const [playback, setPlayback] = useState<PlaybackState | null>(() =>
    activeChannel
      ? playbackFromSchedule(
          activeChannel,
          scheduleAt(
            { id: activeChannel.id, playlist: activeChannel.playlist },
            clockMs,
          ),
          clockMs,
          unavailable,
          serialRef.current,
        )
      : null,
  );
  const [bugVisible, setBugVisible] = useState(true);
  const loadWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadWatchdog = useCallback(() => {
    if (loadWatchdogRef.current !== null) {
      clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Tuning always recomputes from wall time; no playhead survives a flip.
  useLayoutEffect(() => {
    if (!activeChannel) {
      setPlayback(null);
      return;
    }
    const now = Date.now();
    const schedule = scheduleAt(
      { id: activeChannel.id, playlist: activeChannel.playlist },
      now,
    );
    serialRef.current += 1;
    setClockMs(now);
    setPlayback(
      playbackFromSchedule(
        activeChannel,
        schedule,
        now,
        unavailable,
        serialRef.current,
      ),
    );
  }, [activeChannel, unavailable]);

  useEffect(() => {
    setBugVisible(true);
    const timer = window.setTimeout(() => setBugVisible(false), BUG_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeChannel?.id]);

  // A timer boundary is authoritative even if media metadata is a little off.
  useEffect(() => {
    if (!activeChannel || !canonicalSchedule) {
      setPlayback(null);
      return;
    }
    setPlayback((current) => {
      if (
        current &&
        current.channelId === activeChannel.id &&
        current.canonicalIndexAtStart === canonicalSchedule.currentIndex
      ) {
        return current;
      }
      serialRef.current += 1;
      return playbackFromSchedule(
        activeChannel,
        canonicalSchedule,
        clockMs,
        unavailable,
        serialRef.current,
      );
    });
  }, [
    activeChannel,
    canonicalSchedule?.currentIndex,
    clockMs,
    unavailable,
  ]);

  const advance = useCallback(
    (failedId?: string) => {
      if (!activeChannel) return;
      const blocked = new Set(unavailable);
      if (failedId) {
        blocked.add(failedId);
        setUnavailable(blocked);
      }

      setPlayback((current) => {
        const afterIndex =
          current?.channelId === activeChannel.id
            ? current.index
            : (canonicalSchedule?.currentIndex ?? -1);
        const nextIndex = nextPlayableIndex(
          activeChannel.playlist,
          afterIndex,
          blocked,
        );
        if (nextIndex === null) return null;

        const now = Date.now();
        serialRef.current += 1;
        return {
          channelId: activeChannel.id,
          index: nextIndex,
          initialOffsetSeconds: 0,
          startedAtMs: now,
          canonicalIndexAtStart:
            canonicalSchedule?.currentIndex ?? current?.canonicalIndexAtStart ?? nextIndex,
          serial: serialRef.current,
        };
      });
    }, [activeChannel, canonicalSchedule?.currentIndex, unavailable],
  );

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const playingVideo =
    activeChannel && playback?.channelId === activeChannel.id
      ? (activeChannel.playlist[playback.index] ?? null)
      : null;
  const sourceUrl = useMemo(
    () =>
      playingVideo
        ? customTvUrl(playingVideo.media_url || playingVideo.url)
        : null,
    [playingVideo],
  );
  const playbackKey = playback
    ? `${playback.channelId}:${playback.index}:${playback.serial}`
    : 'off-air';

  useEffect(() => {
    clearLoadWatchdog();
    if (!playingVideo) return;
    if (!sourceUrl) {
      queueMicrotask(() => advanceRef.current(playingVideo.id));
      return;
    }

    loadWatchdogRef.current = setTimeout(
      () => advanceRef.current(playingVideo.id),
      LOAD_WATCHDOG_MS,
    );
    return clearLoadWatchdog;
  }, [clearLoadWatchdog, playbackKey, playingVideo, sourceUrl]);

  useEffect(() => clearLoadWatchdog, [clearLoadWatchdog]);

  const elapsedSinceLoad = playback
    ? Math.max(0, (clockMs - playback.startedAtMs) / 1000)
    : 0;
  const playbackSeconds = playback
    ? playback.initialOffsetSeconds + elapsedSinceLoad
    : 0;
  const durationSeconds = playingVideo?.duration_seconds ?? 0;
  const secondsRemaining = Math.max(0, durationSeconds - playbackSeconds);
  const nextVideo =
    activeChannel && playback
      ? activeChannel.playlist[(playback.index + 1) % activeChannel.playlist.length]
      : canonicalSchedule?.next;
  const channelNumber = activeChannel ? activeIndex + 1 : 0;

  if (!activeChannel) {
    return (
      <section className="ctv-live ctv-live--empty" aria-label="Custom TV live">
        <div className="ctv-live-off-air glass glass--strong" role="status">
          <span className="ctv-live-off-air-mark" aria-hidden="true" />
          <h1>No stations are on the dial yet.</h1>
          <p>On-demand videos will appear after the next library import.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ctv-live" aria-label={`${activeChannel.name}, live`}>
      <div className="ctv-live-picture">
        {playingVideo && sourceUrl ? (
          <video
            key={playbackKey}
            src={sourceUrl}
            poster={playingVideo.thumbnail ?? undefined}
            autoPlay
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              clearLoadWatchdog();
              if (!playback) return;
              const elapsed = Math.max(0, (Date.now() - playback.startedAtMs) / 1000);
              const desired = playback.initialOffsetSeconds + elapsed;
              const mediaDuration = event.currentTarget.duration;
              const maximum = Number.isFinite(mediaDuration)
                ? Math.max(0, mediaDuration - 0.05)
                : desired;
              event.currentTarget.currentTime = Math.min(desired, maximum);
              void event.currentTarget.play().catch(() => undefined);
            }}
            onEnded={() => advanceRef.current()}
            onError={() => advanceRef.current(playingVideo.id)}
          />
        ) : (
          <div className="ctv-live-off-air" role="status">
            <span className="ctv-live-off-air-mark" aria-hidden="true" />
            <h1>This station is between signals.</h1>
            <p>Try the next channel while the shelf catches up.</p>
          </div>
        )}
        <div className="ctv-live-vignette" aria-hidden="true" />
      </div>

      <div
        className="ctv-channel-bug glass glass--strong"
        data-visible={bugVisible ? 'true' : undefined}
        aria-live="polite"
      >
        <div className="ctv-channel-bug-number">
          <span>CH</span>
          <strong>{String(channelNumber).padStart(2, '0')}</strong>
        </div>
        <div className="ctv-channel-bug-copy">
          <div className="ctv-channel-bug-station">
            <strong>{activeChannel.name}</strong>
            <span>Live</span>
          </div>
          <h1>{playingVideo?.title ?? 'No programme scheduled'}</h1>
          <div className="ctv-channel-bug-next">
            <span>{playingVideo ? `${clockLabel(secondsRemaining)} left` : 'Off air'}</span>
            {nextVideo && <span>Next&nbsp; {nextVideo.title}</span>}
          </div>
        </div>
      </div>

      <div className="ctv-live-tuner" aria-label="Channel dial">
        {circularChannels(channels, activeIndex).map(({ channel, offset }) => (
          <TuneTarget
            key={channel.id}
            channel={channel}
            channelNumber={channels.indexOf(channel) + 1}
            offset={offset}
            activeChannelId={activeChannel.id}
            onTune={onTune}
            onOpenGuide={onOpenGuide}
          />
        ))}
      </div>

      <footer className="ctv-live-hints glass">
        <span><b aria-hidden="true">↑↓</b> Channel</span>
        <span><b aria-hidden="true">A</b> Guide</span>
        <span><b aria-hidden="true">B</b> Back</span>
      </footer>
    </section>
  );
}
