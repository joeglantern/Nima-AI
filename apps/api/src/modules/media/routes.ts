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
 *   users/{id}/...            only when it is the cover of a public look,
 *                             or the caller owns it
 *
 * Everything else, in particular users/{id}/photos and users/{id}/tryons,
 * stays unreachable. A try-on is private until its owner shares it, and the
 * brief is explicit that this must never happen by accident.
 *
 * In production the same URLs sit behind a CDN, which caches the redirect
 * target rather than the image itself.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';

const PUBLIC_PREFIXES = ['seed/', 'stores/'];

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/media/*',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['shop'],
        summary: 'Fetch an image',
        description:
          'Redirects to a short lived signed URL. Private media is refused unless the ' +
          'caller owns it or it is part of something published.',
        params: z.object({ '*': z.string().min(1).max(300) }),
        response: {
          302: z.null(),
          404: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
        },
      },
    },
    async (request, reply) => {
      const key = request.params['*'];

      // No traversal, no absolute paths.
      if (key.includes('..') || key.startsWith('/')) throw errors.notFound('That image');

      const isPublicPrefix = PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix));

      if (!isPublicPrefix) {
        const allowed = await canSeePersonalMedia(app, key, request.user?.id ?? null);
        if (!allowed) throw errors.notFound('That image');
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
