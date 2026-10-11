/**
 * Environment configuration.
 *
 * Every process (api, worker, scripts) calls loadEnv() once at startup. A
 * missing or malformed variable stops the process immediately with a list of
 * what is wrong, instead of failing hours later inside a request.
 *
 * Secrets are never logged. The redactedEnv() helper returns a copy safe to
 * print at boot.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Find the nearest .env by walking up from the working directory.
 *
 * Each app runs from its own folder (apps/api, apps/worker) but the
 * configuration is shared and lives at the repository root, so a plain
 * dotenv call would find nothing.
 */
function findEnvFile(startDir: string = process.cwd()): string | undefined {
  let current = resolve(startDir);

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean),
);

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z.object({
  // runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  API_URL: z.url(),
  // Zod 4 applies defaults to the parsed output, so this is already a list.
  WEB_ORIGINS: csv.default(['http://localhost:8081']),

  // storage
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('garage'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).default('nima-media'),
  S3_PUBLIC_URL: z.url(),
  /**
   * Where callers reach the bucket, when that is not where the API does.
   * In production the API talks to `garage:3900` on the Docker network,
   * which means nothing to a phone, and the host is part of a signed URL.
   * Set it and download and upload URLs are signed for this address.
   */
  S3_PRESIGN_ENDPOINT: z.url().optional(),
  /**
   * `redirect`: media links send the caller to a presigned bucket URL, which
   * needs the bucket to be reachable from outside. `proxy`: the API serves
   * the bytes and takes uploads itself, for a server whose bucket is not.
   */
  MEDIA_DELIVERY: z.enum(['redirect', 'proxy']).default('redirect'),

  // auth
  BETTER_AUTH_SECRET: z.string().min(32, 'Use at least 32 characters: openssl rand -base64 32'),
  BETTER_AUTH_URL: z.url(),
  /**
   * Accept sign ins from Expo Go, whose origin is an exp:// address. Always
   * on in development. On a server, only while a build from Expo Go is being
   * tested against it; a store build signs in as nima://.
   */
  TRUST_EXPO_GO: bool.default(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),

  // email
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1060),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  EMAIL_FROM: z.string().default('Nima <hello@nima.app>'),

  // ai
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  GEMINI_IMAGE_MODEL_FAST: z.string().default('gemini-3.1-flash-lite-image'),
  LLM_BASE_URL: z.url().default('http://localhost:8080/v1'),
  LLM_MODEL: z.string().default('qwen3'),
  LLM_API_KEY: z.string().default('not-needed-for-local'),

  // payments and logistics
  FINGO_API_KEY: z.string().optional(),
  FINGO_WEBHOOK_SECRET: z.string().optional(),
  FINGO_BASE_URL: z.url().default('https://api.fingopay.io'),
  PICKUP_MTAANI_API_KEY: z.string().optional(),
  PICKUP_MTAANI_BASE_URL: z.url().default('https://api.pickupmtaani.com'),

  // limits
  FREE_WEEKLY_CREDITS: z.coerce.number().int().min(0).default(5),
  MAX_CONCURRENT_AI_JOBS: z.coerce.number().int().min(1).default(3),
});

export type Env = z.infer<typeof envSchema>;

const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_SECRET',
  'SMTP_PASSWORD',
  'GEMINI_API_KEY',
  'LLM_API_KEY',
  'FINGO_API_KEY',
  'FINGO_WEBHOOK_SECRET',
  'PICKUP_MTAANI_API_KEY',
] as const satisfies readonly (keyof Env)[];

let cached: Env | null = null;

export interface LoadEnvOptions {
  /** Path to a .env file. Defaults to the nearest one, walking up from cwd. */
  path?: string;
  /** Read from this object instead of process.env. Used by tests. */
  source?: NodeJS.ProcessEnv;
  /** Ignore the cache. Used by tests. */
  reload?: boolean;
}

export function loadEnv(options: LoadEnvOptions = {}): Env {
  if (cached && !options.reload) return cached;

  if (!options.source) {
    const path = options.path ?? findEnvFile();
    if (path) loadDotenv({ path, quiet: true });
  }

  const result = envSchema.safeParse(options.source ?? process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Environment is not valid. Fix these and start again:\n${issues}\n\n` +
        'See .env.example for the full list.',
    );
  }

  cached = result.data;
  return cached;
}

/** A copy with every secret masked, safe to log at boot. */
export function redactedEnv(env: Env): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...env };
  for (const key of SECRET_KEYS) {
    if (copy[key]) copy[key] = '***';
  }
  return copy;
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

export function isTest(env: Env): boolean {
  return env.NODE_ENV === 'test';
}
