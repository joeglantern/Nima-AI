/**
 * The reviewer's way in.
 *
 * App store reviewers sign in from a device that cannot read our email, so
 * one address, named in the environment, is given a fixed code instead of
 * a mailed one. Nothing else about that account is special: it is an
 * ordinary user with ordinary limits, and the code is only ever compared,
 * never logged or returned.
 *
 * Both variables must be set for this to exist at all. Unset either and
 * every address gets a mailed code, the reviewer's included.
 */

export interface ReviewSignIn {
  /** True for the one address the fixed code applies to. */
  matches(email: string): boolean;
  /** The code that address signs in with. */
  code: string;
}

export const REVIEW_CODE_PATTERN = /^\d{6}$/;

export function reviewSignIn(env: {
  REVIEW_SIGN_IN_EMAIL?: string | undefined;
  REVIEW_SIGN_IN_CODE?: string | undefined;
}): ReviewSignIn | null {
  const email = env.REVIEW_SIGN_IN_EMAIL?.trim().toLowerCase();
  const code = env.REVIEW_SIGN_IN_CODE?.trim();
  if (!email || !code) return null;
  if (!REVIEW_CODE_PATTERN.test(code)) {
    throw new Error('REVIEW_SIGN_IN_CODE must be six digits, the length the code screen takes');
  }

  return {
    code,
    matches: (candidate) => candidate.trim().toLowerCase() === email,
  };
}
