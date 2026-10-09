/**
 * pgvector helpers.
 *
 * Prisma cannot read or write vector columns yet, so every vector operation
 * goes through raw SQL. Keeping it in one file means the raw queries are
 * reviewed together and the rest of the codebase stays type safe.
 *
 * All embeddings are 768 dimensions, produced by Marqo FashionSigLIP.
 */

import { Prisma, type PrismaClient } from '../generated/client/index.js';

export const EMBEDDING_DIMENSIONS = 768;

export type VectorColumn = 'embedding' | 'tasteEmbedding';

export type VectorTable = 'products' | 'looks' | 'wardrobe_items' | 'style_profiles';

export class InvalidEmbeddingError extends Error {
  constructor(received: number) {
    super(`Embedding must have ${EMBEDDING_DIMENSIONS} dimensions, received ${received}`);
    this.name = 'InvalidEmbeddingError';
  }
}

/** Postgres accepts a vector literal as '[0.1,0.2,...]'. */
export function toVectorLiteral(values: readonly number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new InvalidEmbeddingError(values.length);
  }
  return `[${values.join(',')}]`;
}

/**
 * Store an embedding. The table and column are not user input: they are
 * narrowed by the union types above, so the interpolation is safe.
 */
export async function setEmbedding(
  client: PrismaClient,
  table: VectorTable,
  column: VectorColumn,
  id: string,
  embedding: readonly number[],
): Promise<void> {
  const literal = toVectorLiteral(embedding);
  const idColumn = table === 'style_profiles' ? 'userId' : 'id';

  await client.$executeRawUnsafe(
    `UPDATE "${table}" SET "${column}" = $1::vector WHERE "${idColumn}" = $2`,
    literal,
    id,
  );
}

export interface SimilarRow {
  id: string;
  distance: number;
}

/**
 * Nearest neighbours by cosine distance, smallest first.
 *
 * `filterSql` is composed with Prisma.sql by the caller so that user supplied
 * values stay parameterised. Pass Prisma.empty when there is no filter.
 */
export async function findSimilar(
  client: PrismaClient,
  table: Extract<VectorTable, 'products' | 'looks' | 'wardrobe_items'>,
  embedding: readonly number[],
  options: { limit?: number; filterSql?: Prisma.Sql } = {},
): Promise<SimilarRow[]> {
  const literal = toVectorLiteral(embedding);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 200);
  const filter = options.filterSql ?? Prisma.empty;

  const rows = await client.$queryRaw<Array<{ id: string; distance: number }>>(
    Prisma.sql`
      SELECT "id", ("embedding" <=> ${literal}::vector) AS distance
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE "embedding" IS NOT NULL
      ${filter}
      ORDER BY "embedding" <=> ${literal}::vector
      LIMIT ${limit}
    `,
  );

  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}

/** Read a stored taste vector back out, for blending with new signals. */
export async function getTasteEmbedding(
  client: PrismaClient,
  userId: string,
): Promise<number[] | null> {
  const rows = await client.$queryRaw<Array<{ embedding: string | null }>>(
    Prisma.sql`
      SELECT "tasteEmbedding"::text AS embedding
      FROM "style_profiles"
      WHERE "userId" = ${userId}
    `,
  );

  const raw = rows[0]?.embedding;
  if (!raw) return null;

  return raw
    .slice(1, -1)
    .split(',')
    .map((part) => Number.parseFloat(part));
}
