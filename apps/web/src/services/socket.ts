import { io, type Socket } from 'socket.io-client';
import { ref } from 'vue';
import type { ClientToServerEvents, ServerToClientEvents } from '@chp/shared';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type EventName = keyof ServerToClientEvents;
type AnyHandler = (...args: unknown[]) => void;

let socket: AppSocket | null = null;
/** true while the notification channel is up (an offline banner shows when false). */
export const socketConnected = ref(false);

// Listeners live in a registry so they survive (re)connects and logins.
const listeners = new Map<EventName, Set<AnyHandler>>();
const reconnectHandlers = new Set<() => void>();

/** Open the WebSocket for the logged-in user. Events missed while offline are recovered by refetching. */
export function connectSocket(token: string) {
  disconnectSocket();
  const s: AppSocket = io({ path: '/socket.io', transports: ['websocket'], auth: { token } });
  socket = s;
  for (const [event, handlers] of listeners) for (const h of handlers) s.on(event, h as never);

  let connectedBefore = false;
  s.on('connect', () => {
    socketConnected.value = true;
    if (connectedBefore) reconnectHandlers.forEach((fn) => fn());
    connectedBefore = true;
  });
  s.on('disconnect', () => (socketConnected.value = false));
  s.on('connect_error', () => (socketConnected.value = false));
}

export function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  socketConnected.value = false;
}

/** Subscribe to a server event; returns an unsubscribe function. */
export function onSocket<E extends EventName>(event: E, handler: ServerToClientEvents[E]) {
  const h = handler as unknown as AnyHandler;
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(h);
  socket?.on(event, h as never);
  return () => {
    listeners.get(event)?.delete(h);
    socket?.off(event, h as never);
  };
}

/** Called after the socket reconnects, so screens can refetch what they may have missed. */
export function onSocketReconnect(fn: () => void) {
  reconnectHandlers.add(fn);
  return () => {
    reconnectHandlers.delete(fn);
  };
}
