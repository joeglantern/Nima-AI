/**
 * Notifications.
 *
 * Writes the row, then sends a push only if the person is not already
 * looking at the app. Expo's push service is free and wraps both Apple and
 * Google, so there is no vendor to pay here.
 */

import { createWorkerConnection, type NotificationJobData, QUEUE } from '@nima/jobs';
import { type Job, Worker } from 'bullmq';
import type { WorkerContext } from '../context.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export function startNotificationWorker(context: WorkerContext): Worker<NotificationJobData> {
  const connection = createWorkerConnection(context.env.REDIS_URL);

  const worker = new Worker<NotificationJobData>(
    QUEUE.notification,
    async (job: Job<NotificationJobData>) => {
      const data = job.data;

      const notification = await context.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type as never,
          title: data.title,
          body: data.body,
          data: (data.data ?? {}) as never,
        },
      });

      await context.publishToUser(data.userId, {
        type: 'notification.new',
        id: notification.id,
        kind: data.type,
        title: data.title,
        body: data.body,
      });

      const tokens = await context.prisma.pushToken.findMany({
        where: { userId: data.userId },
        select: { token: true, id: true },
      });

      if (tokens.length === 0) return { pushed: 0 };

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(
          tokens.map((row) => ({
            to: row.token,
            title: data.title,
            body: data.body,
            data: data.data ?? {},
            sound: 'default',
            channelId: 'default',
          })),
        ),
      });

      if (!response.ok) {
        throw new Error(`Expo push returned ${response.status}`);
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };

      // Expo tells us when a token is dead. Removing it keeps the table from
      // filling with devices that were uninstalled months ago.
      payload.data?.forEach(async (ticket, index) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const dead = tokens[index];
          if (dead) {
            await context.prisma.pushToken.delete({ where: { id: dead.id } }).catch(() => {});
          }
        }
      });

      return { pushed: tokens.length };
    },
    { connection, concurrency: 10 },
  );

  worker.on('ready', () => context.log.info('Notification worker ready'));
  worker.on('failed', (job, error) =>
    context.log.warn({ err: error, userId: job?.data.userId }, 'Notification failed'),
  );

  return worker;
}
