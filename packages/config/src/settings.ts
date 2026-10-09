/**
 * Business settings.
 *
 * These are deliberately not environment variables. They change with the
 * business, not with the deployment, and an admin must be able to change them
 * without a release. The defaults below are the seed values; the live values
 * live in the app_settings table and are read through a cached accessor in the
 * API (see apps/api/src/modules/settings).
 *
 * Costs are in credits. Prices are in KES cents.
 */

import { z } from 'zod';

export const creditCostsSchema = z.object({
  /** One garment on the user's photo. */
  tryOnSingleItem: z.number().int().min(0).default(1),
  /** A full outfit, several garments in one image. */
  tryOnOutfit: z.number().int().min(0).default(2),
  /** Jewellery or eyewear on the upper body photo. */
  tryOnAccessory: z.number().int().min(0).default(1),
  /** Photograph a garment in a shop and see it on yourself. */
  tryOnQuick: z.number().int().min(0).default(1),
  /** Recreate someone else's look. The old app charged nothing here. */
  recreateLook: z.number().int().min(0).default(1),
  /** A set of looks generated from an Ask Nima conversation. */
  stylistLookSet: z.number().int().min(0).default(3),
  /** Seller feature: clean catalogue shot from a flat lay photo. */
  ghostMannequin: z.number().int().min(0).default(1),
});

export type CreditCosts = z.infer<typeof creditCostsSchema>;

export const creditPackSchema = z.object({
  key: z.string(),
  credits: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  /** Apple takes a cut, so iOS packs are priced separately. */
  iosPriceCents: z.number().int().positive().optional(),
  productIdIos: z.string().optional(),
  bestValue: z.boolean().default(false),
});

export type CreditPack = z.infer<typeof creditPackSchema>;

export const settingsSchema = z.object({
  creditCosts: creditCostsSchema,
  creditPacks: z.array(creditPackSchema),

  /** Credits granted to every signed in user at the start of their week. */
  freeWeeklyCredits: z.number().int().min(0).default(5),
  /** Extra credits on first sign up, so the first try-on feels free. */
  signupBonusCredits: z.number().int().min(0).default(3),

  /** What Nima keeps from each order, in basis points. 700 = 7 percent. */
  platformFeeBps: z.number().int().min(0).max(5000).default(700),
  /** Days after delivery before a seller can be paid, to cover returns. */
  payoutHoldDays: z.number().int().min(0).default(3),

  /** Free try-ons a guest may run before an account is required. */
  guestTryOnLimit: z.number().int().min(0).default(0),

  features: z.object({
    checkout: z.boolean().default(false),
    sellerDashboard: z.boolean().default(true),
    directMessages: z.boolean().default(true),
    ghostMannequin: z.boolean().default(false),
    promotions: z.boolean().default(false),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

/**
 * Starting values. The credit pack prices come from the previous app, where
 * they were live: KES 50 per credit.
 */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({
  creditCosts: {},
  creditPacks: [
    { key: 'starter', credits: 10, priceCents: 50_000, productIdIos: 'nima.credits.10' },
    { key: 'regular', credits: 20, priceCents: 100_000, productIdIos: 'nima.credits.20' },
    {
      key: 'value',
      credits: 50,
      priceCents: 250_000,
      productIdIos: 'nima.credits.50',
      bestValue: true,
    },
    { key: 'pro', credits: 100, priceCents: 500_000, productIdIos: 'nima.credits.100' },
  ],
  freeWeeklyCredits: 5,
  signupBonusCredits: 3,
  platformFeeBps: 700,
  payoutHoldDays: 3,
  guestTryOnLimit: 0,
  features: {
    checkout: false,
    sellerDashboard: true,
    directMessages: true,
    ghostMannequin: false,
    promotions: false,
  },
});

/** Key used in the app_settings table. */
export const SETTINGS_KEY = 'platform';
