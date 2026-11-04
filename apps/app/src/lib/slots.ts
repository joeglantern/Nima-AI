const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

/**
 * Sizes in the order a shop lists them: letters small to large, then
 * numbers ascending, then anything else as it came. Sellers add sizes in
 * whatever order they think of them, and "L M S XL" reads wrong.
 */
export function sortBySize<T extends { size: string | null }>(variants: readonly T[]): T[] {
  const rank = (variant: T): [number, number] => {
    const size = (variant.size ?? '').trim().toUpperCase();
    const letter = SIZE_ORDER.indexOf(size);
    if (letter >= 0) return [0, letter];
    const number = Number.parseFloat(size);
    if (!Number.isNaN(number)) return [1, number];
    return [2, 0];
  };
  return [...variants]
    .map((variant, index) => ({ variant, index, key: rank(variant) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index)
    .map((entry) => entry.variant);
}

/** Which part of the body a shop category belongs to, for a try-on. */
export function slotFor(category: string | undefined): string {
  switch (category) {
    case 'BOTTOM':
      return 'BOTTOM';
    case 'DRESS':
      return 'FULL_BODY';
    case 'OUTERWEAR':
      return 'OUTERWEAR';
    case 'SHOES':
      return 'SHOES';
    case 'BAG':
      return 'BAG';
    case 'JEWELLERY':
      return 'JEWELLERY';
    case 'EYEWEAR':
      return 'EYEWEAR';
    case 'HEADWEAR':
      return 'HEADWEAR';
    default:
      return 'TOP';
  }
}
