/**
 * Serving images.
 *
 * Storage is private. Nothing in the bucket is world readable, because the
 * same bucket holds product photography and photographs of people.
 *
 * This route is the one public door, and it only opens for keys that are
 * genuinely public:
 *
 *   seed/...                  development placeholders
 *   stores/{id}/...           product and shop imagery, published by sellers
 *   users/{id}/avatar/...     the picture next to someone's name
 *   users/{id}/...            only when it is the cover of a public look,
 *                             the caller owns it, or the link carries a
 *                             signed claim for exactly that key
 *
 * Everything else, in particular users/{id}/photos and users/{id}/tryons,
 * stays unreachable. A try-on is private until its owner shares it, and the
 * brief is explicit that this must never happen by accident.
 *
 * How the bytes arrive depends on MEDIA_DELIVERY. `redirect` sends the
 * caller to a short lived presigned bucket URL, which a CDN can sit in
 * front of. `proxy` streams the object through the API, for a server whose
 * bucket listens on loopback and cannot be reached any other way.
 */

import { buffer } from 'node:stream/consumers';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import sharp from 'sharp';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { verifyMediaToken } from '../../lib/media-token.js';

const PUBLIC_PREFIXES = ['seed/', 'stores/'];
const AVATAR = /^users\/[^/]+\/avatar\//;

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/media/*',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['shop'],
        summary: 'Fetch an image',
        description:
          'Redirects to a short lived signed URL, or serves the bytes, depending on how the ' +
          'server is set up. Private media is refused unless the caller owns it, it is part ' +
          'of something published, or the link was issued for it.',
        params: z.object({ '*': z.string().min(1).max(300) }),
        querystring: z.object({
          t: z.string().max(2000).optional(),
          /** A copy no wider than this: 240, 480, 720 or 1080. */
          w: z.coerce.number().int().optional(),
        }),
        response: {
          // The bytes themselves, in proxy mode. Streams bypass the
          // serialiser, so this only describes the route.
          200: z.unknown().describe('The image'),
          302: z.null(),
          404: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
        },
      },
    },
    async (request, reply) => {
      const key = request.params['*'];

      // No traversal, no absolute paths.
      if (key.includes('..') || key.startsWith('/')) throw errors.notFound('That image');

      const isPublic = PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix)) || AVATAR.test(key);

      if (!isPublic) {
        const claim = request.query.t
          ? verifyMediaToken(app.env.BETTER_AUTH_SECRET, request.query.t)
          : null;
        const issuedForThis = claim !== null && claim.u === 'dl' && claim.k === key;

        if (!issuedForThis) {
          const allowed = await canSeePersonalMedia(app, key, request.user?.id ?? null);
          if (!allowed) throw errors.notFound('That image');
        }
      }

      // A public key never changes under the same name. A private link
      // expires with its token, so it is cached for as long as it lasts.
      const cacheControl = isPublic
        ? 'public, max-age=86400, stale-while-revalidate=604800'
        : 'private, max-age=3600';

      // A sized copy, made once from the original and kept beside it. A
      // phone on costly data should not download a 1080 pixel photo to
      // show it at 180.
      const width = request.query.w;
      const resizable = width !== undefined && SIZES.has(width) && /\.(jpe?g|png|webp)$/i.test(key);
      const served = resizable ? derivedKey(key, width) : key;

      if (app.env.MEDIA_DELIVERY === 'proxy') {
        let object: Awaited<ReturnType<typeof app.storage.stream>>;
        try {
          object = await app.storage.stream(served);
        } catch (error) {
          if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
          if (!resizable) throw errors.notFound('That image');
          // The first request for this size makes it.
          const made = await makeDerived(app, key, served, width);
          reply.header('cache-control', cacheControl);
          reply.type('image/webp');
          return reply.send(made);
        }

        reply.header('cache-control', cacheControl);
        if (object.contentType) reply.type(object.contentType);
        if (object.contentLength !== null) reply.header('content-length', object.contentLength);
        if (object.etag) reply.header('etag', object.etag);

        return reply.send(object.body);
      }

      if (resizable) {
        try {
          const probe = await app.storage.stream(served);
          probe.body.destroy();
        } catch (error) {
          if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
          await makeDerived(app, key, served, width);
        }
      }

      const url = await app.storage.presignDownload(served, 60 * 60);

      // A browser may cache the image itself, but not this redirect, because
      // the signature expires.
      reply.header('cache-control', 'private, max-age=0, must-revalidate');
      return reply.redirect(url, 302);
    },
  );
};

const SIZES = new Set([240, 480, 720, 1080]);

/** Where the sized copy of a key lives. Always WebP, whatever the original. */
function derivedKey(key: string, width: number): string {
  return `derived/w${width}/${key.replace(/\.[^./]+$/, '')}.webp`;
}

/** Makes the sized copy from the original, keeps it, and returns its bytes. */
async function makeDerived(
  app: Parameters<FastifyPluginAsyncZod>[0],
  key: string,
  target: string,
  width: number,
): Promise<Buffer> {
  let original: Awaited<ReturnType<typeof app.storage.stream>>;
  try {
    original = await app.storage.stream(key);
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchKey') throw errors.notFound('That image');
    throw error;
  }

  const input = await buffer(original.body);
  const made = await sharp(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  // Kept for next time. A failure to keep it is not a failure to serve it.
  await app.storage.put(target, made, 'image/webp').catch((error: unknown) => {
    app.log.warn({ err: error, target }, 'Could not keep a sized image');
  });

  return made;
}

/**
 * Media under a person's own prefix. Visible when they are the owner, or
 * when it has been published as part of a public look.
 */
async function canSeePersonalMedia(
  app: Parameters<FastifyPluginAsyncZod>[0],
  key: string,
  viewerId: string | null,
): Promise<boolean> {
  const ownerId = key.startsWith('users/') ? key.split('/')[1] : null;
  if (!ownerId) return false;

  if (viewerId && viewerId === ownerId) return true;

  const look = await app.prisma.look.findFirst({
    where: { coverKey: key, visibility: 'PUBLIC', publishedAt: { not: null } },
    select: { id: true },
  });

  return look !== null;
}
