/**
 * Building blocks shared by every endpoint.
 *
 * The API is cursor paginated everywhere. Offset pagination breaks on a feed
 * that changes while you scroll, which is exactly what Nima is.
 */

import { z } from 'zod';

export const idSchema = z.string().min(20).max(40).describe('Opaque identifier');

export const handleSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_.]+$/, 'Letters, numbers, dots and underscores only')
  .describe('Public profile handle');

/** Kenyan mobile numbers, stored in full international form. */
export const phoneSchema = z
  .string()
  .regex(/^254[17]\d{8}$/, 'Use the format 2547XXXXXXXX');

export const cursorSchema = z.string().max(200).optional();

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const paginationQuerySchema = z.object({
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * One error shape for the whole API, so the app can handle failures in one
 * place. `code` is stable and machine readable; `message` is written for a
 * person and may be shown directly.
 */
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field level problems, keyed by the path in the request body. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof errorSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

/** Money is always integer cents, with the currency alongside it. */
export const moneySchema = z.object({
  cents: z.number().int(),
  currency: z.literal('KES').default('KES'),
});

export const imageSchema = z.object({
  url: z.url(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** Tiny blurred placeholder so cards do not pop in. */
  blurhash: z.string().nullable().optional(),
});

export const visibilitySchema = z.enum(['PRIVATE', 'FOLLOWERS', 'PUBLIC']);

export const genderSchema = z.enum(['WOMAN', 'MAN', 'NON_BINARY', 'PREFER_NOT_TO_SAY']);

export const garmentSlotSchema = z.enum([
  'TOP',
  'BOTTOM',
  'FULL_BODY',
  'OUTERWEAR',
  'SHOES',
  'BAG',
  'JEWELLERY',
  'EYEWEAR',
  'HEADWEAR',
  'OTHER',
]);

export const productCategorySchema = z.enum([
  'TOP',
  'BOTTOM',
  'DRESS',
  'OUTERWEAR',
  'SHOES',
  'BAG',
  'JEWELLERY',
  'EYEWEAR',
  'HEADWEAR',
  'ACCESSORY',
  'OTHER',
]);

export const platformSchema = z.enum(['IOS', 'ANDROID', 'WEB']);
