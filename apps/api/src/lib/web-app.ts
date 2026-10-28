/**
 * The web app, served by the API.
 *
 * The production image carries the exported Expo web build in WEB_DIR. Any
 * GET that is not an API path is answered from there: a real file if one
 * exists, otherwise index.html, because every screen is a client side route.
 *
 * Serving it from the same address as the API keeps the sign in cookie first
 * party and means one public address does everything. It lives in the 404
 * path so it can never shadow an API route.
 */

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const API_PREFIXES = ['/v1/', '/api/', '/ws', '/health', '/docs', '/webhooks/'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const root = process.env.WEB_DIR ? normalize(process.env.WEB_DIR) : null;

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Answers the request from the web build. False when it is not ours to answer. */
export async function serveWebApp(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!root) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const path = decodeURIComponent((request.url.split('?')[0] ?? '/').replace(/\/+/g, '/'));
  if (API_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  // Never outside the build folder, whatever the path says.
  const candidate = normalize(join(root, path));
  const inside = candidate === root || candidate.startsWith(root + sep);

  let file = inside && path !== '/' && (await isFile(candidate)) ? candidate : null;
  const isAsset = file !== null;

  if (!file) {
    // A missing file with an extension is a missing file, not a screen.
    if (extname(path) && extname(path) !== '.html') return false;
    file = join(root, 'index.html');
    if (!(await isFile(file))) return false;
  }

  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  reply.header('content-type', type);

  // Bundles and fonts are named by their content, so they never change.
  // The page itself must always be fresh, or a deploy is invisible.
  if (isAsset && path.startsWith('/_expo/')) {
    reply.header('cache-control', 'public, max-age=31536000, immutable');
  } else if (isAsset && !file.endsWith('.html')) {
    reply.header('cache-control', 'public, max-age=3600');
  } else {
    reply.header('cache-control', 'no-cache');
  }

  reply.status(200);

  // The page names its own address in its link preview tags, and that
  // address is whatever the visitor used, which changes with the tunnel.
  if (file.endsWith('index.html')) {
    const origin = `${request.protocol}://${request.host}`;
    const html = (await readFile(file, 'utf8')).replaceAll('__ORIGIN__', origin);
    return Boolean(reply.send(request.method === 'HEAD' ? undefined : html));
  }

  if (request.method === 'HEAD') {
    reply.send();
    return true;
  }
  reply.send(createReadStream(file));
  return true;
}
