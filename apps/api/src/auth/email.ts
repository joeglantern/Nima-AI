/**
 * One address, one account.
 *
 * Better Auth lowercases every address, and the database refuses two rows
 * with the same one. That still leaves Gmail, which treats dots in the local
 * part and anything after a plus as decoration: afosi.2025, afosi2025 and
 * afosi.2025+nima are the same inbox, receive the same code, and each used
 * to open its own account.
 *
 * The rule here: an address typed at sign in is first matched against the
 * accounts that already exist, allowing for Gmail's decoration. If one is
 * found, that stored address is used, so nobody is locked out of an account
 * they already have. If none is found, the address is stored in its plain
 * form, so no second account can be opened on a variant later.
 */

import type { PrismaClient } from '@nima/db';

const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** Lowercased, trimmed, and for Gmail stripped of dots and plus tags. */
export function canonicalEmail(typed: string): string {
  const email = typed.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!GMAIL.has(domain)) return email;

  const plus = local.indexOf('+');
  const bare = (plus >= 0 ? local.slice(0, plus) : local).replace(/\./g, '');
  return `${bare}@gmail.com`;
}

/** The address to carry on with: an existing account's, or the plain form. */
export async function resolveEmail(prisma: PrismaClient, typed: string): Promise<string> {
  const lowered = typed.trim().toLowerCase();
  const canonical = canonicalEmail(lowered);

  // Exact first: the common case, and one query.
  const exact = await prisma.user.findUnique({
    where: { email: lowered },
    select: { email: true },
  });
  if (exact) return exact.email;

  if (canonical === lowered) return canonical;

  // A Gmail variant. Any account whose address boils down to the same
  // inbox is the account this person means; the oldest wins if, through
  // the old bug, there is more than one.
  const [local] = canonical.split('@');
  const candidates = await prisma.user.findMany({
    where: {
      OR: [{ email: { endsWith: '@gmail.com' } }, { email: { endsWith: '@googlemail.com' } }],
      isAnonymous: false,
    },
    select: { email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const match = candidates.find(
    (candidate) => canonicalEmail(candidate.email) === `${local}@gmail.com`,
  );
  return match?.email ?? canonical;
}
