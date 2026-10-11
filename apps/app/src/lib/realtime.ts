/**
 * The live connection.
 *
 * One socket, opened once the person has a session. It carries try-on
 * progress, message arrivals, payment status and credit changes. Everything
 * the server pushes is typed by the same schema the server validates with.
 *
 * It reconnects with a widening delay, and stops trying while the app is in
 * the background.
 */

import { type ServerFrame, serverFrameSchema } from '@nima/contracts';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { authClient } from './auth';
import { API_URL, reachable } from './config';

type Listener = (frame: ServerFrame) => void;

const listeners = new Set<Listener>();

let socket: WebSocket | null = null;
let attempt = 0;
let closedOnPurpose = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function wsUrl(): string {
  return `${API_URL.replace(/^http/, 'ws')}/ws`;
}

function emit(frame: ServerFrame): void {
  for (const listener of listeners) listener(frame);
}

async function connect(): Promise<void> {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  closedOnPurpose = false;

  // The browser attaches its own cookies. React Native does not, but its
  // WebSocket accepts headers, so the stored session is passed there.
  let cookie: string | undefined;
  if (Platform.OS !== 'web') {
    try {
      cookie = await authClient.getCookie?.();
    } catch {
      cookie = undefined;
    }
  }

  if (Platform.OS === 'web' || !cookie) {
    socket = new WebSocket(wsUrl());
  } else {
    // React Native accepts a third options argument that the DOM type for
    // WebSocket does not describe.
    const NativeWebSocket = WebSocket as unknown as new (
      url: string,
      protocols: undefined,
      options: { headers: Record<string, string> },
    ) => WebSocket;

    socket = new NativeWebSocket(wsUrl(), undefined, {
      headers: { cookie, origin: API_URL },
    });
  }

  socket.onopen = () => {
    heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25_000);
  };

  socket.onmessage = (event) => {
    try {
      const parsed = serverFrameSchema.safeParse(reachable(JSON.parse(String(event.data))));
      if (!parsed.success) return;
      // Accepted. Only now is it safe to forget the earlier failures: the
      // server opens the socket before it checks the session, so a refused
      // connection still fires onopen, and resetting there meant retrying
      // once a second forever.
      if (parsed.data.type === 'ready') attempt = 0;
      emit(parsed.data);
    } catch {
      // A frame we cannot read is not worth crashing over.
    }
  };

  socket.onclose = (event) => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    socket = null;

    if (closedOnPurpose) return;

    // Refused for want of a session. Retrying will not change that; signing
    // in will, and that reconnects through `reconnectRealtime`.
    if (event.code === 4401) return;

    // 1s, 2s, 4s, up to 30s.
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
    setTimeout(() => void connect(), delay);
  };

  socket.onerror = () => socket?.close();
}

let sessionUser: string | null | undefined;

/**
 * After signing in or out, so the socket carries the new session.
 *
 * Called with whoever is signed in now. The first call only records them;
 * later calls reconnect when that has changed.
 */
export function reconnectRealtime(userId: string | null): void {
  const previous = sessionUser;
  sessionUser = userId;
  if (previous === undefined || previous === userId) return;

  closedOnPurpose = true;
  socket?.close();
  socket = null;
  attempt = 0;
  if (listeners.size > 0) void connect();
}

export function disconnectRealtime(): void {
  closedOnPurpose = true;
  socket?.close();
}

/** Subscribe to every frame. Returns an unsubscribe function. */
export function onServerFrame(listener: Listener): () => void {
  listeners.add(listener);
  void connect();
  return () => listeners.delete(listener);
}

/** Listen to one kind of frame, for the lifetime of a component. */
export function useServerFrame<T extends ServerFrame['type']>(
  type: T,
  handler: (frame: Extract<ServerFrame, { type: T }>) => void,
): void {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    return onServerFrame((frame) => {
      if (frame.type === type) saved.current(frame as Extract<ServerFrame, { type: T }>);
    });
  }, [type]);
}

/** Open the socket while the app is in front, close it when it is not. */
export function useRealtimeConnection(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    void connect();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void connect();
      else disconnectRealtime();
    });

    return () => {
      subscription.remove();
      disconnectRealtime();
    };
  }, [enabled]);
}
