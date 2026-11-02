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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicImage } from './presenters.js';

/**
 * What a shared link shows before anyone taps it.
 *
 * WhatsApp, which is how links move here, reads the page's title, description
 * and image from the HTML it is given, without running any JavaScript. So for
 * a look, a piece or a shop, those tags carry the real thing rather than the
 * app's general line.
 */
interface SocialCard {
  title: string;
  description: string;
  image: string | null;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const firstLine = (value: string | null | undefined) =>
  value?.split('\n').map((line) => line.trim()).find(Boolean) ?? null;

async function socialCardFor(app: FastifyInstance, path: string): Promise<SocialCard | null> {
  try {
    const look = path.match(/^\/look\/([A-Za-z0-9_-]{5,40})\/?$/);
    if (look) {
      const row = await app.prisma.look.findFirst({
        where: { id: look[1], visibility: 'PUBLIC' },
        select: { title: true, caption: true, nimaSays: true, coverKey: true, width: true, height: true },
      });
      if (!row) return null;
      return {
        title: row.title ?? 'A look on Nima',
        description: firstLine(row.caption) ?? row.nimaSays ?? 'See yourself in every outfit.',
        image: publicImage(app.storage, row.coverKey, row.width, row.height)?.url ?? null,
      };
    }

    const product = path.match(/^\/product\/([A-Za-z0-9_-]{5,40})\/?$/);
    if (product) {
      const row = await app.prisma.product.findFirst({
        where: { id: product[1], status: 'ACTIVE' },
        select: {
          title: true,
          priceFromCents: true,
          store: { select: { name: true } },
          images: { take: 1, orderBy: { position: 'asc' }, select: { processedKey: true, originalKey: true, width: true, height: true } },
        },
      });
      if (!row) return null;
      const picture = row.images[0];
      return {
        title: row.title,
        description: `KSh ${Math.round(row.priceFromCents / 100).toLocaleString('en-KE')}, from ${row.store.name} on Nima.`,
        image: picture ? (publicImage(app.storage, picture.processedKey ?? picture.originalKey, picture.width, picture.height)?.url ?? null) : null,
      };
    }

    const shop = path.match(/^\/s\/([a-z0-9-]{2,80})\/?$/);
    if (shop) {
      const row = await app.prisma.store.findUnique({
        where: { slug: shop[1] },
        select: { name: true, about: true },
      });
      if (!row) return null;
      return { title: row.name, description: firstLine(row.about) ?? 'A shop on Nima.', image: null };
    }
  } catch (error) {
    app.log.warn({ err: error, path }, 'Could not build the link preview; serving the default');
  }
  return null;
}

/** Puts the card into the page's head, in place of the general tags. */
function withSocialCard(html: string, card: SocialCard): string {
  const title = escapeHtml(`${card.title}, Nima`);
  const description = escapeHtml(card.description);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);
  if (card.image) {
    out = out
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escapeHtml(card.image)}$2`)
      .replace(/\s*<meta property="og:image:(?:width|height)" content="[^"]*" \/>/g, '');
  }
  return out;
}

const API_PREFIXES = ['/v1/', '/api/', '/ws', '/health', '/docs', '/webhooks/'];

/**
 * Nobody may put Nima inside a frame, which is how clickjacking works. The rest
 * of the policy starts in report only mode, so a mistake shows in the browser
 * console rather than breaking checkout. Enforce it once it has run clean.
 */
const FRAME_POLICY = "frame-ancestors 'none'";
const REPORT_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
    reply.header('content-security-policy', FRAME_POLICY);
    reply.header('content-security-policy-report-only', REPORT_POLICY);
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), payment=(self)');
  }

  reply.status(200);

  // The page names its own address in its link preview tags, and that
  // address is whatever the visitor used, which changes with the tunnel.
  if (file.endsWith('index.html')) {
    const origin = `${request.protocol}://${request.host}`;
    let html = (await readFile(file, 'utf8')).replaceAll('__ORIGIN__', origin);
    const card = await socialCardFor(request.server, path);
    if (card) html = withSocialCard(html, card);
    return Boolean(reply.send(request.method === 'HEAD' ? undefined : html));
  }

  if (request.method === 'HEAD') {
    reply.send();
    return true;
  }
  reply.send(createReadStream(file));
  return true;
}
