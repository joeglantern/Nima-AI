/**
 * Process entry point.
 *
 * Boots the app, listens, and shuts down cleanly when the platform asks it
 * to. A clean shutdown matters: in flight requests finish, the WebSocket
 * clients are told to reconnect, and the database pool closes rather than
 * leaving sessions behind.
 */

import closeWithGrace from 'close-with-grace';
import { loadEnv, redactedEnv } from '@nima/config';
import { pingDatabase } from '@nima/db';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });

  if (env.NODE_ENV === 'development') {
    app.log.debug({ env: redactedEnv(env) }, 'Configuration');
  }

  const databaseReachable = await pingDatabase(app.prisma);
  if (!databaseReachable) {
    app.log.error('Cannot reach the database. Is the dev stack running? pnpm stack:up');
    process.exit(1);
  }

  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) app.log.error({ err }, 'Shutting down after an error');
    else app.log.info({ signal }, 'Shutting down');
    await app.close();
  });

  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  app.log.info(
    { docs: `${env.API_URL}/docs`, websocket: `${env.API_URL.replace('http', 'ws')}/ws` },
    'Nima API is ready',
  );
}

main().catch((error: unknown) => {
  // The logger may not exist yet, so this one case writes to stderr directly.
  console.error('The API failed to start:', error);
  process.exit(1);
});
