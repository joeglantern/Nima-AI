/**
 * Prisma CLI configuration.
 *
 * Configuration lives in one .env at the repository root, so the CLI is
 * pointed at it here rather than keeping a second copy next to the schema.
 * This also replaces the deprecated `prisma` block in package.json.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(here, '..', '..', '.env'), quiet: true });

export default {
  schema: join(here, 'prisma', 'schema.prisma'),
  migrations: {
    path: join(here, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
};
