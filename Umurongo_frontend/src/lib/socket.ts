// One Socket.IO connection for the whole app. The server only says *that* something changed;
// screens then refetch with TanStack Query. Socket.IO reconnects by itself with backoff.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_URL, session } from './api';
import { LiveConnection, coalesce, type LiveState } from './live';

let socket: Socket | null = null;
let live: LiveConnection | null = null;

export function getLive(): LiveConnection {
  if (!live) {
    socket = io(API_URL || undefined, {
      // Sent on every (re)connect, so a newly signed-in staff member can join staff rooms.
      auth: (cb) => cb({ token: session.get() }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    live = new LiveConnection(socket);
    // Signing in or out changes which rooms we may join: reconnect with the new token.
    session.subscribe(() => {
      socket?.disconnect();
      socket?.connect();
    });
  }
  return live;
}

/** Joins rooms while the component is mounted, e.g. useRooms([`ticket:${token}`]). */
export function useRooms(rooms: (string | null | undefined | false)[]) {
  const key = rooms.filter(Boolean).join('|');
  useEffect(() => (key ? getLive().join(key.split('|')) : undefined), [key]);
}

/** "live" or "reconnecting", for the Live / Reconnecting... badge. */
export function useLiveState(): LiveState {
  return useSyncExternalStore(
    (cb) => getLive().onState(cb),
    () => getLive().state,
    () => 'reconnecting',
  );
}

/**
 * Refetches the given queries when any of the events arrives, and after every reconnect
 * (events may have been missed while offline). Bursts are folded into one refetch.
 */
export function useLiveRefetch(events: string[], queryKeys: QueryKey[]) {
  const queryClient = useQueryClient();
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  const eventsKey = events.join('|');
  useEffect(() => {
    const l = getLive();
    const refetch = coalesce(() => keysRef.current.forEach((k) => queryClient.invalidateQueries({ queryKey: k })));
    const offs = [...eventsKey.split('|').map((e) => l.on(e, refetch)), l.onReconnect(refetch), l.on('demo:reset', refetch)];
    return () => {
      refetch.cancel();
      offs.forEach((off) => off());
    };
  }, [eventsKey, queryClient]);
}

/** Runs a handler for one socket event while mounted. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => getLive().on<T>(event, (p) => ref.current(p)), [event]);
}
