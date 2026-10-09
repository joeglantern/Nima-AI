/**
 * Looks, the For You feed, social actions, wardrobe and lookbooks.
 *
 * A look is the unit the whole product is built on: a try-on result, an AI
 * suggestion, a seller post and a user outfit are all looks, so saving,
 * sharing and recreating behave the same everywhere.
 */

import { z } from 'zod';
import {
  garmentSlotSchema,
  idSchema,
  imageSchema,
  paginationQuerySchema,
  productCategorySchema,
  visibilitySchema,
} from './common.js';
import { productCardSchema, storeCardSchema } from './catalog.js';

export const lookSourceSchema = z.enum([
  'USER',
  'AI',
  'SELLER',
  'CURATED',
  'RECREATION',
  'TRY_ON',
]);

export const lookItemSchema = z.object({
  id: idSchema,
  slot: garmentSlotSchema,
  product: productCardSchema.nullable(),
  wardrobeItem: z
    .object({
      id: idSchema,
      label: z.string().nullable(),
      category: productCategorySchema,
      image: imageSchema.nullable(),
    })
    .nullable(),
});

export const lookAuthorSchema = z.object({
  id: idSchema,
  handle: z.string(),
  displayName: z.string(),
  avatar: imageSchema.nullable(),
  store: storeCardSchema.nullable(),
});

export const lookCardSchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  caption: z.string().nullable(),
  /** One line of stylist copy under the card. */
  nimaSays: z.string().nullable(),
  source: lookSourceSchema,
  visibility: visibilitySchema,
  image: imageSchema.nullable(),
  author: lookAuthorSchema.nullable(),
  itemCount: z.number().int(),
  likeCount: z.number().int(),
  likedByMe: z.boolean(),
  savedByMe: z.boolean(),
  canRecreate: z.boolean(),
  promoted: z.boolean().default(false),
  createdAt: z.string(),
});

export const lookDetailSchema = lookCardSchema.extend({
  items: z.array(lookItemSchema),
  /** Total of every purchasable item in the look. */
  shopTotalCents: z.number().int().nullable(),
  recreatedFrom: z
    .object({ id: idSchema, author: lookAuthorSchema.nullable() })
    .nullable(),
  commentCount: z.number().int(),
});

export const feedQuerySchema = paginationQuerySchema.extend({
  /** `foryou` is personalised; `explore` is fresh public looks. */
  surface: z.enum(['foryou', 'explore', 'following']).default('foryou'),
  occasion: z.string().max(40).optional(),
  /** Guests get session based personalisation keyed by this id. */
  anonId: z.string().max(64).optional(),
});

export const feedItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('look'), look: lookCardSchema }),
  z.object({ kind: z.literal('product'), product: productCardSchema }),
  z.object({
    kind: z.literal('shelf'),
    title: z.string(),
    subtitle: z.string().nullable(),
    products: z.array(productCardSchema).max(12),
  }),
  z.object({
    kind: z.literal('prompt'),
    /** Nudges: finish the questionnaire, add a photo, try a look on. */
    promptKey: z.enum(['questionnaire', 'add_photo', 'first_tryon', 'open_store']),
    title: z.string(),
    body: z.string(),
    ctaLabel: z.string(),
  }),
]);

export const createLookSchema = z.object({
  title: z.string().max(80).nullable().optional(),
  caption: z.string().max(500).nullable().optional(),
  visibility: visibilitySchema.default('PRIVATE'),
  items: z
    .array(
      z.object({
        slot: garmentSlotSchema,
        productId: idSchema.optional(),
        variantId: idSchema.optional(),
        wardrobeItemId: idSchema.optional(),
      }),
    )
    .min(1)
    .max(8),
  /** Generate an image of the user wearing it. Costs credits. */
  generateImage: z.boolean().default(false),
});

export const updateLookSchema = z.object({
  title: z.string().max(80).nullable().optional(),
  caption: z.string().max(500).nullable().optional(),
  visibility: visibilitySchema.optional(),
});

export const dismissSchema = z.object({
  reason: z.enum(['not_my_style', 'too_expensive', 'wrong_size', 'seen_enough', 'other']).optional(),
});

export const shareTargetSchema = z.object({
  /** Direct message recipients. */
  userIds: z.array(idSchema).max(20).default([]),
  note: z.string().max(280).optional(),
});

export const shareLinkSchema = z.object({
  url: z.url(),
  /** Short text prepared for WhatsApp, which is how sharing happens here. */
  message: z.string(),
});

// --------------------------------------------------------------- comments ---

export const commentSchema = z.object({
  id: idSchema,
  body: z.string(),
  author: lookAuthorSchema,
  parentId: idSchema.nullable(),
  replyCount: z.number().int(),
  createdAt: z.string(),
  mine: z.boolean(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(500),
  parentId: idSchema.optional(),
});

// --------------------------------------------------------------- wardrobe ---

export const wardrobeItemSchema = z.object({
  id: idSchema,
  label: z.string().nullable(),
  category: productCategorySchema,
  slot: garmentSlotSchema,
  colours: z.array(z.string()),
  tags: z.array(z.string()),
  image: imageSchema.nullable(),
  /** True until the background removal and tagging job has finished. */
  processing: z.boolean(),
  visibility: visibilitySchema,
  createdAt: z.string(),
});

export const createWardrobeItemSchema = z.object({
  storageKey: z.string().min(1),
  label: z.string().max(60).nullable().optional(),
  category: productCategorySchema.optional(),
  slot: garmentSlotSchema.optional(),
  visibility: visibilitySchema.default('PRIVATE'),
});

export const updateWardrobeItemSchema = z.object({
  label: z.string().max(60).nullable().optional(),
  category: productCategorySchema.optional(),
  slot: garmentSlotSchema.optional(),
  colours: z.array(z.string().max(24)).max(8).optional(),
  tags: z.array(z.string().max(24)).max(16).optional(),
  visibility: visibilitySchema.optional(),
});

// -------------------------------------------------------------- lookbooks ---

export const lookbookSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string().nullable(),
  occasion: z.string().nullable(),
  cover: imageSchema.nullable(),
  visibility: visibilitySchema,
  entryCount: z.number().int(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  updatedAt: z.string(),
});

export const lookbookEntrySchema = z.object({
  id: idSchema,
  dayIndex: z.number().int().nullable(),
  occasion: z.string().nullable(),
  note: z.string().nullable(),
  position: z.number().int(),
  look: lookCardSchema.nullable(),
  product: productCardSchema.nullable(),
  wardrobeItem: wardrobeItemSchema.nullable(),
});

export const createLookbookSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  occasion: z.string().max(40).nullable().optional(),
  visibility: visibilitySchema.default('PRIVATE'),
  startsOn: z.iso.date().nullable().optional(),
  endsOn: z.iso.date().nullable().optional(),
});

export const addLookbookEntrySchema = z
  .object({
    lookId: idSchema.optional(),
    productId: idSchema.optional(),
    wardrobeItemId: idSchema.optional(),
    dayIndex: z.number().int().min(0).max(60).nullable().optional(),
    occasion: z.string().max(40).nullable().optional(),
    note: z.string().max(280).nullable().optional(),
  })
  .refine(
    (value) =>
      [value.lookId, value.productId, value.wardrobeItemId].filter(Boolean).length === 1,
    { message: 'Add exactly one of lookId, productId or wardrobeItemId' },
  );
