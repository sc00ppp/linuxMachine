import { emulatorEntryById } from './emulators';

const DAEMON_ORIGIN = 'http://127.0.0.1:43919';

export interface GameLaunchStatus {
  running: boolean;
  pid?: number;
  systemId?: string;
  romPath?: string;
  emulator?: string;
  core?: string;
  startedAtMs?: number;
  missingBios?: string[];
  lastExit?: {
    systemId: string;
    romPath: string;
    exitCode: number | null;
    success: boolean;
    exitedAtMs: number;
  };
}

export type GameLaunchErrorCode =
  | 'DAEMON_UNREACHABLE'
  | 'INVALID_SYSTEM'
  | 'UNKNOWN_SYSTEM'
  | 'NO_EMULATOR_FOR_SYSTEM'
  | 'INVALID_ROM_PATH'
  | 'ROM_OUTSIDE_ROOT'
  | 'ROM_ROOT_UNAVAILABLE'
  | 'ROM_MISSING'
  | 'EMULATOR_MISSING'
  | 'CORE_MISSING'
  | 'ALREADY_RUNNING'
  | 'BIOS_MISSING'
  | 'EMULATOR_EXITED'
  | 'LAUNCH_FAILED'
  | 'KILL_FAILED'
  | 'SUPERVISOR_FAILED'
  | 'UNKNOWN';

export class GameLaunchError extends Error {
  readonly code: GameLaunchErrorCode;
  readonly missingBios: readonly string[];

  constructor(
    code: GameLaunchErrorCode,
    message: string,
    missingBios: readonly string[] = [],
  ) {
    super(message);
    this.name = 'GameLaunchError';
    this.code = code;
    this.missingBios = missingBios;
  }
}

interface ErrorPayload {
  code?: string;
  message?: string;
  missingBios?: string[];
}

function normalizeBiosFile(value: string): string | null {
  const withoutNote = value.replace(/\s+\([^)]*\).*$/, '').trim();
  const normalized = withoutNote.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/\.[a-z0-9]{2,5}$/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function biosRequest(systemId: string):
  | { files: string[]; anyOf: boolean }
  | undefined {
  const requirement = emulatorEntryById(systemId)?.bios;
  if (!requirement?.required) return undefined;
  const files = requirement.files
    .map(normalizeBiosFile)
    .filter((file): file is string => file !== null);
  if (files.length === 0) return undefined;
  const notes = requirement.notes?.toLocaleLowerCase() ?? '';
  return {
    files,
    anyOf:
      notes.includes('only one') ||
      notes.includes('one valid') ||
      notes.includes('either '),
  };
}

async function daemonRequest(
  path: string,
  init?: RequestInit,
): Promise<GameLaunchStatus> {
  let response: Response;
  try {
    response = await fetch(`${DAEMON_ORIGIN}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new GameLaunchError(
      'DAEMON_UNREACHABLE',
      'The console daemon is not reachable on this PC.',
    );
  }

  let payload: GameLaunchStatus | ErrorPayload = {};
  try {
    payload = (await response.json()) as GameLaunchStatus | ErrorPayload;
  } catch {
    // Preserve the HTTP failure below; an HTML proxy error is still honest.
  }
  if (!response.ok) {
    const error = payload as ErrorPayload;
    throw new GameLaunchError(
      (error.code as GameLaunchErrorCode | undefined) ?? 'UNKNOWN',
      error.message ?? `The console daemon returned HTTP ${response.status}.`,
      Array.isArray(error.missingBios) ? error.missingBios : [],
    );
  }
  return payload as GameLaunchStatus;
}

export function launchGame(
  systemId: string,
  romPath: string,
): Promise<GameLaunchStatus> {
  return daemonRequest('/launch', {
    method: 'POST',
    body: JSON.stringify({
      systemId,
      romPath,
      bios: biosRequest(systemId),
    }),
  });
}

export function gameLaunchStatus(): Promise<GameLaunchStatus> {
  return daemonRequest('/launch/status');
}

export function stopGame(): Promise<GameLaunchStatus> {
  return daemonRequest('/launch/kill', { method: 'POST' });
}

export interface LaunchProblem {
  title: string;
  detail: string;
}

export function explainLaunchProblem(
  error: unknown,
  systemId: string,
): LaunchProblem {
  const launchError = error instanceof GameLaunchError ? error : null;
  const requirement = emulatorEntryById(systemId)?.bios;
  const requirementText = requirement?.required && requirement.files.length > 0
    ? ` This system requires ${requirement.files.join(', ')}.`
    : '';

  switch (launchError?.code) {
    case 'DAEMON_UNREACHABLE':
      return {
        title: 'Console daemon unreachable',
        detail: 'The game was not started. Check that Console Daemon is running on this media PC.',
      };
    case 'ROM_MISSING':
    case 'INVALID_ROM_PATH':
      return {
        title: 'ROM file missing',
        detail: launchError.message,
      };
    case 'ROM_OUTSIDE_ROOT':
      return {
        title: 'ROM path rejected',
        detail: 'The requested file resolved outside this system’s configured ROM folder, so the daemon refused it.',
      };
    case 'EMULATOR_MISSING':
      return {
        title: 'Emulator not installed',
        detail: launchError.message,
      };
    case 'CORE_MISSING':
      return {
        title: 'Emulator core not installed',
        detail: launchError.message,
      };
    case 'BIOS_MISSING':
      return {
        title: 'Required BIOS missing',
        detail: launchError.missingBios.length > 0
          ? `The emulator closed during startup. Missing: ${launchError.missingBios.join(', ')}.`
          : `${launchError.message}${requirementText}`,
      };
    case 'EMULATOR_EXITED':
      return {
        title: 'Emulator closed during startup',
        detail: `${launchError.message}.${requirementText}`,
      };
    case 'ALREADY_RUNNING':
      return {
        title: 'A game is already running',
        detail: 'Stop the current emulator before launching another game.',
      };
    case 'UNKNOWN_SYSTEM':
    case 'NO_EMULATOR_FOR_SYSTEM':
      return {
        title: 'System is not launchable',
        detail: launchError.message,
      };
    default:
      return {
        title: launchError?.code === 'KILL_FAILED'
          ? 'Could not stop the emulator'
          : 'Game did not start',
        detail: launchError?.message ?? 'The launch failed before an emulator could be confirmed running.',
      };
  }
}
