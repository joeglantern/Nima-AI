/**
 * Authentication.
 *
 * Nima is usable without an account, so every visitor gets an anonymous user
 * row on first contact. Likes, cart, views and session personalisation hang
 * off that row, and `onLinkAccount` moves it all across when they sign up.
 *
 * Sign in methods, in the order the design shows them:
 *   Apple, Google, email (a six digit code, no password)
 *
 * There is no password login and no SMS. Passwords are a liability we do not
 * need, and every SMS costs money, so email codes and social sign in cover
 * everything. See docs/DECISIONS.md.
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { anonymous, emailOTP, magicLink } from 'better-auth/plugins';
import type { Env } from '@nima/config';
import type { PrismaClient } from '@nima/db';
import type { Mailer } from '../lib/mailer.js';
import { linkAnonymousAccount } from './link-anonymous.js';

export interface CreateAuthOptions {
  env: Env;
  prisma: PrismaClient;
  mailer: Mailer;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth({ env, prisma, mailer }: CreateAuthOptions) {
  const isDevelopment = env.NODE_ENV === 'development';

  return betterAuth({
    appName: 'Nima',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    // Passwords are not offered. Email codes and social sign in only.
    emailAndPassword: { enabled: false },

    trustedOrigins: [
      ...env.WEB_ORIGINS,
      'nima://',
      'nima://*',
      'https://appleid.apple.com',
      // Expo Go during development only.
      ...(isDevelopment ? ['exp://', 'exp://**', 'exp://192.168.*.*:*/**'] : []),
    ],

    session: {
      expiresIn: 60 * 60 * 24 * 30, // a month, so the app rarely signs people out
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 300 },
    },

    user: {
      additionalFields: {
        role: { type: 'string', input: false, defaultValue: 'USER' },
      },
      deleteUser: {
        enabled: true,
        // The heavy work (storage objects, orders, ledger) runs in a job.
        beforeDelete: async (user) => {
          await prisma.user.update({
            where: { id: user.id },
            data: { deletionRequestedAt: new Date() },
          });
        },
      },
    },

    advanced: {
      // Behind Caddy in production, so the proxy headers decide https.
      trustedProxyHeaders: !isDevelopment,
      useSecureCookies: !isDevelopment,
      cookiePrefix: 'nima',
      database: { joins: true },
    },

    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
        ? {
            apple: {
              clientId: env.APPLE_CLIENT_ID,
              clientSecret: env.APPLE_CLIENT_SECRET,
              // Native iOS sign in presents the bundle id as the audience.
              ...(env.APPLE_APP_BUNDLE_IDENTIFIER
                ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER }
                : {}),
            },
          }
        : {}),
    },

    plugins: [
      anonymous({
        emailDomainName: 'guest.nima.app',
        generateName: () => 'Guest',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await linkAnonymousAccount(prisma, anonymousUser.user.id, newUser.user.id);
        },
      }),

      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          await mailer.sendOtp({ to: email, code: otp, purpose: type });
        },
      }),

      // A tappable link, for people who find codes fiddly on a phone.
      magicLink({
        expiresIn: 600,
        async sendMagicLink({ email, url }) {
          await mailer.sendMagicLink({ to: email, url });
        },
      }),
    ],
  });
}
