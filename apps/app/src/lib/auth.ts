/**
 * Sign in.
 *
 * Three ways in, in the order the design shows them: Apple, Google, email.
 * No passwords. A visitor who has not chosen any of them still gets a guest
 * session, created on first launch, so the app works straight away.
 */

import { expoClient } from '@better-auth/expo/client';
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
      storage: sessionStorage,
    }),
    anonymousClient(),
    emailOTPClient(),
    magicLinkClient(),
  ],
});

export const { useSession, signOut } = authClient;

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
