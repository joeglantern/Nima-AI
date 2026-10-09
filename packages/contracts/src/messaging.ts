/**
 * Direct messages and notifications.
 *
 * Messages carry either text or a shared card (look, product, try-on,
 * lookbook). A shared look keeps a snapshot so the card still renders if the
 * original is deleted or made private.
 */

import { z } from 'zod';
import { idSchema, imageSchema, paginationQuerySchema } from './common.js';

export const messageKindSchema = z.enum(['TEXT', 'LOOK', 'PRODUCT', 'TRY_ON', 'LOOKBOOK', 'SYSTEM']);

export const conversationPeerSchema = z.object({
  id: idSchema,
  handle: z.string(),
  displayName: z.string(),
  avatar: imageSchema.nullable(),
});

export const conversationSchema = z.object({
  id: idSchema,
  isGroup: z.boolean(),
  title: z.string().nullable(),
  peers: z.array(conversationPeerSchema),
  lastMessage: z
    .object({
      kind: messageKindSchema,
      preview: z.string(),
      senderId: idSchema,
      createdAt: z.string(),
    })
    .nullable(),
  unreadCount: z.number().int(),
  updatedAt: z.string(),
});

export const messageSchema = z.object({
  id: idSchema,
  kind: messageKindSchema,
  body: z.string().nullable(),
  senderId: idSchema,
  mine: z.boolean(),
  /** Rendered card for shared content. */
  card: z
    .object({
      refId: idSchema,
      title: z.string().nullable(),
      subtitle: z.string().nullable(),
      image: imageSchema.nullable(),
      /** True when the recipient can open and try this on themselves. */
      actionable: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
});

export const startConversationSchema = z.object({
  userIds: z.array(idSchema).min(1).max(20),
  title: z.string().max(60).optional(),
});

export const sendMessageSchema = z
  .object({
    kind: messageKindSchema.default('TEXT'),
    body: z.string().max(2000).optional(),
    refId: idSchema.optional(),
  })
  .refine((value) => (value.kind === 'TEXT' ? Boolean(value.body?.trim()) : Boolean(value.refId)), {
    message: 'Text messages need a body, shared cards need a refId',
  });

export const conversationListQuerySchema = paginationQuerySchema;

export const messageListQuerySchema = paginationQuerySchema.extend({
  /** Messages are read newest first, then scrolled backwards. */
  before: z.string().optional(),
});

// ---------------------------------------------------------- notifications ---

export const notificationSchema = z.object({
  id: idSchema,
  type: z.enum([
    'TRY_ON_READY',
    'LOOK_READY',
    'LOW_CREDITS',
    'NEW_FOLLOWER',
    'LOOK_LIKED',
    'LOOK_COMMENT',
    'MESSAGE',
    'ORDER_PLACED',
    'ORDER_UPDATE',
    'PAYOUT_SENT',
    'SYSTEM',
  ]),
  title: z.string(),
  body: z.string(),
  /** Deep link target inside the app, for example look/abc123. */
  target: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});

export const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  deviceName: z.string().max(80).optional(),
});
