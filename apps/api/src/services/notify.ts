/**
 * Telling someone something happened.
 */

import type { FastifyInstance } from 'fastify';

/**
 * Hands the notification to the worker, which writes the row, tells any
 * open app over the socket, and pushes to the phone when the app is shut.
 */
export async function notify(
  app: FastifyInstance,
  data: {
    userId: string;
    type: 'NEW_FOLLOWER' | 'LOOK_LIKED' | 'LOOK_COMMENT' | 'ORDER_PLACED' | 'ORDER_UPDATE';
    title: string;
    body: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await app.queues.notification.add('notify', { ...data, skipPushIfOnline: true });
  } catch (error) {
    // Losing a "someone loved your look" is better than failing the love.
    app.log.warn({ err: error }, 'Could not queue a notification');
  }
}
