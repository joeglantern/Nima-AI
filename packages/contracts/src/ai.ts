/**
 * Try-on, Ask Nima and credits.
 *
 * Every AI request follows the same contract: the API charges credits and
 * returns a job, then the result arrives over the WebSocket. Nothing blocks
 * an HTTP request on an image model.
 */

import { z } from 'zod';
import { productCardSchema } from './catalog.js';
import { garmentSlotSchema, idSchema, imageSchema, paginationQuerySchema } from './common.js';
import { jobStatusSchema } from './events.js';
import { lookCardSchema } from './looks.js';

export const tryOnKindSchema = z.enum([
  'SINGLE_ITEM',
  'OUTFIT',
  'QUICK',
  'RECREATE',
  'ACCESSORY',
  'ONBOARDING',
  'SELLER_LINK',
]);

/**
 * Start a try-on.
 *
 * One of these shapes is used:
 *   - items: catalogue products or wardrobe items on the user's saved photo
 *   - sourceKey: a garment photographed right now (Quick Try-On)
 *   - parentJobId: change one thing about the previous result
 */
export const startTryOnSchema = z
  .object({
    kind: tryOnKindSchema.default('SINGLE_ITEM'),
    photoId: idSchema.optional(),
    items: z
      .array(
        z.object({
          slot: garmentSlotSchema,
          productId: idSchema.optional(),
          variantId: idSchema.optional(),
          wardrobeItemId: idSchema.optional(),
        }),
      )
      .max(6)
      .default([]),
    /** Quick Try-On: a garment the user just photographed. */
    sourceKey: z.string().optional(),
    /** Chained edit: "change the top", "add heels". */
    parentJobId: idSchema.optional(),
    lookId: idSchema.optional(),
    /** Free text for a chained edit, shown back to the user as the change. */
    instruction: z.string().max(200).optional(),
  })
  .refine(
    (value) =>
      value.items.length > 0 ||
      Boolean(value.sourceKey) ||
      Boolean(value.lookId) ||
      Boolean(value.parentJobId),
    { message: 'Give at least one item, a photographed garment, or a look to recreate' },
  );

export const tryOnJobSchema = z.object({
  id: idSchema,
  kind: tryOnKindSchema,
  status: jobStatusSchema,
  image: imageSchema.nullable(),
  lookId: idSchema.nullable(),
  creditsCharged: z.number().int(),
  /** Position in the queue and a rough wait, so the UI can be honest. */
  queuePosition: z.number().int().nullable(),
  estimatedSeconds: z.number().int().nullable(),
  error: z.string().nullable(),
  instruction: z.string().nullable(),
  parentJobId: idSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

/** Returned by POST /tryon so the app can show the pending card immediately. */
export const startTryOnResponseSchema = z.object({
  job: tryOnJobSchema,
  creditsRemaining: z.number().int(),
});

/**
 * The fit disclaimer. Served by the API rather than hard coded in the app, so
 * the wording can be corrected without a release. The brief requires it to be
 * shown on every try-on result.
 */
export const fitNoticeSchema = z.object({
  title: z.string(),
  body: z.string(),
});

// -------------------------------------------------------------- Ask Nima ---

export const stylistThreadSchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  updatedAt: z.string(),
  lastMessage: z.string().nullable(),
});

export const stylistMessageSchema = z.object({
  id: idSchema,
  role: z.enum(['USER', 'ASSISTANT', 'TOOL', 'SYSTEM']),
  content: z.string(),
  products: z.array(productCardSchema).default([]),
  looks: z.array(lookCardSchema).default([]),
  createdAt: z.string(),
});

export const askNimaSchema = z.object({
  threadId: idSchema.optional(),
  message: z.string().min(1).max(1000),
  /** Context from the screen the user asked from. */
  context: z
    .object({
      productId: idSchema.optional(),
      lookId: idSchema.optional(),
      wardrobeItemId: idSchema.optional(),
      occasion: z.string().max(40).optional(),
    })
    .optional(),
});

export const askNimaResponseSchema = z.object({
  threadId: idSchema,
  messageId: idSchema,
  /** The reply streams over the WebSocket; this is the opening text. */
  accepted: z.literal(true),
});

export const suggestedPromptSchema = z.object({
  label: z.string(),
  message: z.string(),
  icon: z.string().nullable(),
});

// --------------------------------------------------------------- credits ---

export const creditBalanceSchema = z.object({
  balance: z.number().int(),
  /** When the next free grant lands. */
  nextGrantAt: z.string().nullable(),
  freeWeeklyCredits: z.number().int(),
});

export const creditEntrySchema = z.object({
  id: idSchema,
  delta: z.number().int(),
  reason: z.enum([
    'WEEKLY_GRANT',
    'SIGNUP_BONUS',
    'TRY_ON',
    'LOOK_GENERATION',
    'GHOST_MANNEQUIN',
    'PURCHASE',
    'REFUND',
    'ADMIN_ADJUSTMENT',
  ]),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const creditPackSchema = z.object({
  key: z.string(),
  credits: z.number().int(),
  priceCents: z.number().int(),
  bestValue: z.boolean(),
  /** Apple requires in app purchase for digital goods, so iOS gets a product id. */
  productIdIos: z.string().nullable(),
});

export const creditCostsSchema = z.record(z.string(), z.number().int());

export const buyCreditsSchema = z.object({
  packKey: z.string().min(1),
  /** M-Pesa number for the STK push. Android and web only. */
  phone: z.string().optional(),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  /** Apple receipt, when the purchase already happened in the store. */
  appleTransactionId: z.string().optional(),
});

export const creditHistoryQuerySchema = paginationQuerySchema;
