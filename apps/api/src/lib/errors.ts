/**
 * Error types and the single error handler.
 *
 * Rules:
 *   - Handlers throw. They never build an error response by hand.
 *   - Every error the client sees has a stable `code` it can switch on.
 *   - Unexpected errors are logged with the stack and returned as a generic
 *     message. Internal detail never reaches the client.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { serveWebApp } from './web-app.js';

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'account_required'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'photo_required'
  | 'provider_unavailable'
  | 'internal_error';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string[]>;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: { fields?: Record<string, string[]>; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = options.fields;
    this.expose = options.expose ?? true;
  }
}

/** Helpers so route code reads as plain English. */
export const errors = {
  badRequest: (message: string, fields?: Record<string, string[]>) =>
    new AppError(400, 'bad_request', message, { fields }),

  /** Not signed in at all. */
  unauthorized: (message = 'Sign in to continue') => new AppError(401, 'unauthorized', message),

  /**
   * Signed in as a guest, but this action needs a real account. The app turns
   * this into the "Create an account to try this look on yourself" sheet, so
   * the message is written to be shown to the user.
   */
  accountRequired: (message = 'Create an account to use this') =>
    new AppError(401, 'account_required', message),

  forbidden: (message = 'You cannot do that') => new AppError(403, 'forbidden', message),
  notFound: (what = 'That') => new AppError(404, 'not_found', `${what} was not found`),
  conflict: (message: string) => new AppError(409, 'conflict', message),
  tooLarge: (message = 'That file is too large') => new AppError(413, 'payload_too_large', message),
  unsupportedMedia: (message = 'That file type is not supported') =>
    new AppError(415, 'unsupported_media_type', message),

  insufficientCredits: (needed: number, balance: number) =>
    new AppError(
      402,
      'insufficient_credits',
      `This needs ${needed} ${needed === 1 ? 'credit' : 'credits'} and you have ${balance}`,
    ),

  photoRequired: () =>
    new AppError(400, 'photo_required', 'Add a photo of yourself before trying something on'),

  providerUnavailable: (message = 'That service is busy, try again shortly') =>
    new AppError(503, 'provider_unavailable', message),

  internal: (message = 'Something went wrong on our side', cause?: unknown) =>
    new AppError(500, 'internal_error', message, { cause, expose: false }),
};

interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    requestId: string;
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    // Anything that is not an API path may be a screen of the web app.
    if (await serveWebApp(request, reply)) return reply;

    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    } satisfies ErrorBody);
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      if (!error.expose) {
        request.log.error({ err: error, requestId }, 'Request failed');
      } else {
        request.log.info({ code: error.code, requestId }, error.message);
      }

      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Something went wrong on our side',
          ...(error.fields ? { fields: error.fields } : {}),
          requestId,
        },
      } satisfies ErrorBody);
    }

    // Request body, params or query failed validation.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields: Record<string, string[]> = {};
      for (const issue of error.validation) {
        const path = issue.instancePath?.replace(/^\//, '').replace(/\//g, '.') || '_';
        const messages = fields[path] ?? [];
        messages.push(issue.message ?? 'Invalid value');
        fields[path] = messages;
      }

      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'Some of that is not quite right',
          fields,
          requestId,
        },
      } satisfies ErrorBody);
    }

    // We built a response that does not match its own schema. Always our bug.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, requestId, route: error.method },
        'Response did not match schema',
      );
      return reply.status(500).send({
        error: { code: 'internal_error', message: 'Something went wrong on our side', requestId },
      } satisfies ErrorBody);
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'rate_limited',
          message: 'Slow down for a moment and try again',
          requestId,
        },
      } satisfies ErrorBody);
    }

    if (statusCode < 500) {
      request.log.info({ err: error, requestId }, 'Client error');
      return reply.status(statusCode).send({
        error: { code: 'bad_request', message: error.message, requestId },
      } satisfies ErrorBody);
    }

    request.log.error({ err: error, requestId }, 'Unhandled error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong on our side', requestId },
    } satisfies ErrorBody);
  });
}
