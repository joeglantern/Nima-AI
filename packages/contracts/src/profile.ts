/**
 * Account, profile, style questionnaire and photos.
 *
 * The questionnaire is deliberately a PATCH of partial answers. The app saves
 * each answer as it is given and never blocks the user on completion.
 */

import { z } from 'zod';
import { genderSchema, handleSchema, idSchema, imageSchema, visibilitySchema } from './common.js';

export const sessionUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email().nullable(),
  isAnonymous: z.boolean(),
  role: z.enum(['USER', 'ADMIN', 'SUPPORT']),
  handle: handleSchema.nullable(),
  avatarUrl: z.url().nullable(),
  credits: z.number().int(),
  hasStore: z.boolean(),
  /** Progress hint for the questionnaire card, 0 to 100. */
  styleProfileCompletion: z.number().int().min(0).max(100),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

// ---------------------------------------------------------------- profile ---

export const publicProfileSchema = z.object({
  id: idSchema,
  handle: handleSchema,
  displayName: z.string(),
  bio: z.string().nullable(),
  link: z.string().nullable(),
  avatar: imageSchema.nullable(),
  isPrivate: z.boolean(),
  /** Whether the signed in viewer follows this person. Null for guests. */
  isFollowing: z.boolean().nullable(),
  store: z
    .object({ id: idSchema, name: z.string(), slug: z.string(), verified: z.boolean() })
    .nullable(),
  /**
   * Follower counts are never public. The brief is explicit about this, so the
   * field simply does not exist on the public shape.
   */
  joinedAt: z.string(),
});

export const updateProfileSchema = z.object({
  handle: handleSchema.optional(),
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(280).nullable().optional(),
  link: z.url().max(200).nullable().optional(),
  isPrivate: z.boolean().optional(),
  wardrobePublic: z.boolean().optional(),
});

export const handleAvailabilitySchema = z.object({
  handle: handleSchema,
  available: z.boolean(),
  suggestion: handleSchema.optional(),
});

// ----------------------------------------------------------- style profile ---

export const styleProfileSchema = z.object({
  birthYear: z.number().int().min(1920).max(new Date().getFullYear()).nullable(),
  gender: genderSchema.nullable(),
  county: z.string().max(60).nullable(),
  city: z.string().max(60).nullable(),
  aesthetics: z.array(z.string().max(40)).max(12),
  favouriteColours: z.array(z.string().max(24)).max(12),
  avoidColours: z.array(z.string().max(24)).max(12),
  occasions: z.array(z.string().max(40)).max(12),
  budgetMinCents: z.number().int().min(0).nullable(),
  budgetMaxCents: z.number().int().min(0).nullable(),
  topSize: z.string().max(12).nullable(),
  bottomSize: z.string().max(12).nullable(),
  dressSize: z.string().max(12).nullable(),
  shoeSizeEu: z.number().min(15).max(55).nullable(),
  heightCm: z.number().int().min(100).max(230).nullable(),
  completedSteps: z.array(z.string()),
  completion: z.number().int().min(0).max(100),
});

/** Every field optional: the app saves one answer at a time. */
export const updateStyleProfileSchema = styleProfileSchema
  .omit({ completedSteps: true, completion: true })
  .partial()
  .extend({
    /** The step this request completes, appended to completedSteps. */
    step: z.string().max(40).optional(),
  });

/** The questionnaire definition, served to the app so copy lives in one place. */
export const questionnaireStepSchema = z.object({
  key: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Which profile fields this step writes. */
  fields: z.array(z.string()),
  kind: z.enum(['single', 'multi', 'range', 'sizes', 'text', 'year']),
  options: z
    .array(z.object({ value: z.string(), label: z.string(), imageUrl: z.url().optional() }))
    .optional(),
  optional: z.boolean().default(true),
});

// ----------------------------------------------------------------- photos ---

export const userPhotoKindSchema = z.enum(['FULL_BODY', 'UPPER_BODY']);

export const userPhotoSchema = z.object({
  id: idSchema,
  kind: userPhotoKindSchema,
  url: z.url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  isDefault: z.boolean(),
  checkState: z.enum(['PENDING', 'PASSED', 'FAILED']),
  checkNote: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * Uploads are two steps. The client asks for a presigned URL, uploads straight
 * to storage, then tells the API the object is there. Image bytes never pass
 * through the API process.
 */
export const createUploadSchema = z.object({
  purpose: z.enum([
    'USER_PHOTO',
    'WARDROBE_ITEM',
    'PRODUCT_IMAGE',
    'AVATAR',
    'STORE_LOGO',
    'STORE_BANNER',
    'QUICK_TRY_ON',
    'REVIEW',
  ]),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  /** Bytes. Rejected above the per purpose limit. */
  size: z.number().int().positive().max(25 * 1024 * 1024),
});

export const uploadTicketSchema = z.object({
  uploadUrl: z.url(),
  storageKey: z.string(),
  /** Headers the client must send with the PUT. */
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.number().int(),
});

export const confirmUserPhotoSchema = z.object({
  storageKey: z.string().min(1),
  kind: userPhotoKindSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  makeDefault: z.boolean().default(true),
});

// --------------------------------------------------------------- settings ---

export const privacySettingsSchema = z.object({
  isPrivate: z.boolean(),
  wardrobePublic: z.boolean(),
  defaultLookVisibility: visibilitySchema,
  /** Try-on results are private unless the user shares them. */
  autoPublishTryOns: z.literal(false).default(false),
});

export const deleteAccountSchema = z.object({
  /** Typed confirmation, to make an irreversible action deliberate. */
  confirm: z.literal('DELETE'),
  reason: z.string().max(500).optional(),
});
