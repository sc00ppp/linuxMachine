/**
 * A fixed broadcast epoch shared by every Custom TV client. Changing this
 * value retunes every station, so treat it as part of the schedule format.
 */
export const CUSTOM_TV_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export interface SchedulableProgramme {
  readonly duration_seconds?: number | null;
}

export interface ScheduledChannel<T extends SchedulableProgramme> {
  readonly id: string;
  readonly playlist: readonly T[];
}

export interface ChannelSchedule<T extends SchedulableProgramme> {
  readonly current: T;
  readonly currentIndex: number;
  readonly next: T;
  readonly nextIndex: number;
  readonly secondsInto: number;
  readonly secondsRemaining: number;
  readonly cycleSeconds: number;
  readonly cycleOffsetSeconds: number;
  readonly rotationSeconds: number;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

/** FNV-1a implemented with 32-bit integer arithmetic for cross-runtime parity. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Stable phase within a channel cycle. The full 32-bit hash is projected over
 * the cycle instead of rounded to whole seconds, which keeps short stations
 * from bunching up at the epoch.
 */
export function channelRotationSeconds(
  channelId: string,
  cycleSeconds: number,
): number | null {
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) return null;
  return (stableHash(channelId) / 0x1_0000_0000) * cycleSeconds;
}

/**
 * Resolve a station at an explicit wall-clock instant. There is deliberately
 * no Date.now() default: callers supply the clock, keeping this function pure
 * and making TVs, phones, and tests arrive at the same result independently.
 */
export function scheduleAt<T extends SchedulableProgramme>(
  channel: ScheduledChannel<T>,
  wallClockMs: number,
): ChannelSchedule<T> | null {
  if (!Number.isFinite(wallClockMs) || channel.playlist.length === 0) {
    return null;
  }

  const durations: number[] = [];
  let cycleSeconds = 0;

  for (const programme of channel.playlist) {
    const duration = programme.duration_seconds;
    // A partially known playlist cannot produce an honest wall-clock answer:
    // silently dropping an item would make clients with different catalogues
    // disagree about everything after it.
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }
    durations.push(duration);
    cycleSeconds += duration;
  }

  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) return null;

  const rotationSeconds = channelRotationSeconds(channel.id, cycleSeconds);
  if (rotationSeconds === null) return null;

  const elapsedSeconds = (wallClockMs - CUSTOM_TV_EPOCH_MS) / 1000;
  const cycleOffsetSeconds = positiveModulo(
    elapsedSeconds + rotationSeconds,
    cycleSeconds,
  );

  let programmeStart = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index];
    const programmeEnd = programmeStart + duration;

    // Exact boundaries belong to the programme that is just starting. The
    // final-item fallback only protects against floating-point accumulation.
    if (cycleOffsetSeconds < programmeEnd || index === durations.length - 1) {
      const secondsInto = Math.min(
        duration,
        Math.max(0, cycleOffsetSeconds - programmeStart),
      );
      const secondsRemaining = Math.max(0, duration - secondsInto);
      const nextIndex = (index + 1) % channel.playlist.length;

      return {
        current: channel.playlist[index],
        currentIndex: index,
        next: channel.playlist[nextIndex],
        nextIndex,
        secondsInto,
        secondsRemaining,
        cycleSeconds,
        cycleOffsetSeconds,
        rotationSeconds,
        startsAtMs: wallClockMs - secondsInto * 1000,
        endsAtMs: wallClockMs + secondsRemaining * 1000,
      };
    }

    programmeStart = programmeEnd;
  }

  return null;
}
