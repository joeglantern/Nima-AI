/**
 * WebSocket protocol.
 *
 * One socket per signed in device, at GET /ws. The server pushes; the client
 * sends only small control frames (ping, subscribe to a thread, typing).
 *
 * Every frame is a JSON object with a `type` field. Both sides validate with
 * these schemas, so a malformed frame is a clear error rather than a crash.
 */

import { z } from 'zod';
import { idSchema } from './common.js';

// ------------------------------------------------------------- client to server

export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  /** Join a conversation so typing indicators and read receipts flow. */
  z.object({ type: z.literal('conversation.open'), conversationId: idSchema }),
  z.object({ type: z.literal('conversation.close'), conversationId: idSchema }),
  z.object({ type: z.literal('conversation.typing'), conversationId: idSchema }),
  /** Follow a specific AI job, for a progress bar on one screen. */
  z.object({ type: z.literal('job.watch'), jobId: idSchema }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

// ------------------------------------------------------------- server to client

export const jobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']);

export const serverFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), at: z.number() }),

  /** Sent once, immediately after the socket is authenticated. */
  z.object({
    type: z.literal('ready'),
    userId: idSchema,
    isAnonymous: z.boolean(),
    credits: z.number().int(),
  }),

  // Try-on and other AI jobs
  z.object({
    type: z.literal('tryon.queued'),
    jobId: idSchema,
    position: z.number().int().min(0),
    estimatedSeconds: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('tryon.progress'),
    jobId: idSchema,
    status: jobStatusSchema,
    /** 0 to 100, best effort. The provider does not stream real progress. */
    percent: z.number().int().min(0).max(100),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('tryon.done'),
    jobId: idSchema,
    lookId: idSchema.nullable(),
    imageUrl: z.url(),
    creditsCharged: z.number().int(),
    creditsRemaining: z.number().int(),
  }),
  z.object({
    type: z.literal('tryon.failed'),
    jobId: idSchema,
    reason: z.string(),
    creditsRefunded: z.number().int(),
  }),

  // Ask Nima streaming
  z.object({ type: z.literal('stylist.delta'), threadId: idSchema, text: z.string() }),
  z.object({
    type: z.literal('stylist.tool'),
    threadId: idSchema,
    tool: z.string(),
    note: z.string(),
  }),
  z.object({
    type: z.literal('stylist.done'),
    threadId: idSchema,
    messageId: idSchema,
  }),

  // Messaging
  z.object({
    type: z.literal('message.new'),
    conversationId: idSchema,
    messageId: idSchema,
    senderId: idSchema,
    preview: z.string(),
  }),
  z.object({
    type: z.literal('message.read'),
    conversationId: idSchema,
    userId: idSchema,
    at: z.number(),
  }),
  z.object({
    type: z.literal('message.typing'),
    conversationId: idSchema,
    userId: idSchema,
  }),

  // Commerce
  z.object({
    type: z.literal('payment.status'),
    checkoutId: idSchema,
    status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('order.updated'),
    orderId: idSchema,
    status: z.string(),
  }),
  z.object({
    type: z.literal('shipment.updated'),
    orderId: idSchema,
    status: z.string(),
    trackingCode: z.string().nullable(),
  }),

  // Everything else
  z.object({
    type: z.literal('credits.updated'),
    balance: z.number().int(),
  }),
  z.object({
    type: z.literal('notification.new'),
    id: idSchema,
    kind: z.string(),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;
export type ServerFrameType = ServerFrame['type'];

/** Channel names used with Valkey pub/sub. Keep them in one place. */
export const channels = {
  user: (userId: string) => `user:${userId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  job: (jobId: string) => `job:${jobId}`,
} as const;
