/**
 * The fixed sign in code for the app store reviewer's address.
 */

import { describe, expect, it } from 'vitest';
import { reviewSignIn } from '../src/auth/review-sign-in.js';

describe('reviewSignIn', () => {
  it('does not exist unless both the address and the code are set', () => {
    expect(reviewSignIn({})).toBeNull();
    expect(reviewSignIn({ REVIEW_SIGN_IN_EMAIL: 'review@example.test' })).toBeNull();
    expect(reviewSignIn({ REVIEW_SIGN_IN_CODE: '123456' })).toBeNull();
    expect(reviewSignIn({ REVIEW_SIGN_IN_EMAIL: '  ', REVIEW_SIGN_IN_CODE: '123456' })).toBeNull();
  });

  it('matches the address whatever the case or spacing, and nobody else', () => {
    const review = reviewSignIn({
      REVIEW_SIGN_IN_EMAIL: 'Review@Example.test',
      REVIEW_SIGN_IN_CODE: '246810',
    });
    expect(review).not.toBeNull();
    expect(review?.matches('review@example.test')).toBe(true);
    expect(review?.matches('  REVIEW@EXAMPLE.TEST ')).toBe(true);
    expect(review?.matches('reviewer@example.test')).toBe(false);
    expect(review?.code).toBe('246810');
  });

  it('refuses a code that the six digit screen could not take', () => {
    for (const code of ['12345', '1234567', 'abcdef', '12 345', '']) {
      const call = () =>
        reviewSignIn({ REVIEW_SIGN_IN_EMAIL: 'r@example.test', REVIEW_SIGN_IN_CODE: code });
      if (code === '') expect(call()).toBeNull();
      else expect(call).toThrow(/six digits/);
    }
  });
});
