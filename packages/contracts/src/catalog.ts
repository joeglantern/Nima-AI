/**
 * Shop: products, variants, search and stores.
 */

import { z } from 'zod';
import {
  genderSchema,
  idSchema,
  imageSchema,
  paginationQuerySchema,
  productCategorySchema,
} from './common.js';

export const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED']);

export const variantSchema = z.object({
  id: idSchema,
  size: z.string().nullable(),
  colour: z.string().nullable(),
  priceCents: z.number().int(),
  compareAtCents: z.number().int().nullable(),
  inStock: z.boolean(),
});

export const storeCardSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  logo: imageSchema.nullable(),
  verified: z.boolean(),
  county: z.string().nullable(),
});

/** Compact shape used in grids and carousels. */
export const productCardSchema = z.object({
  id: idSchema,
  title: z.string(),
  slug: z.string(),
  category: productCategorySchema,
  priceFromCents: z.number().int(),
  image: imageSchema.nullable(),
  store: storeCardSchema,
  inStock: z.boolean(),
  /** Set when the card is a paid placement. Always shown as such. */
  promoted: z.boolean().default(false),
  savedByMe: z.boolean().default(false),
});

export const productDetailSchema = productCardSchema.extend({
  description: z.string().nullable(),
  brand: z.string().nullable(),
  material: z.string().nullable(),
  colours: z.array(z.string()),
  tags: z.array(z.string()),
  occasions: z.array(z.string()),
  gender: genderSchema.nullable(),
  images: z.array(imageSchema),
  variants: z.array(variantSchema),
  sizeGuide: z
    .object({
      note: z.string().nullable(),
      rows: z.array(z.record(z.string(), z.string())),
    })
    .nullable(),
  returnPolicy: z.string().nullable(),
  rating: z.object({ average: z.number(), count: z.number().int() }).nullable(),
  /** Looks that include this product, for "styled with". */
  styledWithCount: z.number().int(),
});

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  category: productCategorySchema.optional(),
  storeId: idSchema.optional(),
  gender: genderSchema.optional(),
  colour: z.string().max(24).optional(),
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(0).optional(),
  occasion: z.string().max(40).optional(),
  inStockOnly: z.coerce.boolean().default(true),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'popular']).default('relevance'),
});

export const searchSuggestionSchema = z.object({
  kind: z.enum(['product', 'store', 'profile', 'tag', 'query']),
  label: z.string(),
  value: z.string(),
  imageUrl: z.url().nullable(),
});

// ------------------------------------------------------------ seller write ---

export const upsertProductSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(4000).nullable().optional(),
  category: productCategorySchema,
  subcategory: z.string().max(60).nullable().optional(),
  brand: z.string().max(60).nullable().optional(),
  material: z.string().max(120).nullable().optional(),
  colours: z.array(z.string().max(24)).max(12).default([]),
  tags: z.array(z.string().max(24)).max(20).default([]),
  occasions: z.array(z.string().max(40)).max(12).default([]),
  gender: genderSchema.nullable().optional(),
  status: productStatusSchema.default('DRAFT'),
  sizeGuide: z
    .object({
      note: z.string().max(500).nullable(),
      rows: z.array(z.record(z.string(), z.string())).max(30),
    })
    .nullable()
    .optional(),
  variants: z
    .array(
      z.object({
        id: idSchema.optional(),
        size: z.string().max(12).nullable().optional(),
        colour: z.string().max(24).nullable().optional(),
        sku: z.string().max(40).nullable().optional(),
        priceCents: z.number().int().min(0),
        compareAtCents: z.number().int().min(0).nullable().optional(),
        stock: z.number().int().min(0).default(0),
        isActive: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(60),
  images: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        position: z.number().int().min(0).default(0),
        isPrimary: z.boolean().default(false),
        /** Queue background removal or a ghost mannequin shot after upload. */
        process: z.enum(['NONE', 'BACKGROUND_REMOVED', 'GHOST_MANNEQUIN']).default('NONE'),
      }),
    )
    .max(10)
    .default([]),
});

export const upsertStoreSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only')
    .optional(),
  about: z.string().max(1000).nullable().optional(),
  county: z.string().max(60).nullable().optional(),
  whatsapp: z.string().max(20).nullable().optional(),
  returnPolicy: z.string().max(2000).nullable().optional(),
  logoKey: z.string().nullable().optional(),
  bannerKey: z.string().nullable().optional(),
});
