/**
 * Auth plugin: mounts Better Auth and exposes the session to routes.
 *
 * Three guards, used as `preHandler` on routes:
 *
 *   app.requireSession   signed in, guest accounts allowed
 *   app.requireAccount   a real account, not a guest  -> 401 account_required
 *   app.requireAdmin     staff only
 *
 * Identity comes from the session cookie or bearer token and nothing else.
 * The previous codebase trusted an email sent by the client, which let any
 * signed in user take over any account. See docs/DECISIONS.md.
 */

import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { type Auth, createAuth } from '../auth/auth.js';
import { withMailOutcome } from '../auth/mail-outcome.js';
import { errors } from '../lib/errors.js';

export interface RequestUser {
  id: string;
  email: string | null;
  name: string;
  isAnonymous: boolean;
  role: 'USER' | 'ADMIN' | 'SUPPORT';
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
    requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Null for a visitor with no session at all. */
    user: RequestUser | null;
    /** Throws 401 instead of returning null. Use inside guarded routes. */
    requireUser: () => RequestUser;
  }
}

export default fp(
  async (app) => {
    const auth = createAuth({ env: app.env, prisma: app.prisma, mailer: app.mailer });
    app.decorate('auth', auth);

    app.decorateRequest('user', null);
    app.decorateRequest('requireUser', function (this: FastifyRequest) {
      if (!this.user) throw errors.unauthorized();
      return this.user;
    });

    /**
     * Better Auth speaks the web Request and Response API. Fastify speaks
     * Node streams, so the handler converts between the two.
     *
     * The body is forwarded as a raw buffer rather than re-serialised JSON,
     * which keeps form encoded OAuth callbacks working.
     */
    app.route({
      method: ['GET', 'POST', 'OPTIONS'],
      url: '/api/auth/*',
      config: { rawBody: true },
      schema: { hide: true },
      async handler(request, reply) {
        const url = new URL(request.url, app.env.BETTER_AUTH_URL);
        const headers = fromNodeHeaders(request.raw.headers);

        const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
        const body =
          hasBody && request.body !== undefined
            ? typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body)
            : undefined;

        const { response, mail } = await withMailOutcome(async (outcome) => ({
          response: await auth.handler(
            new Request(url.toString(), {
              method: request.method,
              headers,
              ...(body !== undefined ? { body } : {}),
            }),
          ),
          mail: outcome,
        }));

        /*
         * Do not report success for a code that was never sent.
         *
         * Better Auth catches and logs anything thrown while sending and
         * answers `{ success: true }` either way. For a sign in code that
         * is the difference between somebody retrying and somebody giving
         * up on the app, so a failed send becomes a failed request.
         */
        if (mail.failure && response.status < 400) {
          request.log.error(
            { path: url.pathname, reason: mail.failure },
            'An email failed to send, so the request is being failed',
          );

          return reply.status(502).send({
            error: {
              code: 'email_not_sent',
              message: 'We could not send that email. Try again in a moment.',
              requestId: request.id,
            },
          });
        }

        reply.status(response.status);
        response.headers.forEach((value, key) => {
          // set-cookie must not be collapsed into one header.
          if (key.toLowerCase() === 'set-cookie') {
            reply.header('set-cookie', value);
          } else {
            reply.header(key, value);
          }
        });

        const text = await response.text();
        return reply.send(text.length > 0 ? text : null);
      },
    });

    /**
     * Resolve the session for every request. Routes that do not need a user
     * simply see `request.user === null`, which is how guest browsing works.
     */
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api/auth/')) return;

      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.raw.headers),
        });

        if (session?.user) {
          request.user = {
            id: session.user.id,
            email: session.user.email ?? null,
            name: session.user.name,
            isAnonymous: Boolean((session.user as { isAnonymous?: boolean }).isAnonymous),
            role: ((session.user as { role?: string }).role ?? 'USER') as RequestUser['role'],
          };
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Could not read the session');
      }
    });

    app.decorate('requireSession', async (request: FastifyRequest) => {
      if (!request.user) throw errors.unauthorized();
    });

    app.decorate('requireAccount', async (request: FastifyRequest) => {
      if (!request.user) throw errors.unauthorized();
      if (request.user.isAnonymous) throw errors.accountRequired();
    });

    app.decorate('requireAdmin', async (request: FastifyRequest) => {
      if (!request.user) throw errors.unauthorized();
      if (request.user.role !== 'ADMIN') throw errors.forbidden('Staff only');
    });
  },
  { name: 'auth', dependencies: ['core'] },
);
