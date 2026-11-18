// Reconnect logic used by every live screen (TV, patient page, staff boards).
import { describe, expect, it, vi } from 'vitest';
import { LiveConnection, coalesce, type SocketLike } from './live';

/** A stand-in for socket.io: records emits and lets the test fire events. */
class FakeSocket implements SocketLike {
  connected = false;
  emitted: [string, unknown][] = [];
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  on(e: string, fn: (...a: unknown[]) => void) {
    (this.handlers.get(e) ?? this.handlers.set(e, new Set()).get(e)!).add(fn);
  }
  off(e: string, fn: (...a: unknown[]) => void) {
    this.handlers.get(e)?.delete(fn);
  }
  emit(e: string, ...a: unknown[]) {
    this.emitted.push([e, a[0]]);
  }
  fire(e: string, payload?: unknown) {
    if (e === 'connect') this.connected = true;
    if (e === 'disconnect') this.connected = false;
    this.handlers.get(e)?.forEach((fn) => fn(payload));
  }
  joins() {
    return this.emitted.filter(([e]) => e === 'join').map(([, rooms]) => rooms);
  }
}

describe('LiveConnection', () => {
  it('joins rooms when it connects and again after every reconnect', () => {
    const s = new FakeSocket();
    const live = new LiveConnection(s);
    live.join(['tv:masaka']);
    expect(s.joins()).toEqual([]); // not connected yet: nothing sent
    s.fire('connect');
    expect(s.joins()).toEqual([['tv:masaka']]);
    s.fire('disconnect');
    s.fire('connect');
    expect(s.joins()).toEqual([['tv:masaka'], ['tv:masaka']]);
  });

  it('shows Reconnecting while down and Live when back', () => {
    const s = new FakeSocket();
    const live = new LiveConnection(s);
    const states: string[] = [];
    live.onState((x) => states.push(x));
    expect(live.state).toBe('reconnecting');
    s.fire('connect');
    s.fire('disconnect');
    s.fire('connect_error');
    s.fire('connect');
    expect(states).toEqual(['live', 'reconnecting', 'live']);
  });

  it('asks screens to refetch after a reconnect, not on the first connect', () => {
    const s = new FakeSocket();
    const live = new LiveConnection(s);
    const refetch = vi.fn();
    live.onReconnect(refetch);
    s.fire('connect');
    expect(refetch).not.toHaveBeenCalled();
    s.fire('disconnect');
    s.fire('connect');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('counts room users and leaves a room only when the last screen goes', () => {
    const s = new FakeSocket();
    s.connected = true;
    const live = new LiveConnection(s);
    const leaveA = live.join(['department:opd']);
    const leaveB = live.join(['department:opd', 'ticket:abc']);
    expect(s.joins()).toEqual([['department:opd'], ['ticket:abc']]);
    leaveA();
    expect(s.emitted.filter(([e]) => e === 'leave')).toEqual([]);
    leaveB();
    expect(s.emitted.filter(([e]) => e === 'leave')).toEqual([['leave', ['department:opd', 'ticket:abc']]]);
    expect(live.joinedRooms()).toEqual([]);
  });

  it('subscribes to events and unsubscribes cleanly', () => {
    const s = new FakeSocket();
    const live = new LiveConnection(s);
    const fn = vi.fn();
    const off = live.on<{ ticketNumber: string }>('call:new', fn);
    s.fire('call:new', { ticketNumber: 'OPD-024' });
    off();
    s.fire('call:new', { ticketNumber: 'OPD-025' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ ticketNumber: 'OPD-024' });
  });
});

describe('coalesce', () => {
  it('folds a burst of events into one refetch', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const run = coalesce(fn, 150);
      run();
      run();
      run();
      vi.advanceTimersByTime(149);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      run();
      run.cancel();
      vi.advanceTimersByTime(500);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
