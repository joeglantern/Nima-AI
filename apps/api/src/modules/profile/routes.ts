/**
 * Profile, the style questionnaire, and photos.
 *
 * The questionnaire is the part the brief is most insistent about: it saves as
 * you go, it can be abandoned at any point, and it never blocks anything. So
 * every field is optional, each PATCH is partial, and nothing in the codebase
 * reads "is the questionnaire finished" as a condition.
 */

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  confirmUserPhotoSchema,
  createUploadSchema,
  handleAvailabilitySchema,
  handleSchema,
  publicProfileSchema,
  styleProfileSchema,
  updateProfileSchema,
  updateStyleProfileSchema,
  uploadTicketSchema,
  userPhotoSchema,
} from '@nima/contracts';
import { errors } from '../../lib/errors.js';
import { FileTooLargeError, UnsupportedMediaError } from '../../lib/storage.js';
import { privateImage, publicImage, storeCard } from '../../lib/presenters.js';
import { completionOf } from './completion.js';
import { suggestHandle } from './handle.js';

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------- profile ---

  app.get(
    '/profiles/:handle',
    {
      schema: {
        tags: ['profile'],
        summary: 'A public profile',
        description: 'Follower counts are deliberately absent: they are never public.',
        params: z.object({ handle: handleSchema }),
        response: { 200: publicProfileSchema },
      },
    },
    async (request) => {
      const viewer = request.user;

      const profile = await app.prisma.profile.findUnique({
        where: { handle: request.params.handle },
        include: {
          user: {
            include: {
              store: true,
              followers: viewer ? { where: { followerId: viewer.id }, take: 1 } : false,
              blocksMade: viewer ? { where: { blockedId: viewer.id }, take: 1 } : false,
            },
          },
        },
      });

      if (!profile) throw errors.notFound('That profile');

      // Someone who blocked you does not exist as far as you are concerned.
      if (profile.user.blocksMade && profile.user.blocksMade.length > 0) {
        throw errors.notFound('That profile');
      }

      return {
        id: profile.user.id,
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        link: profile.link,
        avatar: publicImage(app.storage, profile.avatarKey),
        isPrivate: profile.isPrivate,
        isFollowing: viewer ? (profile.user.followers?.length ?? 0) > 0 : null,
        store: profile.user.store
          ? {
              id: profile.user.store.id,
              name: profile.user.store.name,
              slug: profile.user.store.slug,
              verified: profile.user.store.verifiedAt !== null,
            }
          : null,
        joinedAt: profile.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/profile/handle-available',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['profile'],
        summary: 'Is this handle free',
        querystring: z.object({ handle: handleSchema }),
        response: { 200: handleAvailabilitySchema },
      },
    },
    async (request) => {
      const taken = await app.prisma.profile.findUnique({
        where: { handle: request.query.handle },
        select: { userId: true },
      });

      if (!taken || taken.userId === request.user?.id) {
        return { handle: request.query.handle, available: true };
      }

      return {
        handle: request.query.handle,
        available: false,
        suggestion: await suggestHandle(app.prisma, request.query.handle),
      };
    },
  );

  app.patch(
    '/profile',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['profile'],
        summary: 'Update your own profile',
        body: updateProfileSchema,
        response: { 200: publicProfileSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const body = request.body;

      if (body.handle) {
        const taken = await app.prisma.profile.findUnique({
          where: { handle: body.handle },
          select: { userId: true },
        });
        if (taken && taken.userId !== user.id) {
          throw errors.conflict('That handle is taken');
        }
      }

      const profile = await app.prisma.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          handle: body.handle ?? (await suggestHandle(app.prisma, user.name)),
          displayName: body.displayName ?? user.name,
          bio: body.bio ?? null,
          link: body.link ?? null,
          isPrivate: body.isPrivate ?? false,
          wardrobePublic: body.wardrobePublic ?? false,
        },
        update: {
          ...(body.handle !== undefined ? { handle: body.handle } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.bio !== undefined ? { bio: body.bio } : {}),
          ...(body.link !== undefined ? { link: body.link } : {}),
          ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
          ...(body.wardrobePublic !== undefined ? { wardrobePublic: body.wardrobePublic } : {}),
        },
        include: { user: { include: { store: true } } },
      });

      return {
        id: user.id,
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        link: profile.link,
        avatar: publicImage(app.storage, profile.avatarKey),
        isPrivate: profile.isPrivate,
        isFollowing: null,
        store: profile.user.store
          ? storeCard(app.storage, profile.user.store)
          : null,
        joinedAt: profile.createdAt.toISOString(),
      };
    },
  );

  // ------------------------------------------------------- questionnaire ---

  app.get(
    '/profile/style',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['profile'],
        summary: 'Your style answers so far',
        response: { 200: styleProfileSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const profile = await app.prisma.styleProfile.findUnique({ where: { userId: user.id } });

      return {
        birthYear: profile?.birthYear ?? null,
        gender: (profile?.gender ?? null) as never,
        county: profile?.county ?? null,
        city: profile?.city ?? null,
        aesthetics: profile?.aesthetics ?? [],
        favouriteColours: profile?.favouriteColours ?? [],
        avoidColours: profile?.avoidColours ?? [],
        occasions: profile?.occasions ?? [],
        budgetMinCents: profile?.budgetMinCents ?? null,
        budgetMaxCents: profile?.budgetMaxCents ?? null,
        topSize: profile?.topSize ?? null,
        bottomSize: profile?.bottomSize ?? null,
        dressSize: profile?.dressSize ?? null,
        shoeSizeEu: profile?.shoeSizeEu ? Number(profile.shoeSizeEu) : null,
        heightCm: profile?.heightCm ?? null,
        completedSteps: profile?.completedSteps ?? [],
        completion: completionOf(profile),
      };
    },
  );

  app.patch(
    '/profile/style',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['profile'],
        summary: 'Save one or more answers',
        description:
          'Every field is optional. The app calls this as each question is answered, ' +
          'so a half finished questionnaire is a normal state, not an error.',
        body: updateStyleProfileSchema,
        response: {
          200: z.object({
            completion: z.number().int(),
            completedSteps: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { step, ...answers } = request.body;

      if (
        answers.budgetMinCents != null &&
        answers.budgetMaxCents != null &&
        answers.budgetMinCents > answers.budgetMaxCents
      ) {
        throw errors.badRequest('The smallest budget cannot be larger than the largest', {
          budgetMinCents: ['Must be less than the maximum'],
        });
      }

      const existing = await app.prisma.styleProfile.findUnique({ where: { userId: user.id } });
      const steps = new Set(existing?.completedSteps ?? []);
      if (step) steps.add(step);

      const data = {
        ...answers,
        ...(answers.shoeSizeEu !== undefined ? { shoeSizeEu: answers.shoeSizeEu } : {}),
        completedSteps: [...steps],
      };

      const profile = await app.prisma.styleProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        update: data,
      });

      return { completion: completionOf(profile), completedSteps: profile.completedSteps };
    },
  );

  // -------------------------------------------------------------- photos ---

  app.post(
    '/uploads',
    {
      preHandler: app.requireSession,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Get a direct upload link',
        description:
          'Upload the file straight to storage with a PUT, then tell the matching ' +
          'endpoint the storage key. Image bytes never pass through the API.',
        body: createUploadSchema,
        response: { 200: uploadTicketSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { purpose, contentType, size } = request.body;

      // Seller uploads are scoped to the store, everything else to the person.
      let ownerId = user.id;
      if (purpose === 'PRODUCT_IMAGE' || purpose === 'STORE_LOGO' || purpose === 'STORE_BANNER') {
        const store = await app.prisma.store.findUnique({
          where: { ownerId: user.id },
          select: { id: true },
        });
        if (!store) throw errors.forbidden('Open a store before uploading product photos');
        ownerId = store.id;
      }

      try {
        return await app.storage.presignUpload({ purpose, contentType, size, ownerId });
      } catch (error) {
        if (error instanceof FileTooLargeError) throw errors.tooLarge(error.message);
        if (error instanceof UnsupportedMediaError) throw errors.unsupportedMedia(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/profile/photos',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['profile'],
        summary: 'Your photos',
        response: { 200: z.object({ items: z.array(userPhotoSchema) }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const photos = await app.prisma.userPhoto.findMany({
        where: { userId: user.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

      return {
        items: await Promise.all(
          photos.map(async (photo) => ({
            id: photo.id,
            kind: photo.kind as never,
            url: (await privateImage(app.storage, photo.storageKey))?.url ?? '',
            width: photo.width,
            height: photo.height,
            isDefault: photo.isDefault,
            checkState: photo.checkState as never,
            checkNote: photo.checkNote,
            createdAt: photo.createdAt.toISOString(),
          })),
        ),
      };
    },
  );

  app.post(
    '/profile/photos',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['profile'],
        summary: 'Save an uploaded photo',
        description:
          'Full body photos are used for outfits, upper body for jewellery and eyewear. ' +
          'Photos are private and are never published automatically.',
        body: confirmUserPhotoSchema,
        response: { 201: userPhotoSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const { storageKey, kind, width, height, makeDefault } = request.body;

      // The key must belong to this user. Without this check anyone could
      // claim anyone else's uploaded object.
      if (!storageKey.startsWith(`users/${user.id}/`)) {
        throw errors.forbidden('That upload does not belong to you');
      }

      if (!(await app.storage.exists(storageKey))) {
        throw errors.badRequest('That upload has not finished yet');
      }

      const photo = await app.prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.userPhoto.updateMany({
            where: { userId: user.id, kind },
            data: { isDefault: false },
          });
        }

        return tx.userPhoto.create({
          data: {
            userId: user.id,
            kind,
            storageKey,
            width: width ?? null,
            height: height ?? null,
            isDefault: makeDefault,
          },
        });
      });

      return reply.status(201).send({
        id: photo.id,
        kind: photo.kind as never,
        url: (await privateImage(app.storage, photo.storageKey))?.url ?? '',
        width: photo.width,
        height: photo.height,
        isDefault: photo.isDefault,
        checkState: photo.checkState as never,
        checkNote: photo.checkNote,
        createdAt: photo.createdAt.toISOString(),
      });
    },
  );

  app.delete(
    '/profile/photos/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['profile'],
        summary: 'Delete a photo',
        description: 'Removes the row and the stored file.',
        params: z.object({ id: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const photo = await app.prisma.userPhoto.findUnique({ where: { id: request.params.id } });
      if (!photo || photo.userId !== user.id) throw errors.notFound('That photo');

      await app.prisma.userPhoto.delete({ where: { id: photo.id } });

      // Storage is best effort: the row is gone either way, and an orphaned
      // object is swept up by the cleanup job.
      try {
        await app.storage.remove(photo.storageKey);
      } catch (error) {
        request.log.warn({ err: error, key: photo.storageKey }, 'Could not delete the file');
      }

      return reply.status(204).send(null);
    },
  );
};
