/**
 * Sign in.
 *
 * Three ways in, in the order the design shows them: Apple, Google, email.
 * Passwords exist, but only as something added later. A visitor who has not chosen any of them still gets a guest
 * session, created on first launch, so the app works straight away.
 */

import { expoClient } from '@better-auth/expo/client';
import { AUTH_COOKIE_PREFIX } from '@nima/contracts';
import { anonymousClient, emailOTPClient, magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { API_URL } from './config';
import { sessionStorage } from './session-storage';

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: 'nima',
      storagePrefix: 'nima',
      // Must match the server, or the client never stores the session.
      cookiePrefix: AUTH_COOKIE_PREFIX,
      storage: sessionStorage,
    }),
    anonymousClient(),
    emailOTPClient(),
    magicLinkClient(),
  ],
});

export const { useSession } = authClient;

/**
 * Sign out, and straight back in as a guest.
 *
 * Nima works without an account, and a person who has just signed out is
 * exactly that: a visitor. Without a guest session every like, save and
 * cart change failed until the next launch, which is what used to happen.
 */
export async function signOut(): Promise<void> {
  await authClient.signOut();
  await authClient.signIn.anonymous();
}

/**
 * Make sure there is some session, creating a guest one if needed.
 *
 * Called once at launch. Everything a visitor does, the looks they like, what
 * goes in their cart, what the feed learns, hangs off this guest account and
 * moves across intact when they sign up.
 */
export async function ensureGuestSession(): Promise<void> {
  const session = await authClient.getSession();
  if (session.data?.user) return;

  await authClient.signIn.anonymous();
}

export async function sendEmailCode(email: string): Promise<void> {
  const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
  if (result.error) throw new Error(result.error.message ?? 'That email did not go through');
}

export async function verifyEmailCode(email: string, otp: string): Promise<void> {
  const result = await authClient.signIn.emailOtp({ email, otp });
  if (result.error) {
    throw new Error(
      result.error.code === 'INVALID_OTP'
        ? 'That code is not right. Check it and try again.'
        : (result.error.message ?? 'That did not work'),
    );
  }
}

export async function signInWithGoogle(): Promise<void> {
  await authClient.signIn.social({ provider: 'google', callbackURL: 'nima://' });
}

export async function signInWithApple(): Promise<void> {
  await authClient.signIn.social({ provider: 'apple', callbackURL: 'nima://' });
}

/**
 * The password way in, for people who have set one.
 *
 * Accounts are still opened with a code, which proves the address. A
 * password is something a person adds afterwards, in Settings, so the
 * errors here say that rather than "invalid credentials".
 */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const result = await authClient.signIn.email({ email, password });
  if (result.error) {
    const code = result.error.code ?? '';
    if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
      throw new Error(
        'That email and password do not match. If you have not set a password yet, use a code.',
      );
    }
    throw new Error(result.error.message ?? 'That did not work');
  }
}
