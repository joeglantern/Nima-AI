/**
 * Database access for every Nima service.
 *
 * One PrismaClient per process. Importing this module twice inside the same
 * process reuses the same client, which matters in development where the
 * watcher reloads modules often and would otherwise exhaust the connection
 * pool.
 */

import { PrismaClient } from '../generated/client/index.js';

export * from '../generated/client/index.js';
export { Prisma } from '../generated/client/index.js';

export type LogLevel = 'query' | 'info' | 'warn' | 'error';

export interface CreateClientOptions {
  databaseUrl?: string;
  log?: LogLevel[];
}

declare global {
  // eslint-disable-next-line no-var
  var __nimaPrisma: PrismaClient | undefined;
}

export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  const client = new PrismaClient({
    log: options.log ?? ['warn', 'error'],
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
  });

  return client;
}

/**
 * Shared client. Prefer injecting this through the Fastify instance
 * (`app.prisma`) in request handlers; use the export directly in scripts,
 * workers and tests.
 */
export const prisma: PrismaClient = globalThis.__nimaPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__nimaPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Quick liveness probe used by the health endpoint and by the worker before
 * it starts consuming jobs.
 */
export async function pingDatabase(client: PrismaClient = prisma): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
