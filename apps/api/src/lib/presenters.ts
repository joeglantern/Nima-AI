/**
 * Turning database rows into API shapes.
 *
 * Every response goes through a presenter. Two reasons:
 *
 *   1. Private fields cannot leak by accident. A row has an email, a payout
 *      number and a storage key on it; the public shape has none of those.
 *      The old codebase returned rows directly and leaked email, phone and
 *      address on a public profile.
 *   2. Storage keys become URLs in exactly one place, so private media is
 *      always signed and public media is always cached.
 */

import type { Storage } from './storage.js';

export interface ImageShape {
  url: string;
  width: number | null;
  height: number | null;
}

export function publicImage(
  storage: Storage,
  key: string | null | undefined,
  width?: number | null,
  height?: number | null,
): ImageShape | null {
  if (!key) return null;
  return { url: storage.publicUrl(key), width: width ?? null, height: height ?? null };
}

/** For media only the owner may see: user photos and try-on results. */
export async function privateImage(
  storage: Storage,
  key: string | null | undefined,
  width?: number | null,
  height?: number | null,
): Promise<ImageShape | null> {
  if (!key) return null;
  return {
    url: await storage.presignDownload(key),
    width: width ?? null,
    height: height ?? null,
  };
}

interface StoreRow {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  verifiedAt: Date | null;
  county: string | null;
}

export function storeCard(storage: Storage, store: StoreRow) {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    logo: publicImage(storage, store.logoKey),
    verified: store.verifiedAt !== null,
    county: store.county,
  };
}

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  category: string;
  priceFromCents: number;
  inStock: boolean;
  store: StoreRow;
  images: Array<{
    processedKey: string | null;
    originalKey: string;
    width: number | null;
    height: number | null;
  }>;
}

export function productCard(
  storage: Storage,
  product: ProductRow,
  options: { savedByMe?: boolean; promoted?: boolean } = {},
) {
  const first = product.images[0];

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    category: product.category as never,
    priceFromCents: product.priceFromCents,
    image: first
      ? publicImage(storage, first.processedKey ?? first.originalKey, first.width, first.height)
      : null,
    store: storeCard(storage, product.store),
    inStock: product.inStock,
    promoted: options.promoted ?? false,
    savedByMe: options.savedByMe ?? false,
  };
}

interface AuthorRow {
  id: string;
  profile: { handle: string; displayName: string; avatarKey: string | null } | null;
  store?: StoreRow | null;
}

export function lookAuthor(storage: Storage, user: AuthorRow | null) {
  if (!user?.profile) return null;

  return {
    id: user.id,
    handle: user.profile.handle,
    displayName: user.profile.displayName,
    avatar: publicImage(storage, user.profile.avatarKey),
    store: user.store ? storeCard(storage, user.store) : null,
  };
}

interface LookRow {
  id: string;
  title: string | null;
  caption: string | null;
  nimaSays: string | null;
  source: string;
  visibility: string;
  coverKey: string | null;
  width: number | null;
  height: number | null;
  likeCount: number;
  createdAt: Date;
  owner?: AuthorRow | null;
  _count?: { items: number; comments?: number };
}

export function lookCard(
  storage: Storage,
  look: LookRow,
  viewer: { likedByMe?: boolean; savedByMe?: boolean; promoted?: boolean } = {},
) {
  return {
    id: look.id,
    title: look.title,
    caption: look.caption,
    nimaSays: look.nimaSays,
    source: look.source as never,
    visibility: look.visibility as never,
    image: publicImage(storage, look.coverKey, look.width, look.height),
    author: lookAuthor(storage, look.owner ?? null),
    itemCount: look._count?.items ?? 0,
    likeCount: look.likeCount,
    commentCount: look._count?.comments ?? 0,
    likedByMe: viewer.likedByMe ?? false,
    savedByMe: viewer.savedByMe ?? false,
    // A look can be recreated when it is public and has at least one item.
    canRecreate: look.visibility === 'PUBLIC' && (look._count?.items ?? 0) > 0,
    promoted: viewer.promoted ?? false,
    createdAt: look.createdAt.toISOString(),
  };
}

interface OrderRow {
  id: string;
  reference: string;
  status: string;
  store: StoreRow;
  subtotalCents: number;
  deliveryCents: number;
  totalCents: number;
  placedAt: Date;
  deliveredAt: Date | null;
  completedAt: Date | null;
  items: Array<{
    id: string;
    productId: string;
    titleSnapshot: string;
    sizeSnapshot: string | null;
    colourSnapshot: string | null;
    imageSnapshot: string | null;
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
  }>;
  shipment: {
    status: string;
    trackingCode: string | null;
    pickupPointName: string | null;
    updatedAt: Date;
  } | null;
}

/**
 * An order, as the buyer sees it.
 *
 * Every line reads from the snapshot taken at purchase, never from the live
 * product. A seller who renames a dress or raises its price must not change
 * what someone already bought, and a product that is deleted must not empty
 * out an old receipt.
 */
export function order(storage: Storage, row: OrderRow) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status as never,
    store: storeCard(storage, row.store),
    items: row.items.map((item) => ({
      id: item.id,
      title: item.titleSnapshot,
      size: item.sizeSnapshot,
      colour: item.colourSnapshot,
      image: publicImage(storage, item.imageSnapshot),
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      totalCents: item.totalCents,
      productId: item.productId,
    })),
    subtotalCents: row.subtotalCents,
    deliveryCents: row.deliveryCents,
    totalCents: row.totalCents,
    placedAt: row.placedAt.toISOString(),
    shipment: row.shipment
      ? {
          status: row.shipment.status,
          trackingCode: row.shipment.trackingCode,
          pickupPointName: row.shipment.pickupPointName,
          updatedAt: row.shipment.updatedAt.toISOString(),
        }
      : null,
    // Reviewing something you have not received yet is not a review.
    canReview: row.deliveredAt !== null || row.completedAt !== null,
  };
}

interface WardrobeRow {
  id: string;
  label: string | null;
  category: string;
  slot: string;
  colours: string[];
  tags: string[];
  originalKey: string;
  cutoutKey: string | null;
  processing: string;
  visibility: string;
  createdAt: Date;
}

/**
 * Something a person owns.
 *
 * The photograph is private media even when the item is public, because a
 * wardrobe shot is taken in someone's bedroom. The cut out is preferred once
 * it exists, and the original stands in until then so an item is never a
 * blank square while the worker catches up.
 */
export async function wardrobeItem(storage: Storage, row: WardrobeRow) {
  return {
    id: row.id,
    label: row.label,
    category: row.category as never,
    slot: row.slot as never,
    colours: row.colours,
    tags: row.tags,
    image: await privateImage(storage, row.cutoutKey ?? row.originalKey),
    processing: row.processing === 'PENDING',
    visibility: row.visibility as never,
    createdAt: row.createdAt.toISOString(),
  };
}

interface LookbookRow {
  id: string;
  title: string;
  description: string | null;
  occasion: string | null;
  coverKey: string | null;
  visibility: string;
  startsOn: Date | null;
  endsOn: Date | null;
  updatedAt: Date;
  _count?: { entries: number };
}

export function lookbook(storage: Storage, row: LookbookRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    occasion: row.occasion,
    cover: publicImage(storage, row.coverKey),
    visibility: row.visibility as never,
    entryCount: row._count?.entries ?? 0,
    startsOn: row.startsOn ? row.startsOn.toISOString().slice(0, 10) : null,
    endsOn: row.endsOn ? row.endsOn.toISOString().slice(0, 10) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
