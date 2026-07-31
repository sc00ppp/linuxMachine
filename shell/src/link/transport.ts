/**
 * WebSocket link to `consoled` (../consoled, Rust daemon) — the wire client
 * shared by the TV shell (role `tv`) and the phone PWA (role `phone`).
 *
 * This is a small-protocol port of the RECONNECTION BEHAVIOR proven out in
 * `o3code/src/transport-ws.ts` (a much bigger remote-desktop transport with
 * its own invoke/reply RPC layer, seq-hole/compaction gap-fill, and floor
 * seeding). None of that machinery applies here — our protocol (CONTRACTS.md
 * Round 3) has no commands, no compaction, and a single small ring (cap 64)
 * per channel — so only the lessons about keeping a socket ALIVE and
 * RECOVERING FAST made the trip:
 *
 *   1. Exponential backoff (500ms -> 30s cap) so a genuinely dead server
 *      doesn't get hammered, but a blip recovers quickly.
 *   2. A 15s app-level ping. Idle-timeout proxies/OS network stacks (and iOS
 *      in particular) silently reap a WebSocket that has carried no traffic
 *      for a while; an empty `state`/`input` channel would otherwise flap.
 *   3. `visibilitychange` triggers an immediate redial. iOS FREEZES a
 *      backgrounded tab — the socket dies and the backoff timer that would
 *      have retried it is frozen too. Without this, returning to the tab
 *      can sit on a stale "reconnecting in 30s" instead of reconnecting the
 *      instant the OS lets the tab run again.
 *   4. Per-channel floor tracking, so a reconnect's `sub` carries `after`
 *      and the server's ring only replays what we haven't already seen.
 *   5. `authErr` is fail-fast, not flaky-network: a rejected/expired phone
 *      token will be rejected again on every retry, so backoff would just
 *      loop forever showing "connecting…" instead of sending the user back
 *      to the pairing screen. `authFailed` status is terminal — this link
 *      instance stops trying; a caller that gets a fresh token constructs a
 *      new `createLink`.
 *
 * Framework-free by design (no React import): both the TV shell (a plain
 * store subscriber) and the phone UI (React) consume the same object.
 */

// ---------------------------------------------------------------------------
// Wire protocol (CONTRACTS.md Round 3) — kept as a private mirror here rather
// than a shared module so this file has zero cross-worker dependencies.
// ---------------------------------------------------------------------------

type ClientFrame =
  | { t: 'auth'; role: 'tv' | 'phone'; token?: string }
  | { t: 'sub'; chan: string; after?: number }
  | { t: 'send'; chan: string; payload: object }
  | { t: 'ping' };

type ServerFrame =
  | { t: 'authOk' }
  | { t: 'authErr'; reason: string }
  | { t: 'event'; chan: string; seq: number; payload: unknown; replay?: boolean }
  | { t: 'synced'; chan: string; seq: number }
  | { t: 'pong' };

/** Parsed + validated server->client frame, or `null` for anything we can't
 *  trust (malformed JSON, an unknown/future `t`, or a known `t` missing its
 *  required fields). Never throws — a bad frame is dropped, not fatal. Pure
 *  and side-effect-free, so it's the easiest part of this file to unit test
 *  directly against wire fixtures. */
export function parseServerFrame(raw: string): ServerFrame | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const f = obj as Record<string, unknown>;
  switch (f.t) {
    case 'authOk':
      return { t: 'authOk' };
    case 'authErr':
      return typeof f.reason === 'string' ? { t: 'authErr', reason: f.reason } : null;
    case 'event':
      if (typeof f.chan === 'string' && typeof f.seq === 'number' && 'payload' in f) {
        return {
          t: 'event',
          chan: f.chan,
          seq: f.seq,
          payload: f.payload,
          replay: f.replay === true,
        };
      }
      return null;
    case 'synced':
      return typeof f.chan === 'string' && typeof f.seq === 'number'
        ? { t: 'synced', chan: f.chan, seq: f.seq }
        : null;
    case 'pong':
      return { t: 'pong' };
    default:
      // Unknown frame type — a newer server than this client expects. Never
      // fatal; just ignore it (forward compatibility).
      return null;
  }
}

/** An `event` frame is only new (not replay overlap already applied) when
 *  its seq is strictly greater than the highest seq we've delivered for
 *  that channel so far. Pulled out as its own pure predicate because it's
 *  the crux of the "remembers floor" contract requirement. */
export function isNewSeq(seq: number, floor: number): boolean {
  return seq > floor;
}

/** 500ms -> 30s exponential backoff, doubling each failed attempt. Pure so
 *  the growth curve can be asserted directly without spinning up sockets. */
export const BACKOFF_START_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
export function nextBackoff(current: number): number {
  return Math.min(current * 2, BACKOFF_MAX_MS);
}

/** App-level keepalive cadence (see lesson 2 above). */
const KEEPALIVE_MS = 15_000;

// ---------------------------------------------------------------------------
// Public contract (CONTRACTS.md shell/src/link/transport.ts)
// ---------------------------------------------------------------------------

export interface LinkEvent {
  chan: string;
  seq: number;
  payload: unknown;
  replay?: boolean;
}

