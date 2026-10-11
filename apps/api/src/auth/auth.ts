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

import { expo } from '@better-auth/expo';
import type { Env } from '@nima/config';
import { AUTH_COOKIE_PREFIX } from '@nima/contracts';
import type { PrismaClient } from '@nima/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { anonymous, emailOTP, magicLink } from 'better-auth/plugins';
import type { Mailer } from '../lib/mailer.js';
import { resolveEmail } from './email.js';
import { linkAnonymousAccount } from './link-anonymous.js';
import { recordMailAttempt, recordMailFailure } from './mail-outcome.js';

export interface CreateAuthOptions {
  env: Env;
  prisma: PrismaClient;
  mailer: Mailer;
  /**
   * Whether one more code may be sent to this address right now. The
   * built in limiter counts per network address, which a tunnel or a
   * shared Wi-Fi turns into one bucket for everybody; this one counts
   * per inbox, which is what is actually being flooded.
   */
  otpAllowed?: (email: string) => Promise<boolean>;
}

/** Codes per address in ten minutes. Enough for a typo and a retry. */
export const OTP_PER_EMAIL = 5;

export type Auth = ReturnType<typeof createAuth>;

export function createAuth({ env, prisma, mailer, otpAllowed }: CreateAuthOptions) {
  const isDevelopment = env.NODE_ENV === 'development';

  /**
   * Whether the session cookie is marked Secure.
   *
   * Read from the scheme Nima is actually served over rather than from the
   * environment name, because that is what the flag describes. The two come
   * apart when a production build is reached over a tunnel on localhost for
   * testing: the cookie would be marked Secure, which is a promise the
   * connection is not keeping.
   *
   * This only ever relaxes for a loopback address. Any other host without
   * https keeps the Secure flag and so fails loudly, which is the right
   * outcome: it means someone is about to serve real sessions in the clear.
   */
  const publicUrl = env.BETTER_AUTH_URL;
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(publicUrl);
  const useSecureCookies = publicUrl.startsWith('https://') || !isLoopback;

  return betterAuth({
    appName: 'Nima',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    /*
     * Accounts are opened with a code, which proves the address. A password
     * is something a person may add afterwards, from Settings, for signing
     * in without waiting on an email. So password sign in is on and
     * password sign up is not.
     */
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },

    rateLimit: {
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 6 },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as { email?: unknown } | undefined;
        if (!body || typeof body.email !== 'string') return;

        const takesEmail =
          ctx.path.startsWith('/email-otp/') ||
          ctx.path === '/forget-password/email-otp' ||
          ctx.path === '/sign-in/email-otp' ||
          ctx.path === '/sign-in/email' ||
          ctx.path === '/sign-in/magic-link';
        if (!takesEmail) return;

        // One inbox, one account, whatever Gmail decoration was typed.
        const email = await resolveEmail(prisma, body.email);

        if (ctx.path === '/email-otp/send-verification-otp' && otpAllowed) {
          if (!(await otpAllowed(email))) {
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'That address has had enough codes for now. Try again in a few minutes.',
            });
          }
        }

        return { context: { body: { ...body, email } } };
      }),
    },

    databaseHooks: {
      session: {
        create: {
          // Signing in is how a deletion is called off, as the app promises.
          after: async (session) => {
            await prisma.user.updateMany({
              where: { id: session.userId, deletionRequestedAt: { not: null } },
              data: { deletionRequestedAt: null },
            });
          },
        },
      },
    },

    trustedOrigins: [
      ...env.WEB_ORIGINS,
      'nima://',
      'nima://*',
      'https://appleid.apple.com',
      // Expo Go during development only.
      ...(isDevelopment || env.TRUST_EXPO_GO
        ? ['exp://', 'exp://**', 'exp://192.168.*.*:*/**']
        : []),
    ],

    session: {
      expiresIn: 60 * 60 * 24 * 30, // a month, so the app rarely signs people out
      updateAge: 60 * 60 * 24,
      // A minute. Longer and a sign out elsewhere takes that long to land here.
      cookieCache: { enabled: true, maxAge: 60 },
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
      // Behind a reverse proxy in production, so the forwarded headers
      // decide https.
      trustedProxyHeaders: !isDevelopment,
      useSecureCookies,
      cookiePrefix: AUTH_COOKIE_PREFIX,
      database: { joins: true },
      /**
       * Where the caller's address comes from.
       *
       * Without this every request behind the proxy looks like it came from
       * the proxy, and rate limiting falls back to one shared bucket: a
       * single person hammering sign in locks out everybody else. The header
       * is only trusted because nothing reaches this process except through
       * the proxy on the same host.
       */
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      },
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
      /*
       * The app on a phone has no Origin header. It sends `expo-origin`
       * instead, carrying the app scheme (nima://) or, inside Expo Go, the
       * exp:// address of the dev server. This plugin reads that header,
       * checks it against the trusted origins and treats it as the origin.
       * Without it every sign in from a device is refused as having no
       * origin, which development mode hid by being lenient.
       */
      expo(),

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
          // Better Auth swallows whatever happens in here, so the outcome
          // is recorded against the request and the route reads it after.
          recordMailAttempt();

          try {
            await mailer.sendOtp({ to: email, code: otp, purpose: type });
          } catch (error) {
            recordMailFailure(
              error instanceof Error ? error.message : 'That code could not be sent',
            );
            throw error;
          }
        },
      }),

      // A tappable link, for people who find codes fiddly on a phone.
      magicLink({
        expiresIn: 600,
        async sendMagicLink({ email, url }) {
          recordMailAttempt();

          try {
            await mailer.sendMagicLink({ to: email, url });
          } catch (error) {
            recordMailFailure(
              error instanceof Error ? error.message : 'That link could not be sent',
            );
            throw error;
          }
        },
      }),
    ],
  });
}
