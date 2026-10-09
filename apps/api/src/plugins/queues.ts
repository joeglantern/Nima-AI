/**
 * Job queues.
 *
 * The API only ever produces jobs. Consuming happens in apps/worker, which
 * can be restarted, scaled or moved to another machine without touching the
 * API.
 */

import fp from 'fastify-plugin';
import { createQueueConnection, createQueues, type Queues } from '@nima/jobs';

declare module 'fastify' {
  interface FastifyInstance {
    queues: Queues;
  }
}

export default fp(
  async (app) => {
    // A producer connection fails fast rather than blocking a request.
    const connection = createQueueConnection(app.env.REDIS_URL);
    connection.on('error', (error) => app.log.error({ err: error }, 'Queue connection error'));

    const queues = createQueues(connection);
    app.decorate('queues', queues);

    app.addHook('onClose', async () => {
      await queues.close();
      await connection.quit();
    });
  },
  { name: 'queues', dependencies: ['core'] },
);
