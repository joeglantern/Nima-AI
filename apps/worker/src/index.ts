/**
 * Worker process.
 *
 * Runs every queue in one process for now. Splitting the try-on worker onto
 * its own machine later is a matter of starting this file with a different
 * set of workers, which is why each one is a separate function.
 */

import type { Worker } from 'bullmq';
import closeWithGrace from 'close-with-grace';
import { createContext } from './context.js';
import { createGeminiProvider } from './providers/gemini.js';
import { startMediaWorker } from './workers/media.js';
import { startNotificationWorker } from './workers/notification.js';
import { startTryOnWorker } from './workers/tryon.js';

async function main(): Promise<void> {
  const context = createContext();
  const workers: Worker[] = [];

  workers.push(startMediaWorker(context));
  workers.push(startNotificationWorker(context));

  // Without a key the other queues still run, so uploads and notifications
  // keep working while image generation is switched off.
  if (context.env.GEMINI_API_KEY) {
    workers.push(startTryOnWorker(context, createGeminiProvider(context.env)));
  } else {
    context.log.warn(
      'GEMINI_API_KEY is not set, so try-on jobs will queue up and wait. Set it to enable images.',
    );
  }

  context.log.info({ workers: workers.length }, 'Nima worker is running');

  closeWithGrace({ delay: 15_000 }, async ({ signal, err }) => {
    if (err) context.log.error({ err }, 'Shutting down after an error');
    else context.log.info({ signal }, 'Shutting down, finishing jobs in flight');

    // close() waits for the active job to finish before returning.
    await Promise.all(workers.map((worker) => worker.close()));
    await context.close();
  });
}

main().catch((error: unknown) => {
  console.error('The worker failed to start:', error);
  process.exit(1);
});
