/**
 * Ask Nima without the model.
 *
 * Used when the stylist model is unreachable. It reads the obvious things out
 * of the sentence, budget, occasion, colour, category, runs the same search
 * the model would have run, and writes a short reply from a template.
 *
 * It is plainer than the model, and it is honest: real products, real prices,
 * no invention. Most of what people ask an AI stylist is "something for X
 * under Y", which this answers perfectly well.
 */

import type { Prisma } from '@nima/db';
import type { FastifyInstance } from 'fastify';

const CATEGORY_WORDS: Array<[RegExp, string]> = [
  [/\b(shirt|top|blouse|tee|t-shirt|hoodie|sweater|knit)\b/i, 'TOP'],
  [/\b(trouser|pant|jean|short|skirt|cargo)\b/i, 'BOTTOM'],
  [/\b(dress|gown|kitenge dress)\b/i, 'DRESS'],
  [/\b(jacket|coat|blazer|outerwear)\b/i, 'OUTERWEAR'],
  [/\b(shoe|sneaker|heel|boot|sandal|loafer)\b/i, 'SHOES'],
  [/\b(bag|purse|backpack|tote)\b/i, 'BAG'],
  [/\b(necklace|earring|bracelet|jewellery|jewelry|chain)\b/i, 'JEWELLERY'],
  [/\b(sunglasses|shades|glasses|eyewear)\b/i, 'EYEWEAR'],
  [/\b(hat|cap|headwrap|headwear)\b/i, 'HEADWEAR'],
];

const OCCASION_WORDS = [
  'wedding',
  'work',
  'office',
  'weekend',
  'date night',
  'church',
  'travel',
  'party',
  'festival',
  'holiday',
];

const COLOUR_WORDS = [
  'black',
  'white',
  'cream',
  'brown',
  'olive',
  'navy',
  'blue',
  'red',
  'burgundy',
  'rust',
  'gold',
  'green',
  'pink',
  'grey',
];

export interface FallbackAnswer {
  text: string;
  productIds: string[];
}

export async function answerWithoutModel(
  app: FastifyInstance,
  input: { userId: string; message: string; context?: { occasion?: string } },
): Promise<FallbackAnswer> {
  const message = input.message.toLowerCase();

  const category = CATEGORY_WORDS.find(([pattern]) => pattern.test(message))?.[1];
  const occasion = input.context?.occasion ?? OCCASION_WORDS.find((word) => message.includes(word));
  const colour = COLOUR_WORDS.find((word) => message.includes(word));

  // "under 3000", "under ksh 3,000", "below 5k"
  const budgetMatch = message.match(
    /(?:under|below|less than|max)\s*(?:ksh|kes)?\s*([\d,]+)\s*(k)?/i,
  );
  let maxCents: number | undefined;

  if (budgetMatch?.[1]) {
    const digits = Number.parseInt(budgetMatch[1].replace(/,/g, ''), 10);
    const shillings = budgetMatch[2] ? digits * 1000 : digits;
    if (Number.isFinite(shillings) && shillings > 0) maxCents = shillings * 100;
  }

  // Fall back to what they told us in the questionnaire.
  if (!maxCents) {
    const style = await app.prisma.styleProfile.findUnique({
      where: { userId: input.userId },
      select: { budgetMaxCents: true, favouriteColours: true, occasions: true },
    });
    if (style?.budgetMaxCents) maxCents = style.budgetMaxCents;
  }

  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    inStock: true,
    ...(category ? { category: category as never } : {}),
    ...(occasion ? { occasions: { has: occasion } } : {}),
    ...(colour ? { colours: { has: colour } } : {}),
    ...(maxCents ? { priceFromCents: { lte: maxCents } } : {}),
  };

  let products = await app.prisma.product.findMany({
    where,
    take: 6,
    orderBy: { publishedAt: 'desc' },
    include: { store: { select: { name: true } } },
  });

  // Nothing matched every filter: drop the colour, then the occasion.
  if (products.length === 0) {
    products = await app.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        inStock: true,
        ...(category ? { category: category as never } : {}),
        ...(maxCents ? { priceFromCents: { lte: maxCents } } : {}),
      },
      take: 6,
      orderBy: { publishedAt: 'desc' },
      include: { store: { select: { name: true } } },
    });
  }

  if (products.length === 0) {
    return {
      text: 'Nothing in the shop matches that yet. Try a wider budget, or tell me the occasion and I will look again.',
      productIds: [],
    };
  }

  const parts: string[] = [];
  const first = products[0];

  if (occasion) parts.push(`For ${occasion}`);
  else if (category) parts.push('Here is what fits');
  else parts.push('Here is what I would start with');

  if (maxCents) parts.push(`under KSh ${Math.round(maxCents / 100).toLocaleString('en-KE')}`);

  const opener = `${parts.join(' ')}.`;
  const detail = first
    ? ` The ${first.title.toLowerCase()} from ${first.store.name} is the one I would pick first.`
    : '';

  return {
    text: `${opener}${detail}`,
    productIds: products.map((product) => product.id),
  };
}
