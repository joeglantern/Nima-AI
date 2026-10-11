/**
 * The API client.
 *
 * A thin wrapper over fetch that does four things the app needs everywhere:
 * sends the session, carries the guest id so a visitor still gets a
 * personalised feed, turns the API's error shape into a typed error, and
 * keeps the base URL in one place.
 *
 * Response types come from @nima/contracts, so the client cannot drift from
 * the server.
 */

import type {
  cartSchema,
  checkoutSchema,
  creditBalanceSchema,
  feedItemSchema,
  lookbookEntrySchema,
  lookbookSchema,
  lookDetailSchema,
  orderSchema,
  pickupPointSchema,
  productCardSchema,
  productDetailSchema,
  publicProfileSchema,
  sessionUserSchema,
  startTryOnResponseSchema,
  styleProfileSchema,
  tryOnJobSchema,
  userPhotoSchema,
  wardrobeItemSchema,
} from '@nima/contracts';
import { Platform } from 'react-native';
import type { z } from 'zod';
import { getAnonId } from './anon-id';
import { authClient } from './auth';
import { API_URL, reachable } from './config';

export { API_URL };

type Infer<T extends z.ZodTypeAny> = z.infer<T>;

export type SessionUser = Infer<typeof sessionUserSchema>;
export type FeedItem = Infer<typeof feedItemSchema>;
export type LookCardData = Extract<FeedItem, { kind: 'look' }>['look'];
export type ProductCard = Infer<typeof productCardSchema>;
export type ProductDetail = Infer<typeof productDetailSchema>;
export type LookDetail = Infer<typeof lookDetailSchema>;
export type PublicProfile = Infer<typeof publicProfileSchema>;
export type StyleProfile = Infer<typeof styleProfileSchema>;
export type UserPhoto = Infer<typeof userPhotoSchema>;
export type TryOnJob = Infer<typeof tryOnJobSchema>;
export type CreditBalance = Infer<typeof creditBalanceSchema>;
export type Cart = Infer<typeof cartSchema>;
export type Order = Infer<typeof orderSchema>;
export type Checkout = Infer<typeof checkoutSchema>;
export type PickupPoint = Infer<typeof pickupPointSchema>;
export type WardrobeItem = Infer<typeof wardrobeItemSchema>;
export type Lookbook = Infer<typeof lookbookSchema>;
export type LookbookEntry = Infer<typeof lookbookEntrySchema>;

export interface Bootstrap {
  user: SessionUser | null;
  credits: { balance: number; freeWeeklyCredits: number; nextGrantAt: string | null };
  costs: Record<string, number>;
  features: {
    checkout: boolean;
    sellerDashboard: boolean;
    directMessages: boolean;
    ghostMannequin: boolean;
    promotions: boolean;
  };
  /** Only buttons for ways in that the server is set up for get shown. */
  signIn: { google: boolean; apple: boolean; email: boolean };
  fitNotice: { title: string; body: string };
}

export interface OwnProfile {
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  link: string | null;
  avatar: { url: string } | null;
  isPrivate: boolean;
  wardrobePublic: boolean;
  email: string | null;
  /** Offered before a profile exists. */
  suggestedHandle: string | null;
  /** Whether a password has been set, so the app can offer it as a way in. */
  hasPassword: boolean;
}

export interface ProfileMatch {
  handle: string;
  displayName: string;
  avatar: { url: string } | null;
  isPrivate: boolean;
}

export interface ProfileUpdate {
  handle?: string;
  displayName?: string;
  bio?: string | null;
  link?: string | null;
  isPrivate?: boolean;
  wardrobePublic?: boolean;
  avatarKey?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The caller is a guest and this needs a real account. */
  get needsAccount(): boolean {
    return this.code === 'account_required';
  }

  get needsCredits(): boolean {
    return this.code === 'insufficient_credits';
  }

  get needsPhoto(): boolean {
    return this.code === 'photo_required';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-nima-anon-id': await getAnonId(),
    'x-nima-platform': Platform.OS,
    // The browser sets Origin itself and blocks any attempt to set it from
    // script. React Native does not set one at all, so it is added there.
    ...(Platform.OS === 'web' ? {} : { origin: API_URL }),
  };

  // On native the session is a stored cookie the auth client hands over. In a
  // browser the cookie travels on its own, and reading it from script throws.
  if (Platform.OS !== 'web') {
    try {
      const cookie = await authClient.getCookie?.();
      if (cookie) headers.cookie = cookie;
    } catch {
      // No stored session yet. The request goes out as a visitor.
    }
  }

  // Only when there is something to describe. Fastify rejects a request that
  // claims to carry JSON and carries nothing, which is every bodiless DELETE
  // and every POST that is just a verb, such as liking a look.
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? reachable(JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (
      payload as {
        error?: {
          code: string;
          message: string;
          fields?: Record<string, string[]>;
          requestId?: string;
        };
      }
    )?.error;

    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong',
      error?.fields,
      error?.requestId,
    );
  }

  return payload as T;
}

