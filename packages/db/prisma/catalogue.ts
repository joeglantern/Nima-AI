/**
 * A catalogue big enough to judge the shop by.
 *
 * Seven products cannot tell you whether the masonry reads, whether the
 * category filter is worth having, or what the feed looks like once it is
 * not showing the same two things. So the seed builds a few dozen from the
 * photographs that `scripts/fetch-garments.mjs` collected.
 *
 * The names and prices are written here rather than taken from the
 * pictures. A museum calls something "Evening dress, 1954, House of Dior",
 * which is true and useless to a shopper in Nairobi, and the point of the
 * seed is to look like the shop this is meant to be. Where each photograph
 * actually came from is in the manifest beside it.
 */

export interface SeedProduct {
  slug: string;
  title: string;
  category: string;
  slot: string;
  description: string;
  colours: string[];
  tags: string[];
  occasions: string[];
  price: number;
  sizes: string[];
  image: string;
}

/** Words that read like a Nairobi rail, not a museum label. */
const NAMES: Record<string, string[]> = {
  TOP: [
    'Linen camp shirt',
    'Poplin oversized shirt',
    'Ribbed knit top',
    'Kitenge trim blouse',
    'Boxy cotton tee',
    'Cropped cardigan',
    'Silk shell top',
    'Panelled rugby shirt',
    'Gauze overshirt',
    'Merino crew knit',
  ],
  BOTTOM: [
    'Wide leg trouser',
    'Pleated midi skirt',
    'Tapered chino',
    'Drawstring linen trouser',
    'Denim column skirt',
    'Cargo utility short',
    'Straight leg jean',
    'Satin slip skirt',
  ],
  DRESS: [
    'Wrap midi dress',
    'Kitenge column dress',
    'Tiered cotton dress',
    'Bias cut slip dress',
    'Shirt dress',
    'Puff sleeve dress',
    'Halter maxi dress',
    'Smocked sundress',
    'Belted shift dress',
    'Draped evening dress',
    'Quilted pinafore',
    'Linen tank dress',
  ],
  OUTERWEAR: [
    'Unlined safari jacket',
    'Cropped denim jacket',
    'Wool overcoat',
    'Quilted bomber',
    'Canvas chore coat',
    'Trench with belt',
    'Shearling collar jacket',
    'Lightweight anorak',
  ],
  SHOES: [
    'Leather court shoe',
    'Woven flat sandal',
    'Suede desert boot',
    'Canvas low top',
    'Strappy block heel',
    'Leather loafer',
    'Chunky trainer',
    'Ankle boot',
  ],
  BAG: [
    'Structured top handle',
    'Woven market tote',
    'Leather crossbody',
    'Beaded clutch',
    'Soft bucket bag',
    'Canvas weekender',
  ],
  JEWELLERY: [
    'Brass collar necklace',
    'Beaded drop earring',
    'Hammered cuff',
    'Layered chain',
    'Enamel brooch',
  ],
  HEADWEAR: [
    'Woven sun hat',
    'Structured bucket hat',
    'Silk headwrap',
    'Wool beret',
    'Raffia visor',
  ],
};

const COPY: Record<string, string> = {
  TOP: 'Cut for the heat, with room through the shoulder and a hem that sits right untucked.',
  BOTTOM: 'A clean line from the waist, in a cloth that holds its shape through a long day.',
  DRESS: 'One piece, no thinking. Works with flats in the afternoon and heels after six.',
  OUTERWEAR: 'For the cold hour at either end of the day, light enough to carry the rest of it.',
  SHOES: 'Built to be walked in, not just photographed. Leather softens to the foot.',
  BAG: 'Takes a laptop, a water bottle and the rest of it without losing its shape.',
  JEWELLERY: 'Made by hand, so no two are quite the same.',
  HEADWEAR: 'Real shade, and it packs flat.',
};

const SLOTS: Record<string, string> = {
  TOP: 'TOP',
  BOTTOM: 'BOTTOM',
  DRESS: 'FULL_BODY',
  OUTERWEAR: 'OUTERWEAR',
  SHOES: 'SHOES',
  BAG: 'BAG',
  JEWELLERY: 'JEWELLERY',
  HEADWEAR: 'HEADWEAR',
};

/** Realistic Nairobi retail, in whole shillings. */
const PRICES: Record<string, [number, number]> = {
  TOP: [1800, 6500],
  BOTTOM: [2500, 8500],
  DRESS: [3500, 14_000],
  OUTERWEAR: [4500, 18_000],
  SHOES: [3000, 12_000],
  BAG: [2500, 11_000],
  JEWELLERY: [900, 5500],
  HEADWEAR: [1200, 4000],
};

const COLOURS = [
  ['black'],
  ['cream', 'white'],
  ['brown', 'tan'],
  ['rust'],
  ['olive'],
  ['navy'],
  ['burgundy'],
  ['sand'],
  ['indigo'],
  ['grey'],
];

const OCCASIONS = [
  ['work', 'office'],
  ['weekend'],
  ['wedding', 'celebration'],
  ['date night'],
  ['travel'],
  ['church'],
  ['going out'],
];

const SIZES: Record<string, string[]> = {
  SHOES: ['38', '39', '40', '41', '42', '43'],
  JEWELLERY: ['One size'],
  HEADWEAR: ['One size'],
  BAG: ['One size'],
};

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

/**
 * Price rounded to something a shop would actually print.
 *
 * Nobody writes 4,137. They write 4,200.
 */
function priceFor(category: string, index: number): number {
  const [low, high] = PRICES[category] ?? [2000, 8000];
  const spread = high - low;
  // Spread deterministically across the band so a reseed does not reshuffle
  // every price in the shop.
  const raw = low + ((index * 2654_435_761) % spread);
  return Math.round(raw / 100) * 100;
}

function slugify(value: string, index: number): string {
  return `${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${index}`;
}

export interface GarmentImage {
  file: string;
  category: string;
}

/** Build a product for each photograph that was collected. */
export function catalogueFrom(images: GarmentImage[]): SeedProduct[] {
  const counters = new Map<string, number>();
  const products: SeedProduct[] = [];

  for (const [index, image] of images.entries()) {
    const category = image.category.toUpperCase();
    const names = NAMES[category];
    if (!names) continue;

    const seen = counters.get(category) ?? 0;
    counters.set(category, seen + 1);

    const title = names[seen % names.length] ?? 'Piece';

    products.push({
      slug: slugify(title, index + 1),
      title,
      category,
      slot: SLOTS[category] ?? 'TOP',
      description: COPY[category] ?? 'A good piece, well made.',
      colours: COLOURS[index % COLOURS.length] ?? ['black'],
      tags: [category.toLowerCase()],
      occasions: OCCASIONS[index % OCCASIONS.length] ?? ['weekend'],
      price: priceFor(category, index + 1),
      sizes: SIZES[category] ?? DEFAULT_SIZES,
      image: image.file,
    });
  }

  return products;
}
