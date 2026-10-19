/**
 * Cart, checkout, orders, delivery and the seller dashboard.
 *
 * Money is integer KES cents everywhere. Totals are always recomputed on the
 * server from the current database prices; the client never sends a total.
 */

import { z } from 'zod';
import { productCardSchema, storeCardSchema } from './catalog.js';
import { idSchema, imageSchema, paginationQuerySchema, phoneSchema } from './common.js';

export const cartItemSchema = z.object({
  id: idSchema,
  product: productCardSchema,
  variant: z.object({
    id: idSchema,
    size: z.string().nullable(),
    colour: z.string().nullable(),
    priceCents: z.number().int(),
    inStock: z.boolean(),
    stockLeft: z.number().int().nullable(),
  }),
  quantity: z.number().int(),
  lineTotalCents: z.number().int(),
});

/** The cart is grouped by store, because each store becomes its own order. */
export const cartSchema = z.object({
  groups: z.array(
    z.object({
      store: storeCardSchema,
      items: z.array(cartItemSchema),
      subtotalCents: z.number().int(),
    }),
  ),
  subtotalCents: z.number().int(),
  itemCount: z.number().int(),
  /** Items that went out of stock while they sat in the cart. */
  unavailable: z.array(cartItemSchema).default([]),
});

export const addToCartSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1).max(99).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

// --------------------------------------------------------------- delivery ---

export const pickupPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string(),
  county: z.string(),
  costCents: z.number().int(),
  openingHours: z.string().nullable(),
});

export const deliveryQuoteSchema = z.object({
  method: z.enum(['PICKUP_POINT', 'DOORSTEP']),
  pickupPointId: z.string().nullable(),
  costCents: z.number().int(),
  estimate: z.string(),
});

// --------------------------------------------------------------- checkout ---

export const startCheckoutSchema = z.object({
  deliveryMethod: z.enum(['PICKUP_POINT', 'DOORSTEP']).default('PICKUP_POINT'),
  pickupPointId: z.string().optional(),
  recipientName: z.string().min(2).max(80),
  recipientPhone: phoneSchema,
  deliveryNote: z.string().max(280).optional(),
  /** The number that receives the M-Pesa prompt. Often the same one. */
  payerPhone: phoneSchema,
});

/**
 * Includes REFUNDED, which the live `payment.status` socket frame does not:
 * a refund is a later chapter, and it reaches the app as an order update.
 */
export const paymentStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
]);

export const checkoutSchema = z.object({
  id: idSchema,
  status: paymentStatusSchema,
  subtotalCents: z.number().int(),
  deliveryCents: z.number().int(),
  totalCents: z.number().int(),
  orderIds: z.array(idSchema),
  /** What to tell the user while the phone prompt is open. */
  instruction: z.string(),
});

// ----------------------------------------------------------------- orders ---

export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'PREPARING',
  'READY_FOR_PICKUP',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]);

export const orderItemSchema = z.object({
  id: idSchema,
  title: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  image: imageSchema.nullable(),
  unitPriceCents: z.number().int(),
  quantity: z.number().int(),
  totalCents: z.number().int(),
  productId: idSchema,
});

export const orderSchema = z.object({
  id: idSchema,
  reference: z.string(),
  status: orderStatusSchema,
  store: storeCardSchema,
  items: z.array(orderItemSchema),
  subtotalCents: z.number().int(),
  deliveryCents: z.number().int(),
  totalCents: z.number().int(),
  placedAt: z.string(),
  shipment: z
    .object({
      status: z.string(),
      trackingCode: z.string().nullable(),
      pickupPointName: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  canReview: z.boolean(),
});

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
});

export const createReviewSchema = z.object({
  productId: idSchema,
  rating: z.number().int().min(1).max(5),
  body: z.string().max(1000).optional(),
  imageKeys: z.array(z.string()).max(4).default([]),
});

// ----------------------------------------------------------- seller side ---

export const sellerOrderActionSchema = z.object({
  action: z.enum(['accept', 'mark_ready', 'cancel']),
  reason: z.string().max(280).optional(),
});

export const sellerDashboardSchema = z.object({
  range: z.enum(['7d', '30d', '90d']),
  totals: z.object({
    views: z.number().int(),
    tryOns: z.number().int(),
    addToCarts: z.number().int(),
    purchases: z.number().int(),
    revenueCents: z.number().int(),
    /** Only the owner sees this. It is never public. */
    followers: z.number().int(),
  }),
  /** The funnel is the headline: view, try-on, cart, purchase. */
  funnel: z.array(z.object({ step: z.string(), count: z.number().int() })),
  daily: z.array(
    z.object({
      day: z.string(),
      views: z.number().int(),
      tryOns: z.number().int(),
      purchases: z.number().int(),
      revenueCents: z.number().int(),
    }),
  ),
  topProducts: z.array(
    z.object({
      product: productCardSchema,
      views: z.number().int(),
      tryOns: z.number().int(),
      purchases: z.number().int(),
      conversion: z.number(),
    }),
  ),
  balance: z.object({
    pendingCents: z.number().int(),
    availableCents: z.number().int(),
    paidOutCents: z.number().int(),
  }),
});

// ------------------------------------------------------------ seller views ---

/** The shop as its owner sees it, with the private bits the public never does. */
export const sellerStoreSchema = storeCardSchema.extend({
  about: z.string().nullable(),
  whatsapp: z.string().nullable(),
  returnPolicy: z.string().nullable(),
  plan: z.string(),
  stats: z.object({
    activeProducts: z.number().int(),
    draftProducts: z.number().int(),
    openOrders: z.number().int(),
    followers: z.number().int(),
    sales30dCents: z.number().int(),
    pendingCents: z.number().int(),
    availableCents: z.number().int(),
  }),
});

export const sellerProductRowSchema = z.object({
  id: idSchema,
  title: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED']),
  priceFromCents: z.number().int(),
  stock: z.number().int(),
  image: imageSchema.nullable(),
  views30d: z.number().int(),
  updatedAt: z.string(),
});

/** Everything the edit form needs to fill itself in. */
export const sellerProductDetailSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  colours: z.array(z.string()),
  occasions: z.array(z.string()),
  status: z.enum(['DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED']),
  variants: z.array(
    z.object({
      id: idSchema,
      size: z.string().nullable(),
      colour: z.string().nullable(),
      priceCents: z.number().int(),
      stock: z.number().int(),
      isActive: z.boolean(),
    }),
  ),
  images: z.array(
    z.object({ storageKey: z.string(), image: imageSchema, processing: z.boolean() }),
  ),
});

export const sellerOrderSchema = orderSchema.extend({
  buyer: z.object({ displayName: z.string(), handle: z.string().nullable() }),
  /** What the seller can do next, so the app never offers a step that will be refused. */
  actions: z.array(z.enum(['accept', 'mark_ready', 'cancel'])),
});
