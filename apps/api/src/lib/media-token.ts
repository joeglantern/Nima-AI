/**
 * A signed claim about one object in storage.
 *
 * When the bucket is not reachable by the outside world, which is the case
 * on a server where storage listens on loopback, the API serves the bytes
 * itself. The caller still needs something that says "this link is allowed
 * to fetch this key" or "this link may write this key, this big, this
 * type", because the phone's image loader and its upload do not carry the
 * session. A presigned S3 URL is exactly such a claim; this is the same
 * idea, signed by the API instead of by the bucket.
 *
 * The token is the claim in base64url followed by an HMAC of it. Nothing in
 * it is secret; the signature is what stops it being edited.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MediaClaim {
  /** Storage key. */
  k: string;
  /** `dl` to read it, `up` to write it. */
  u: 'dl' | 'up';
  /** Unix seconds after which the claim is dead. */
  e: number;
  /** Upload only: the content type the bytes must have. */
  c?: string;
  /** Upload only: the most bytes accepted. */
  m?: number;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signMediaToken(secret: string, claim: MediaClaim): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The claim, or null if the token is forged, damaged or expired. */
export function verifyMediaToken(secret: string, token: string): MediaClaim | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = sign(secret, payload);

  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;

  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as MediaClaim;
    if (typeof claim.k !== 'string' || (claim.u !== 'dl' && claim.u !== 'up')) return null;
    if (typeof claim.e !== 'number' || claim.e * 1000 < Date.now()) return null;
    return claim;
  } catch {
    return null;
  }
}
