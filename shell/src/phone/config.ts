/**
 * Where the console lives, from the phone's point of view.
 *
 * The phone loads the shell from Vite on the console box (`http://<box>:5620/phone`),
 * so the daemon is always "same host, fixed port" — no discovery, no mDNS, no
 * user typing an IP. Port is pinned by CONTRACTS.md Round 3.
 */

export const CONSOLE_PORT = 43919;

/** localStorage key holding the pairing record (CONTRACTS.md Round 3 §phone). */
export const PAIRING_KEY = 'console-phone-pairing';

/** Hostname the page was served from — that is the console. */
export function consoleHost(): string {
  return window.location.hostname || 'localhost';
}

export function httpBase(host: string): string {
  return `http://${host}:${CONSOLE_PORT}`;
}

export function wsUrl(host: string): string {
  return `ws://${host}:${CONSOLE_PORT}/ws`;
}

/** Wire channel names (CONTRACTS.md Round 3). */
export const CHAN = {
  state: 'state',
  input: 'input',
  text: 'text',
} as const;