export type LinkStatus = 'connecting' | 'open' | 'closed' | 'authFailed';

export interface CreateLinkOpts {
  /** e.g. "ws://host:43919/ws" */
  url: string;
  role: 'tv' | 'phone';
  /** Required for role 'phone' (pairing token); omitted for 'tv' (loopback-trusted). */
  token?: string;
  onStatus?: (s: LinkStatus) => void;
}

export interface Link {
  /** Registers `handler` for `chan`, sends a `sub` frame (once authed),
   *  and remembers the channel's floor so a later reconnect resubscribes
   *  with `after` instead of re-requesting the whole ring. Returns an
   *  unsubscribe function. */
  subscribe(chan: string, handler: (e: LinkEvent) => void): () => void;
  /** Publishes to `chan`. Silently dropped while the link isn't open+authed
   *  (per contract) — callers that need delivery guarantees should not rely
   *  on `send`; this protocol has none. */
  send(chan: string, payload: object): void;
  /** Tears the link down for good: no further reconnect attempts. */
  close(): void;
}

class LinkClient {
  private ws: WebSocket | null = null;
  private authed = false;
  /** User called close() — terminal, like authFailed, but not an error state. */
  private closed = false;
  /** Server rejected auth — terminal; see lesson 5 in the header comment. */
  private authFailed = false;
  private backoff = BACKOFF_START_MS;

  /** Registered handlers per channel; also doubles as "what to resubscribe
   *  on reconnect" (every key here gets a fresh `sub` once authed). */
  private readonly handlers = new Map<string, Set<(e: LinkEvent) => void>>();
  /** Channels we've already sent a `sub` for on the CURRENT socket — reset
   *  on every reconnect so authOk resubscribes everything, but prevents a
   *  second `subscribe()` call for an already-active channel from spamming
   *  the wire while the socket is alive. */
  private readonly subscribedChans = new Set<string>();
  /** Highest seq delivered per channel, across the link's whole lifetime —
   *  this is what makes a reconnect's `sub after:` skip what we already
   *  have instead of replaying the ring from scratch. */
  private readonly floors = new Map<string, number>();

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly keepAliveTimer: ReturnType<typeof setInterval>;

