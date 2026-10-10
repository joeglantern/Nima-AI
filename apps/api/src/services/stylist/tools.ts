/**
 * What Nima can actually do.
 *
 * The model chooses a tool and the arguments. Our code runs the query and
 * returns real rows from the catalogue. That split is the whole design: the
 * model is good at reading intent out of a sentence and bad at knowing what
 * is in stock in Nairobi this week.
 */

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@nima/db';
import type { ToolDefinition } from '../llm.js';

export const STYLIST_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Find clothes for sale on Nima. Use this before suggesting anything to buy. ' +
        'Prices are in Kenyan shillings.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free text, for example "linen shirt" or "red dress"',
          },
          category: {
            type: 'string',
            enum: [
              'TOP',
              'BOTTOM',
              'DRESS',
              'OUTERWEAR',
              'SHOES',
              'BAG',
              'JEWELLERY',
              'EYEWEAR',
              'HEADWEAR',
              'ACCESSORY',
            ],
          },
          occasion: { type: 'string', description: 'wedding, work, weekend, date night' },
          colour: { type: 'string' },
          maxShillings: { type: 'number', description: 'Budget per piece, in whole shillings' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_wardrobe',
      description: "Look through clothes this person already owns.",
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          colour: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_outfit',
      description:
        'Put chosen pieces together into a look the person can save and try on. ' +
        'Only use ids returned by a previous search.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Three or four words' },
          why: { type: 'string', description: 'One short sentence on why it works' },
          productIds: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          wardrobeItemIds: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        },
        required: ['title', 'productIds'],
      },
    },
  },
];

export interface ToolResult {
  /** Fed back to the model. Kept small: ids, names, prices, nothing else. */
  forModel: string;
  /** Attached to the reply so the app can render real cards. */
  productIds: string[];
  lookId?: string;
}

export async function runStylistTool(
  app: FastifyInstance,
  userId: string,
  name: string,
  rawArguments: string,
): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || '{}') as Record<string, unknown>;
  } catch {
    return { forModel: 'Those arguments were not valid JSON.', productIds: [] };
  }

  switch (name) {
    case 'search_products':
      return searchProducts(app, args);
    case 'search_wardrobe':
      return searchWardrobe(app, userId, args);
    case 'build_outfit':
      return buildOutfit(app, userId, args);
    default:
      return { forModel: `There is no tool called ${name}.`, productIds: [] };
  }
}

async function searchProducts(
  app: FastifyInstance,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query : undefined;
  const category = typeof args.category === 'string' ? args.category : undefined;
  const occasion = typeof args.occasion === 'string' ? args.occasion.toLowerCase() : undefined;
  const colour = typeof args.colour === 'string' ? args.colour.toLowerCase() : undefined;
  const maxCents =
    typeof args.maxShillings === 'number' ? Math.round(args.maxShillings * 100) : undefined;

  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    inStock: true,
    ...(category ? { category: category as never } : {}),
    ...(occasion ? { occasions: { has: occasion } } : {}),
    ...(colour ? { colours: { has: colour } } : {}),
    ...(maxCents ? { priceFromCents: { lte: maxCents } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { tags: { has: query.toLowerCase() } },
          ],
        }
      : {}),
  };

  const products = await app.prisma.product.findMany({
    where,
    take: 8,
    orderBy: { publishedAt: 'desc' },
    include: { store: { select: { name: true } } },
  });

  if (products.length === 0) {
    return { forModel: 'Nothing in the catalogue matches that.', productIds: [] };
  }

  const lines = products.map(
    (product) =>
      `${product.id} | ${product.title} | ${product.category} | KSh ${Math.round(product.priceFromCents / 100)} | ${product.store.name}`,
  );

  return {
    forModel: `Found ${products.length}:\n${lines.join('\n')}`,
    productIds: products.map((product) => product.id),
  };
}

async function searchWardrobe(
  app: FastifyInstance,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const category = typeof args.category === 'string' ? args.category : undefined;
  const colour = typeof args.colour === 'string' ? args.colour.toLowerCase() : undefined;

  const items = await app.prisma.wardrobeItem.findMany({
    where: {
      userId,
      ...(category ? { category: category as never } : {}),
      ...(colour ? { colours: { has: colour } } : {}),
    },
    take: 15,
  });

  if (items.length === 0) {
    return {
      forModel: 'Their wardrobe is empty, or nothing matches. Suggest from the catalogue.',
      productIds: [],
    };
  }

  const lines = items.map(
    (item) => `${item.id} | ${item.label ?? item.category} | ${item.colours.join('/')}`,
  );

  return { forModel: `They own:\n${lines.join('\n')}`, productIds: [] };
}

async function buildOutfit(
  app: FastifyInstance,
  userId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const title = typeof args.title === 'string' ? args.title.slice(0, 80) : 'A look for you';
  const why = typeof args.why === 'string' ? args.why.slice(0, 300) : null;

  const productIds = Array.isArray(args.productIds)
    ? args.productIds.filter((id): id is string => typeof id === 'string').slice(0, 5)
    : [];
  const wardrobeItemIds = Array.isArray(args.wardrobeItemIds)
    ? args.wardrobeItemIds.filter((id): id is string => typeof id === 'string').slice(0, 5)
    : [];

  if (productIds.length === 0 && wardrobeItemIds.length === 0) {
    return { forModel: 'A look needs at least one piece.', productIds: [] };
  }

  // Only ids that really exist, and wardrobe items that belong to this person.
  const [products, owned] = await Promise.all([
    app.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'ACTIVE' },
      select: { id: true, category: true, title: true },
    }),
    app.prisma.wardrobeItem.findMany({
      where: { id: { in: wardrobeItemIds }, userId },
      select: { id: true, slot: true },
    }),
  ]);

  if (products.length === 0 && owned.length === 0) {
    return { forModel: 'None of those ids exist. Search again before building a look.', productIds: [] };
  }

  const look = await app.prisma.look.create({
    data: {
      ownerId: userId,
      title,
      nimaSays: why,
      source: 'AI',
      visibility: 'PRIVATE',
      items: {
        create: [
          ...products.map((product, index) => ({
            slot: slotForCategory(product.category),
            productId: product.id,
            position: index,
          })),
          ...owned.map((item, index) => ({
            slot: item.slot,
            wardrobeItemId: item.id,
            position: products.length + index,
          })),
        ],
      },
    },
  });

  return {
    forModel: `Look saved as "${title}". Tell them it is ready and they can try it on.`,
    productIds: products.map((product) => product.id),
    lookId: look.id,
  };
}

function slotForCategory(category: string) {
  switch (category) {
    case 'BOTTOM':
      return 'BOTTOM' as const;
    case 'DRESS':
      return 'FULL_BODY' as const;
    case 'OUTERWEAR':
      return 'OUTERWEAR' as const;
    case 'SHOES':
      return 'SHOES' as const;
    case 'BAG':
      return 'BAG' as const;
    case 'JEWELLERY':
      return 'JEWELLERY' as const;
    case 'EYEWEAR':
      return 'EYEWEAR' as const;
    case 'HEADWEAR':
      return 'HEADWEAR' as const;
    default:
      return 'TOP' as const;
  }
}
