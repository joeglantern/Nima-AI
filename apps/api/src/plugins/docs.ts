/**
 * OpenAPI documentation.
 *
 * The spec is generated from the same Zod schemas the routes validate with,
 * so it cannot drift. The mobile and web clients are generated from it.
 *
 * Browsable at /docs. In production it is behind an admin check, because the
 * spec describes seller and admin endpoints too.
 */

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Nima API',
          version: '0.1.0',
          description: [
            'The Nima backend.',
            '',
            'Conventions:',
            '- Money is an integer number of KES cents.',
            '- Lists are cursor paginated: pass the `nextCursor` you were given.',
            '- Errors share one shape: `{ error: { code, message, fields?, requestId } }`.',
            '- `401 account_required` means the caller is browsing as a guest and',
            '  the action needs a real account. The app shows the sign up sheet.',
            '- Long running AI work returns a job. The result arrives on the',
            '  WebSocket at `/ws`.',
          ].join('\n'),
        },
        servers: [{ url: app.env.API_URL }],
        tags: [
          { name: 'health', description: 'Service checks' },
          { name: 'session', description: 'Who am I, credits, settings' },
          { name: 'profile', description: 'Profile, style questionnaire, photos' },
          { name: 'feed', description: 'For You and Explore' },
          { name: 'looks', description: 'Looks, saves, likes, comments' },
          { name: 'wardrobe', description: "The user's own clothes" },
          { name: 'lookbooks', description: 'Collections of outfits' },
          { name: 'shop', description: 'Products, search, stores' },
          { name: 'tryon', description: 'Virtual try-on' },
          { name: 'stylist', description: 'Ask Nima' },
          { name: 'credits', description: 'Credit balance, packs, history' },
          { name: 'social', description: 'Follows, blocks, messages' },
          { name: 'cart', description: 'Cart and checkout' },
          { name: 'orders', description: 'Orders and delivery' },
          { name: 'seller', description: 'Store management and analytics' },
          { name: 'admin', description: 'Staff only' },
        ],
        components: {
          securitySchemes: {
            session: {
              type: 'apiKey',
              in: 'cookie',
              name: 'nima.session_token',
              description: 'Session cookie set by /api/auth. Mobile sends a bearer token instead.',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
      ...(app.env.NODE_ENV === 'production' ? { uiHooks: { onRequest: app.requireAdmin } } : {}),
    });
  },
  { name: 'docs', dependencies: ['core', 'auth'] },
);
