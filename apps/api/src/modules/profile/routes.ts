/**
 * Profile, the style questionnaire, and photos.
 *
 * The questionnaire is the part the brief is most insistent about: it saves as
 * you go, it can be abandoned at any point, and it never blocks anything. So
 * every field is optional, each PATCH is partial, and nothing in the codebase
 * reads "is the questionnaire finished" as a condition.
 */

import {
  confirmUserPhotoSchema,
  createUploadSchema,
  handleAvailabilitySchema,
  handleSchema,
  imageSchema,
  lookCardSchema,
  publicProfileSchema,
  styleProfileSchema,
  updateProfileSchema,
  updateStyleProfileSchema,
  uploadTicketSchema,
  userPhotoSchema,
} from '@nima/contracts';
import type { Visibility } from '@nima/db';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { sniffImageType } from '../../lib/image-type.js';
import { verifyMediaToken } from '../../lib/media-token.js';
import { lookCard, privateImage, publicImage, storeCard } from '../../lib/presenters.js';
import { FileTooLargeError, UnsupportedMediaError } from '../../lib/storage.js';
import { DELETION_GRACE_DAYS } from '../../services/deletion.js';
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

  app.get(
    '/profile',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['profile'],
        summary: 'Your own profile, as you would edit it',
        description:
          'Unlike the public shape this includes the email and the privacy settings. ' +
          'Before a profile has been set up, every field is null and a handle is suggested.',
        response: {
          200: z.object({
            handle: handleSchema.nullable(),
            displayName: z.string().nullable(),
            bio: z.string().nullable(),
            link: z.string().nullable(),
            avatar: z.object({ url: z.string() }).nullable(),
            isPrivate: z.boolean(),
            wardrobePublic: z.boolean(),
            email: z.string().nullable(),
            suggestedHandle: handleSchema.nullable(),
            hasPassword: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const [profile, credentials] = await Promise.all([
        app.prisma.profile.findUnique({ where: { userId: user.id } }),
        app.prisma.account.count({ where: { userId: user.id, providerId: 'credential' } }),
      ]);

      // An email sign up arrives with no name, so the suggestion comes from
      // the part of the address a person would recognise as theirs.
      const seed = user.name || user.email?.split('@')[0] || 'nima';

      return {
        handle: profile?.handle ?? null,
        displayName: profile?.displayName ?? (user.name || null),
        bio: profile?.bio ?? null,
        link: profile?.link ?? null,
        avatar: profile?.avatarKey ? { url: app.storage.publicUrl(profile.avatarKey) } : null,
        isPrivate: profile?.isPrivate ?? false,
        wardrobePublic: profile?.wardrobePublic ?? false,
        email: user.email,
        suggestedHandle: profile ? null : await suggestHandle(app.prisma, seed),
        hasPassword: credentials > 0,
      };
    },
  );

  app.post(
    '/profile/password',
    {
      preHandler: app.requireAccount,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['profile'],
        summary: 'Set or change your password',
        description:
          'Accounts are opened with an emailed code, so a password is optional and added ' +
          'here. Changing one that exists needs the current one.',
        body: z.object({
          newPassword: z.string().min(8).max(128),
          currentPassword: z.string().min(1).max(128).optional(),
        }),
        response: { 200: z.object({ hasPassword: z.literal(true) }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const headers = fromNodeHeaders(request.raw.headers);
      const { newPassword, currentPassword } = request.body;

      const existing = await app.prisma.account.count({
        where: { userId: user.id, providerId: 'credential' },
      });

      try {
        if (existing > 0) {
          if (!currentPassword) {
            throw errors.badRequest('Enter your current password to change it');
          }
          await app.auth.api.changePassword({
            body: { newPassword, currentPassword, revokeOtherSessions: false },
            headers,
          });
        } else {
          await app.auth.api.setPassword({ body: { newPassword }, headers });
        }
      } catch (error) {
        if (error instanceof APIError) {
          throw errors.badRequest(
            error.body?.code === 'INVALID_PASSWORD'
              ? 'That is not your current password'
              : (error.message ?? 'That password was not accepted'),
          );
        }
        throw error;
      }

      return { hasPassword: true as const };
    },
  );

  // -------------------------------------------------------------- people ---

  app.get(
    '/profiles',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Find people',
        description:
          'Matches handles and names. A private account is listed, since its owner chose a ' +
          'handle to be found by; what it shows is still up to them.',
        querystring: z.object({
          q: z.string().trim().min(1).max(50),
          limit: z.coerce.number().int().min(1).max(30).default(12),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                handle: handleSchema,
                displayName: z.string(),
                avatar: imageSchema.nullable(),
                isPrivate: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const q = request.query.q.replace(/^@/, '').toLowerCase();
      if (!q) return { items: [] };
      const viewerId = request.user?.id ?? null;

      const profiles = await app.prisma.profile.findMany({
        where: {
          OR: [
            { handle: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
          user: {
            deletionRequestedAt: null,
            bannedAt: null,
            ...(viewerId ? { blocksMade: { none: { blockedId: viewerId } } } : {}),
          },
        },
        take: request.query.limit * 2,
      });

      // What was typed at the start of a handle comes first.
      const ranked = profiles
        .map((profile) => ({
          profile,
          rank: profile.handle.toLowerCase().startsWith(q)
            ? 0
            : profile.displayName.toLowerCase().startsWith(q)
              ? 1
              : 2,
        }))
        .sort((a, b) => a.rank - b.rank || a.profile.handle.localeCompare(b.profile.handle))
        .slice(0, request.query.limit);

      return {
        items: ranked.map(({ profile }) => ({
          handle: profile.handle,
          displayName: profile.displayName,
          avatar: publicImage(app.storage, profile.avatarKey),
          isPrivate: profile.isPrivate,
        })),
      };
    },
  );

  app.get(
    '/profiles/:handle/looks',
    {
      schema: {
        tags: ['profile'],
        summary: 'The looks of one person',
        description:
          'Public looks for anyone, followers-only ones for their followers, everything ' +
          'for the owner. A private account shows nothing to a stranger.',
        params: z.object({ handle: handleSchema }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(40).default(24),
        }),
        response: {
          200: z.object({ items: z.array(lookCardSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const profile = await app.prisma.profile.findUnique({
        where: { handle: request.params.handle },
        select: { userId: true, isPrivate: true },
      });
      if (!profile) throw errors.notFound('That profile');

      const viewerId = request.user?.id ?? null;
      const { limit, cursor } = request.query;

      let allowed: Visibility[] = ['PUBLIC'];
      if (viewerId === profile.userId) {
        allowed = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'];
      } else {
        const following = viewerId
          ? await app.prisma.follow.findFirst({
              where: { followerId: viewerId, followedId: profile.userId },
              select: { id: true },
            })
          : null;
        if (following) allowed = ['PUBLIC', 'FOLLOWERS'];
        else if (profile.isPrivate) allowed = [];
      }
      if (allowed.length === 0) return { items: [], nextCursor: null };

      const rows = await app.prisma.look.findMany({
        where: { ownerId: profile.userId, visibility: { in: allowed }, coverKey: { not: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          owner: { include: { profile: true, store: true } },
          _count: { select: { items: true, comments: { where: { hiddenAt: null } } } },
        },
      });

      const page = rows.slice(0, limit);
      const ids = page.map((look) => look.id);
      const [likes, saves] = viewerId
        ? await Promise.all([
            app.prisma.like.findMany({
              where: { userId: viewerId, lookId: { in: ids } },
              select: { lookId: true },
            }),
            app.prisma.save.findMany({
              where: { userId: viewerId, lookId: { in: ids } },
              select: { lookId: true },
            }),
          ])
        : [[], []];
      const liked = new Set(likes.map((entry) => entry.lookId));
      const saved = new Set(saves.map((entry) => entry.lookId));

      return {
        items: page.map((look) =>
          lookCard(app.storage, look, {
            likedByMe: liked.has(look.id),
            savedByMe: saved.has(look.id),
          }),
        ),
        nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
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

      // Only a picture this person uploaded for this purpose, and only one
      // that actually arrived.
      if (body.avatarKey !== undefined) {
        const owned = body.avatarKey.startsWith(`users/${user.id}/avatar/`);
        if (!owned || !(await app.storage.exists(body.avatarKey))) {
          throw errors.notFound('That photo');
        }
      }

      const profile = await app.prisma.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          handle:
            body.handle ??
            (await suggestHandle(app.prisma, user.name || user.email?.split('@')[0] || 'nima')),
          displayName: body.displayName ?? user.name,
          bio: body.bio ?? null,
          link: body.link ?? null,
          isPrivate: body.isPrivate ?? false,
          wardrobePublic: body.wardrobePublic ?? false,
          avatarKey: body.avatarKey ?? null,
        },
        update: {
          ...(body.handle !== undefined ? { handle: body.handle } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.bio !== undefined ? { bio: body.bio } : {}),
          ...(body.link !== undefined ? { link: body.link } : {}),
          ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
          ...(body.wardrobePublic !== undefined ? { wardrobePublic: body.wardrobePublic } : {}),
          ...(body.avatarKey !== undefined ? { avatarKey: body.avatarKey } : {}),
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
        store: profile.user.store ? storeCard(app.storage, profile.user.store) : null,
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

  /*
   * The other half of an upload ticket in proxy mode. The ticket's link
   * points here, and the token in it says which key, what type and how many
   * bytes, signed. No session is needed: the token is the permission, just
   * as the signature on a presigned bucket URL would be.
   *
   * It sits in its own scope because it accepts any body at all. A phone
   * does not reliably send the Content-Type it was told to: React Native
   * puts its blob's type on the request, which is often nothing, and the
   * parser here refused "application/octet-stream" before the handler
   * ever saw the bytes. So the header is ignored and the bytes say what
   * they are.
   */
  await app.register(uploadBytes);

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

  app.post(
    '/profile/delete',
    {
      preHandler: app.requireAccount,
      config: { rateLimit: { max: 4, timeWindow: '1 hour' } },
      schema: {
        tags: ['profile'],
        summary: 'Ask for your account to be deleted',
        description:
          'Marks the account and signs the person out. The nightly job removes the rows ' +
          'and the files after a grace period, so a mistake made at midnight is recoverable ' +
          'in the morning. Orders are kept: a shop has to account for what it sold.',
        response: {
          200: z.object({
            requestedAt: z.string(),
            graceDays: z.number().int(),
            message: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const requestedAt = new Date();

      await app.prisma.user.update({
        where: { id: user.id },
        data: { deletionRequestedAt: requestedAt },
      });

      // Every session, not just this device. Somebody deleting their account
      // from a phone does not expect to still be signed in on a laptop.
      await app.prisma.session.deleteMany({ where: { userId: user.id } });

      request.log.info({ userId: user.id }, 'An account was marked for deletion');

      return {
        requestedAt: requestedAt.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
        message: `Your account will be deleted in ${DELETION_GRACE_DAYS} days. Sign in again before then to stop it.`,
      };
    },
  );
};

const uploadBytes: FastifyPluginAsyncZod = async (scope) => {
  scope.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  scope.put(
    '/uploads',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Upload the bytes for a ticket',
        description:
          'Only used when the server keeps storage private. The PUT body is the image. ' +
          'Its format is read from the bytes and must be the one the ticket was issued ' +
          'for. The token is in the query string because it is longer than a path ' +
          'segment is allowed to be.',
        querystring: z.object({ t: z.string().min(16).max(2000) }),
        response: { 200: z.object({ storageKey: z.string() }) },
      },
    },
    async (request) => {
      const claim = verifyMediaToken(scope.env.BETTER_AUTH_SECRET, request.query.t);
      if (!claim || claim.u !== 'up' || !claim.c || !claim.m) throw errors.unauthorized();

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw errors.unsupportedMedia('Send the image as the request body');
      }

      const actual = sniffImageType(body);
      if (!actual) {
        throw errors.unsupportedMedia('That is not a JPEG, PNG, WebP or HEIC image');
      }
      if (actual !== claim.c) {
        throw errors.unsupportedMedia(
          `This link was issued for ${claim.c}, but the file is ${actual}`,
        );
      }

      if (body.length > claim.m) {
        const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
        throw errors.tooLarge(`That image is ${mb(body.length)}MB. The limit is ${mb(claim.m)}MB.`);
      }

      await scope.storage.put(claim.k, body, claim.c);
      return { storageKey: claim.k };
    },
  );
};