  constructor(private readonly opts: CreateLinkOpts) {
    // visibilitychange, not focus/blur: a backgrounded-but-visible tab (e.g.
    // occluded by another window) doesn't get iOS's freeze treatment and
    // shouldn't force a redial; only the true background->foreground edge
    // should pull a pending backoff forward.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.wake);
    }
    this.keepAliveTimer = setInterval(this.ping, KEEPALIVE_MS);
    this.connect();
  }

  private setStatus(s: LinkStatus) {
    this.opts.onStatus?.(s);
  }

  private connect() {
    if (this.closed || this.authFailed) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.authed = false;
    // Every reconnect gets a fresh socket, so nothing has been told about
    // this connection yet — authOk repopulates it from `handlers`.
    this.subscribedChans.clear();

    ws.onopen = () => {
      const frame: ClientFrame = { t: 'auth', role: this.opts.role, token: this.opts.token };
      ws.send(JSON.stringify(frame));
    };
    ws.onmessage = (ev) => this.onFrame(String(ev.data));
    ws.onclose = () => this.onDown();
    // Browsers hand onerror almost nothing actionable; onclose always
    // follows and is what actually drives recovery, so there's nothing to
    // do here beyond not letting a thrown handler break the socket.
    ws.onerror = () => {};
  }

  private onFrame(raw: string) {
    const frame = parseServerFrame(raw);
    if (!frame) return;
    switch (frame.t) {
      case 'authOk': {
        this.authed = true;
        this.backoff = BACKOFF_START_MS;
        this.setStatus('open');
        // Resubscribe every channel with live handlers, each from its own
        // floor — the ring replays only what this instance hasn't seen.
        for (const chan of this.handlers.keys()) this.sendSub(chan);
        return;
      }
      case 'authErr': {
        // Fail fast (lesson 5): a bad token stays bad, so stop retrying
        // instead of flapping "connecting…" forever.
        this.authFailed = true;
        this.setStatus('authFailed');
        return;
      }
      case 'event': {
        const floor = this.floors.get(frame.chan) ?? 0;
        if (!isNewSeq(frame.seq, floor)) return; // replay overlap, already applied
        this.floors.set(frame.chan, frame.seq);
        const set = this.handlers.get(frame.chan);
        if (!set || set.size === 0) return;
        const event: LinkEvent = {
          chan: frame.chan,
          seq: frame.seq,
          payload: frame.payload,
          replay: frame.replay,
        };
        for (const handler of set) handler(event);
        return;
      }
      case 'synced':
        // End of a subscribe's replay burst. Our floor tracking already
        // dedupes as frames arrive, so there's nothing further to reconcile
        // against this tiny (cap-64, non-compacting) ring — unlike
        // o3-transport's `synced`, which has to detect a server-side seq
        // reset. Kept as an explicit case (not folded into `default`) so a
        // future need doesn't have to hunt for where to add it.
        return;
      case 'pong':
        // Keepalive reply; ping() is fire-and-forget so there's nothing to
        // correlate this to. Its only job was proving the socket is alive.
        return;
    }
  }

  /** Send `sub` for `chan` if we're authed and haven't already on this
   *  socket. Safe to call speculatively (e.g. from `subscribe()` before
   *  auth completes) — it's a no-op until authed, and authOk re-runs it for
   *  every registered channel. */
  private sendSub(chan: string) {
    if (!this.authed || this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.subscribedChans.has(chan)) return;
    this.subscribedChans.add(chan);
    const after = this.floors.get(chan);
    const frame: ClientFrame = after === undefined ? { t: 'sub', chan } : { t: 'sub', chan, after };
    this.ws.send(JSON.stringify(frame));
  }

  private onDown() {
    this.authed = false;
    this.ws = null;
    // authFailed already reported its own terminal status via the authErr
    // frame; closed means the caller tore this down on purpose. Either way,
    // don't overwrite that status with 'closed' and don't reconnect.
    if (this.closed || this.authFailed) return;
    this.setStatus('closed');
    this.scheduleReconnect(this.backoff);
    this.backoff = nextBackoff(this.backoff);
  }

  /** One pending attempt at a time: re-arming replaces it rather than
   *  racing a second socket into existence, so `wake()` can pull a long
   *  wait forward safely. */
  private scheduleReconnect(delay: number) {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** iOS/backoff lesson 3: coming back to the foreground IS the retry
   *  signal, so take it immediately instead of waiting out a backoff that
   *  was frozen along with the tab. Guarded on `retryTimer` so this only
   *  ever fires while genuinely between sockets (never steals a live or
   *  currently-connecting one). */
  private wake = () => {
    if (this.closed || this.authFailed) return;
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (this.retryTimer === null) return;
    this.backoff = BACKOFF_START_MS;
    this.scheduleReconnect(0);
  };

  /** Fire-and-forget `ping` — see lesson 2. Only sent over a live, authed
   *  socket; otherwise the reconnect path already owns recovery. */
  private ping = () => {
    if (!this.authed || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const frame: ClientFrame = { t: 'ping' };
      this.ws.send(JSON.stringify(frame));
    } catch {
      // The socket died under us between the readyState check and send();
      // onclose will observe it and drive the reconnect.
    }
  };

  subscribe(chan: string, handler: (e: LinkEvent) => void): () => void {
    let set = this.handlers.get(chan);
    if (!set) {
      set = new Set();
      this.handlers.set(chan, set);
    }
    set.add(handler);
    this.sendSub(chan); // no-op until authed; authOk covers it otherwise
    let active = true;
    return () => {
      if (!active) return; // idempotent — a second call is a no-op, not a double-delete
      active = false;
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(chan);
        this.subscribedChans.delete(chan);
        // Deliberately no wire "unsub": the protocol (CONTRACTS.md) doesn't
        // define one, and this ring is cheap (cap 64) — staying subscribed
        // server-side until the socket eventually drops costs nothing worth
        // inventing a frame type for.
      }
    };
  }

  send(chan: string, payload: object): void {
    if (!this.authed || this.ws?.readyState !== WebSocket.OPEN) return; // drop silently, per contract
    const frame: ClientFrame = { t: 'send', chan, payload };
    this.ws.send(JSON.stringify(frame));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.setStatus('closed');
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.wake);
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    clearInterval(this.keepAliveTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export function createLink(opts: CreateLinkOpts): Link {
  const client = new LinkClient(opts);
  return {
    subscribe: (chan, handler) => client.subscribe(chan, handler),
    send: (chan, payload) => client.send(chan, payload),
    close: () => client.close(),
  };
}

// ---------------------------------------------------------------------------
// debouncedStatus — the o3code/src/connection-notice.ts lesson, extracted as
// a plain (framework-free) helper for whoever builds the phone's reconnect
// banner (CONTRACTS.md src/phone/: "debounced ~1.5s so blips don't flash").
//
// o3code's version is a React hook (`useConnectionNotice`) baked around one
// fixed state shape. This is the hook's core minus React: brief interruptions
// are routine on Wi-Fi/cellular handoffs, so a banner should only appear once
// a "bad" status has been true for `delayMs` — but recovery status(es) always
// win instantly, cancelling any pending banner rather than letting a stale
// timer resurrect it after the link already came back.
// ---------------------------------------------------------------------------

/**
 * Wrap a status callback so only `delayMs`-persistent "bad" statuses reach
 * it; any status in `clearStatuses` (e.g. `'open'`) is reported immediately
 * and cancels a pending bad-status timer. Call the returned function on
 * every raw status change (e.g. from `createLink`'s `onStatus`).
 */
export function debouncedStatus<S extends string>(
  delayMs: number,
  clearStatuses: readonly S[],
  onChange: (s: S) => void,
): (s: S) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (s: S) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (clearStatuses.includes(s)) {
      // This is deliberately synchronous, not just "cancel the timer": the
      // caller's UI should clear the banner in the SAME tick the link comes
      // back, never lagging a delayMs behind recovery.
      onChange(s);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      onChange(s);
    }, delayMs);
  };
}
