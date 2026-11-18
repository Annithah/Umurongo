// The reconnect and room logic, kept free of React and of socket.io so it can be unit-tested
// with a fake socket. socket.ts wires it to the real Socket.IO client.

/** The few socket methods we use (socket.io-client's Socket satisfies this). */
export interface SocketLike {
  connected: boolean;
  on(event: string, fn: (...args: unknown[]) => void): unknown;
  off(event: string, fn: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

export type LiveState = 'live' | 'reconnecting';

/**
 * Keeps track of the rooms screens want, joins them on every (re)connect (the server forgets
 * rooms when a connection drops), and reports "live" / "reconnecting".
 */
export class LiveConnection {
  private rooms = new Map<string, number>();
  private stateListeners = new Set<(s: LiveState) => void>();
  private reconnectListeners = new Set<() => void>();
  private everConnected = false;
  state: LiveState;

  constructor(private socket: SocketLike) {
    this.state = socket.connected ? 'live' : 'reconnecting';
    socket.on('connect', this.onConnect);
    socket.on('disconnect', this.onDisconnect);
    socket.on('connect_error', this.onDisconnect);
  }

  private setState(s: LiveState) {
    if (this.state === s) return;
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private onConnect = () => {
    if (this.rooms.size) this.socket.emit('join', [...this.rooms.keys()]);
    const wasReconnect = this.everConnected;
    this.everConnected = true;
    this.setState('live');
    // After a reconnect we may have missed events: screens refetch.
    if (wasReconnect) this.reconnectListeners.forEach((l) => l());
  };

  private onDisconnect = () => this.setState('reconnecting');

  /** Joins rooms (reference counted). Returns a function that leaves them again. */
  join(rooms: string[]): () => void {
    const fresh = rooms.filter((r) => {
      const n = this.rooms.get(r) ?? 0;
      this.rooms.set(r, n + 1);
      return n === 0;
    });
    if (fresh.length && this.socket.connected) this.socket.emit('join', fresh);
    return () => {
      const gone = rooms.filter((r) => {
        const n = (this.rooms.get(r) ?? 1) - 1;
        if (n <= 0) this.rooms.delete(r);
        else this.rooms.set(r, n);
        return n <= 0;
      });
      if (gone.length && this.socket.connected) this.socket.emit('leave', gone);
    };
  }

  joinedRooms(): string[] {
    return [...this.rooms.keys()];
  }

  onState(l: (s: LiveState) => void) {
    this.stateListeners.add(l);
    return () => {
      this.stateListeners.delete(l);
    };
  }

  onReconnect(l: () => void) {
    this.reconnectListeners.add(l);
    return () => {
      this.reconnectListeners.delete(l);
    };
  }

  /** Calls fn for an event; returns an unsubscribe function. */
  on<T>(event: string, fn: (payload: T) => void) {
    const h = (p: unknown) => fn(p as T);
    this.socket.on(event, h);
    return () => {
      this.socket.off(event, h);
    };
  }
}

/**
 * Calls fn at most once per `ms` for bursts of events (one click can update several rooms).
 * The first event in a burst schedules the call; later ones in the window are folded in.
 */
export function coalesce(fn: () => void, ms = 150) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return run;
}