/** Every call the app makes, named after what it does rather than its route. */
export const api = {
  bootstrap: () => request<Bootstrap>('/v1/session/bootstrap'),

  feed: (params: {
    surface?: 'foryou' | 'explore' | 'following';
    cursor?: string;
    limit?: number;
  }) => request<Page<FeedItem>>('/v1/feed', { query: params }),

  products: (params: {
    q?: string;
    category?: string;
    cursor?: string;
    limit?: number;
    sort?: string;
  }) => request<Page<ProductCard>>('/v1/products', { query: params }),

  product: (id: string) => request<ProductDetail>(`/v1/products/${id}`),

  look: (id: string) => request<LookDetail>(`/v1/looks/${id}`),

  likeLook: (id: string) =>
    request<{ liked: boolean; likeCount: number }>(`/v1/looks/${id}/like`, { method: 'POST' }),

  saveLook: (id: string) => request<{ saved: boolean }>(`/v1/looks/${id}/save`, { method: 'POST' }),

  dismissLook: (id: string, reason?: string) =>
    request<{ ok: true }>(`/v1/looks/${id}/not-for-me`, {
      method: 'POST',
      body: { reason },
    }),

  shareLink: (id: string) =>
    request<{ url: string; message: string }>(`/v1/looks/${id}/share-link`),

  profile: (handle: string) => request<PublicProfile>(`/v1/profiles/${handle}`),

  styleProfile: () => request<StyleProfile>('/v1/profile/style'),

  saveStyleAnswers: (answers: Record<string, unknown>) =>
    request<{ completion: number; completedSteps: string[] }>('/v1/profile/style', {
      method: 'PATCH',
      body: answers,
    }),

  photos: () => request<{ items: UserPhoto[] }>('/v1/profile/photos'),

  myProfile: () => request<OwnProfile>('/v1/profile'),

  /** Sets a first password, or changes one when the current one is given. */
  setPassword: (body: { newPassword: string; currentPassword?: string }) =>
    request<{ hasPassword: true }>('/v1/profile/password', { method: 'POST', body }),

  searchProfiles: (q: string) =>
    request<{ items: ProfileMatch[] }>('/v1/profiles', { query: { q } }),

  profileLooks: (handle: string, params: { cursor?: string; limit?: number } = {}) =>
    request<Page<LookCardData>>(`/v1/profiles/${handle}/looks`, { query: params }),

  updateProfile: (body: ProfileUpdate) =>
    request<unknown>('/v1/profile', { method: 'PATCH', body }),

  handleAvailable: (handle: string) =>
    request<{ handle: string; available: boolean; suggestion?: string }>(
      '/v1/profile/handle-available',
      { query: { handle } },
    ),

  createUpload: (body: { purpose: string; contentType: string; size: number }) =>
    request<{ uploadUrl: string; storageKey: string; headers: Record<string, string> }>(
      '/v1/uploads',
      { method: 'POST', body },
    ),

  savePhoto: (body: {
    storageKey: string;
    kind: 'FULL_BODY' | 'UPPER_BODY';
    width?: number;
    height?: number;
    makeDefault?: boolean;
  }) => request<UserPhoto>('/v1/profile/photos', { method: 'POST', body }),

  deletePhoto: (id: string) => request<void>(`/v1/profile/photos/${id}`, { method: 'DELETE' }),

  startTryOn: (body: {
    kind?: string;
    items?: Array<{
      slot: string;
      productId?: string;
      variantId?: string;
      wardrobeItemId?: string;
    }>;
    photoId?: string;
    lookId?: string;
    parentJobId?: string;
    instruction?: string;
  }) => request<Infer<typeof startTryOnResponseSchema>>('/v1/tryon', { method: 'POST', body }),

  tryOn: (id: string) => request<TryOnJob>(`/v1/tryon/${id}`),

  tryOns: (params: { cursor?: string; limit?: number } = {}) =>
    request<Page<TryOnJob>>('/v1/tryon', { query: params }),

  /** Keeps a finished try-on as a look. PRIVATE is yours alone; the rest share it. */
  publishTryOn: (
    id: string,
    body: { visibility: 'PRIVATE' | 'FOLLOWERS' | 'PUBLIC'; caption?: string },
  ) => request<{ lookId: string }>(`/v1/tryon/${id}/publish`, { method: 'POST', body }),

  askNima: (body: {
    message: string;
    threadId?: string;
    context?: { productId?: string; lookId?: string; occasion?: string };
  }) =>
    request<{ threadId: string; messageId: string; accepted: true }>('/v1/stylist/ask', {
      method: 'POST',
      body,
    }),

  stylistPrompts: () =>
    request<{ items: Array<{ label: string; message: string; icon: string | null }> }>(
      '/v1/stylist/prompts',
    ),

  stylistThreads: () =>
    request<
      Page<{ id: string; title: string | null; updatedAt: string; lastMessage: string | null }>
    >('/v1/stylist/threads'),

  stylistThread: (id: string) =>
    request<{
      messages: Array<{
        id: string;
        role: 'USER' | 'ASSISTANT' | 'TOOL' | 'SYSTEM';
        content: string;
        products: ProductCard[];
        createdAt: string;
      }>;
    }>(`/v1/stylist/threads/${id}`),

  credits: () =>
    request<{
      balance: number;
      freeWeeklyCredits: number;
      nextGrantAt: string | null;
      costs: Record<string, number>;
    }>('/v1/credits'),

  creditPacks: (platform: 'IOS' | 'ANDROID' | 'WEB') =>
    request<{
      packs: Array<{
        key: string;
        credits: number;
        priceCents: number;
        bestValue: boolean;
        productIdIos: string | null;
      }>;
      paymentMethod: 'MPESA' | 'IN_APP_PURCHASE';
      note: string;
    }>('/v1/credits/packs', { query: { platform } }),

  requestDeletion: () =>
    request<{ requestedAt: string; graceDays: number; message: string }>('/v1/profile/delete', {
      method: 'POST',
    }),

  wardrobe: (params: { cursor?: string; limit?: number; category?: string } = {}) =>
    request<Page<WardrobeItem> & { counts: Record<string, number> }>('/v1/wardrobe', {
      query: params,
    }),

  addWardrobeItem: (body: {
    storageKey: string;
    label?: string | null;
    category?: string;
    slot?: string;
  }) => request<WardrobeItem>('/v1/wardrobe', { method: 'POST', body }),

  updateWardrobeItem: (id: string, body: { label?: string | null; category?: string }) =>
    request<WardrobeItem>(`/v1/wardrobe/${id}`, { method: 'PATCH', body }),

  removeWardrobeItem: (id: string) => request<void>(`/v1/wardrobe/${id}`, { method: 'DELETE' }),

  lookbooks: (params: { cursor?: string; limit?: number } = {}) =>
    request<Page<Lookbook>>('/v1/lookbooks', { query: params }),

  createLookbook: (body: { title: string; occasion?: string | null }) =>
    request<Lookbook>('/v1/lookbooks', { method: 'POST', body }),

  lookbook: (id: string) =>
    request<{ lookbook: Lookbook; entries: LookbookEntry[] }>(`/v1/lookbooks/${id}`),

  addToLookbook: (
    id: string,
    body: { lookId?: string; productId?: string; wardrobeItemId?: string; note?: string },
  ) => request<{ id: string }>(`/v1/lookbooks/${id}/entries`, { method: 'POST', body }),

  removeFromLookbook: (id: string, entryId: string) =>
    request<void>(`/v1/lookbooks/${id}/entries/${entryId}`, { method: 'DELETE' }),

  deleteLookbook: (id: string) => request<void>(`/v1/lookbooks/${id}`, { method: 'DELETE' }),

  cart: () => request<Cart>('/v1/cart'),

  cartCount: () => request<{ count: number }>('/v1/cart/count'),

  addToCart: (body: { variantId: string; quantity?: number }) =>
    request<Cart>('/v1/cart/items', { method: 'POST', body }),

  setCartQuantity: (id: string, quantity: number) =>
    request<Cart>(`/v1/cart/items/${id}`, { method: 'PATCH', body: { quantity } }),

  removeFromCart: (id: string) => request<Cart>(`/v1/cart/items/${id}`, { method: 'DELETE' }),

  pickupPoints: (county?: string) =>
    request<{ items: PickupPoint[] }>('/v1/delivery/pickup-points', { query: { county } }),

  deliveryQuote: (params: { method: 'PICKUP_POINT' | 'DOORSTEP'; pickupPointId?: string }) =>
    request<{ costCents: number; estimate: string }>('/v1/delivery/quote', { query: params }),

  startCheckout: (body: {
    deliveryMethod: 'PICKUP_POINT' | 'DOORSTEP';
    pickupPointId?: string;
    recipientName: string;
    recipientPhone: string;
    deliveryNote?: string;
    payerPhone: string;
  }) => request<Checkout>('/v1/checkout', { method: 'POST', body }),

  checkout: (id: string) => request<Checkout>(`/v1/checkout/${id}`),

  orders: (params: { cursor?: string; limit?: number; status?: string } = {}) =>
    request<Page<Order>>('/v1/orders', { query: params }),

  order: (id: string) => request<Order>(`/v1/orders/${id}`),
};
