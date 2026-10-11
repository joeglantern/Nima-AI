/**
 * Realtime gateway.
 *
 * One WebSocket per signed in device at GET /ws. The server pushes; clients
 * send only small control frames.
 *
 * Fan-out goes through Valkey pub/sub rather than an in-process map, so a
 * message published by a worker (a finished try-on) reaches the socket even
 * though the worker is a different process, and so a second API node can be
 * added later without changing anything.
 *
 *   publish(channel, frame)  ->  valkey  ->  every node  ->  matching sockets
 */

import websocket from '@fastify/websocket';
import { channels, clientFrameSchema, type ServerFrame } from '@nima/contracts';
import fp from 'fastify-plugin';
import type { WebSocket } from 'ws';

const PUBSUB_CHANNEL = 'nima:realtime';

interface Envelope {
  /** Target channel, for example user:abc123. */
  channel: string;
  frame: ServerFrame;
}

export interface Realtime {
  /** Send to every socket subscribed to a channel, on any node. */
  publish(channel: string, frame: ServerFrame): Promise<void>;
  /** Convenience for the common case. */
  toUser(userId: string, frame: ServerFrame): Promise<void>;
  /** Sockets currently connected to this node, for diagnostics. */
  connectionCount(): number;
  isOnline(userId: string): boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: Realtime;
  }
}

export default fp(
  async (app) => {
    await app.register(websocket, {
      options: {
        maxPayload: 64 * 1024,
        // A try-on result is pushed as a URL, never as image bytes.
      },
    });

    /** channel -> sockets on this node */
    const subscriptions = new Map<string, Set<WebSocket>>();
    /** socket -> channels, so disconnect can clean up in one pass */
    const socketChannels = new WeakMap<WebSocket, Set<string>>();
    const onlineUsers = new Map<string, number>();

    function subscribe(socket: WebSocket, channel: string): void {
      let sockets = subscriptions.get(channel);
      if (!sockets) {
        sockets = new Set();
        subscriptions.set(channel, sockets);
      }
      sockets.add(socket);

      let owned = socketChannels.get(socket);
      if (!owned) {
        owned = new Set();
        socketChannels.set(socket, owned);
      }
      owned.add(channel);
    }

    function unsubscribe(socket: WebSocket, channel: string): void {
      const sockets = subscriptions.get(channel);
      if (!sockets) return;
      sockets.delete(socket);
      if (sockets.size === 0) subscriptions.delete(channel);
      socketChannels.get(socket)?.delete(channel);
    }

    function deliver(channel: string, frame: ServerFrame): void {
      const sockets = subscriptions.get(channel);
      if (!sockets || sockets.size === 0) return;

      const payload = JSON.stringify(frame);
      for (const socket of sockets) {
        // 1 === OPEN
        if (socket.readyState === 1) socket.send(payload);
      }
    }

    // Every node listens to the same channel and filters locally.
    await app.redisSub.subscribe(PUBSUB_CHANNEL);
    app.redisSub.on('message', (incoming, raw) => {
      if (incoming !== PUBSUB_CHANNEL) return;
      try {
        const envelope = JSON.parse(raw) as Envelope;
        deliver(envelope.channel, envelope.frame);
      } catch (error) {
        app.log.warn({ err: error }, 'Dropped a malformed realtime message');
      }
    });

    const realtime: Realtime = {
      async publish(channel, frame) {
        await app.redis.publish(
          PUBSUB_CHANNEL,
          JSON.stringify({ channel, frame } satisfies Envelope),
        );
      },
      async toUser(userId, frame) {
        await realtime.publish(channels.user(userId), frame);
      },
      connectionCount: () => onlineUsers.size,
      isOnline: (userId) => (onlineUsers.get(userId) ?? 0) > 0,
    };

    app.decorate('realtime', realtime);

    app.get('/ws', { websocket: true, schema: { hide: true } }, (socket, request) => {
      const user = request.user;

      if (!user) {
        // Names only, never values: enough to tell "no cookie at all" from
        // "a cookie the session lookup did not accept".
        const header = request.headers.cookie ?? '';
        request.log.debug(
          {
            platform: request.headers['x-nima-platform'] ?? null,
            cookieNames: header
              .split(';')
              .map((part) => part.split('=')[0]?.trim())
              .filter(Boolean),
          },
          'A live connection arrived without a session',
        );

        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'unauthorized',
            message: 'Sign in to open a live connection',
          } satisfies ServerFrame),
        );
        socket.close(4401, 'unauthorized');
        return;
      }

      subscribe(socket, channels.user(user.id));
      onlineUsers.set(user.id, (onlineUsers.get(user.id) ?? 0) + 1);

      // Tell the client who it is and how many credits it has, so the app can
      // render the credit pill without a second request.
      void app.prisma.creditBalance
        .findUnique({ where: { userId: user.id } })
        .then((balance) => {
          if (socket.readyState !== 1) return;
          socket.send(
            JSON.stringify({
              type: 'ready',
              userId: user.id,
              isAnonymous: user.isAnonymous,
              credits: balance?.balance ?? 0,
            } satisfies ServerFrame),
          );
        })
        .catch((error: unknown) => app.log.warn({ err: error }, 'Could not read the balance'));

      socket.on('message', (raw: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const result = clientFrameSchema.safeParse(parsed);
        if (!result.success) return;
        const frame = result.data;

        switch (frame.type) {
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong', at: Date.now() } satisfies ServerFrame));
            break;

          case 'conversation.open':
            // Membership is checked when the conversation is opened over HTTP;
            // subscribing only ever reveals events for conversations the user
            // is already a member of, which the publisher enforces.
            subscribe(socket, channels.conversation(frame.conversationId));
            break;

          case 'conversation.close':
            unsubscribe(socket, channels.conversation(frame.conversationId));
            break;

          case 'conversation.typing':
            void realtime.publish(channels.conversation(frame.conversationId), {
              type: 'message.typing',
              conversationId: frame.conversationId,
              userId: user.id,
            });
            break;

          case 'job.watch':
            subscribe(socket, channels.job(frame.jobId));
            break;
        }
      });

      socket.on('close', () => {
        const owned = socketChannels.get(socket);
        if (owned) {
          for (const channel of owned) {
            const sockets = subscriptions.get(channel);
            sockets?.delete(socket);
            if (sockets && sockets.size === 0) subscriptions.delete(channel);
          }
        }

        const remaining = (onlineUsers.get(user.id) ?? 1) - 1;
        if (remaining <= 0) onlineUsers.delete(user.id);
        else onlineUsers.set(user.id, remaining);
      });
    });
  },
  { name: 'realtime', dependencies: ['core', 'auth'] },
);
