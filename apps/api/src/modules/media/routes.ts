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

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
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
        querystring: z.object({ t: z.string().max(2000).optional() }),
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

      if (app.env.MEDIA_DELIVERY === 'proxy') {
        let object: Awaited<ReturnType<typeof app.storage.stream>>;
        try {
          object = await app.storage.stream(key);
        } catch (error) {
          if ((error as { name?: string }).name === 'NoSuchKey') {
            throw errors.notFound('That image');
          }
          throw error;
        }

        // A public key never changes under the same name. A private link
        // expires with its token, so it is cached for as long as it lasts.
        reply.header(
          'cache-control',
          isPublic ? 'public, max-age=86400, stale-while-revalidate=604800' : 'private, max-age=3600',
        );
        if (object.contentType) reply.type(object.contentType);
        if (object.contentLength !== null) reply.header('content-length', object.contentLength);
        if (object.etag) reply.header('etag', object.etag);

        return reply.send(object.body);
      }

      const url = await app.storage.presignDownload(key, 60 * 60);

      // A browser may cache the image itself, but not this redirect, because
      // the signature expires.
      reply.header('cache-control', 'private, max-age=0, must-revalidate');
      return reply.redirect(url, 302);
    },
  );
};

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
