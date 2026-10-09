# Legacy Audit: Nima-Convex (Next.js + Convex web app)

- **Source:** `reference/Nima-Convex` (GitHub `zyraglobal7/Nima-Convex`).
- **History:** 187 commits, 2025-12-10 → 2026-04-16.
- **Contributors:** zyraglobal7 (96), 4kClinton (52 + 4 as "Clinton Kibet"), Brian (32), iangwaigdev (3).
- **Production domain:** `https://www.shopnima.ai`.
- **Audited:** 2026-09-21.
- **Secrets:** none are committed. Only `.env.local.example` is in the repo, and it holds placeholders.

All paths below are relative to `reference/Nima-Convex/` unless stated.

---

## 0. TL;DR

- **What it is.** A feature-rich, mostly wired-up web app covering:
  - AI stylist chat
  - Gemini-based virtual try-on (look, single item, camera "QuickTry", seller links, 3rd-party widget)
  - A social layer (explore, friends, look-sharing DMs, activity)
  - Lookbooks, wardrobe, and weekly recommendations
  - A multi-vendor seller dashboard with tiers and analytics
  - An M-Pesa credit system via **Fingo Pay**
- **Size.** About 40k lines in `convex/` and about 60k in app/components. No tests.
- **Try-on.** Implemented with **Google Gemini image generation** (`gemini-3-pro-image-preview`, fallback `gemini-3.1-flash-image-preview`). The user photo and garment photos go in as inline references, and a **GPT-4o-written prompt** is wrapped in a fixed template. There is no dedicated VTON model (no Fashn, Kolors, or IDM-VTON).
- **Money flows.**
  - Credits and seller subscriptions are **real** (Fingo STK push + HMAC webhook).
  - Cart checkout creates orders and triggers STK push, but the UI says "payment coming soon".
  - "Buy look" is a Coming-Soon modal, and `BuyWithNimaSheet` fakes payment.
  - No payouts, commission, or logistics integration. **Pick Up Mtaani: nothing.**
- **Missing or stubbed.**
  - Ghost-mannequin / seller photo processing: **not built**. Seller AI only autofills text fields with GPT-4o vision.
  - A personalised "For You" look feed exists in the backend (`getFeedLooks`) but is **dead code**.
  - DMs share looks only; there is no text.
  - Account deletion is not implemented.
- **Security.** Very weak. Four examples:
  - Account takeover via the unsigned WorkOS webhook and the client-supplied email in `getOrCreateUser`.
  - Unauthenticated admin catalog CRUD.
  - PII leak via `users.getUser`.
  - A rate limiter that is defined but never used.

  **Do not port the code as-is. Port the ideas, schema, prompts, copy, and design tokens.**

---

## 1. Purpose, structure, versions

**Purpose.** "Nima — your personal AI stylist. See yourself in every outfit." Users onboard with a selfie plus style picks. Nima then:
- generates 3 AI outfits rendered on the user's own body;
- lets them chat for occasion outfits, try on single items, and snap items in-store (QuickTry);
- lets them save to lookbooks, share socially, and buy from Kenyan sellers.

Sellers get a dashboard, try-on links for their customers, and an embeddable try-on widget ("Nima Connect").

**Versions (package.json):**

| Package | Version |
|---|---|
| next | ^16.1.1 (App Router) |
| react / react-dom | ^19.2.3 |
| convex | ^1.31.3 |
| @convex-dev/workflow | ^0.3.3 |
| @convex-dev/workpool | ^0.3.0 (unused directly) |
| convex-helpers | ^0.1.113 |
| @workos-inc/authkit-nextjs | ^2.12.2 |
| ai (Vercel AI SDK) | ^5.0.108 |
| @ai-sdk/openai | ^2.0.80 |
| @ai-sdk/google | ^2.0.45 (**installed, unused**) |
| @ai-sdk/anthropic | ^3.0.64 (**installed, unused**) |
| @ai-sdk/react | ^2.0.109 |
| @google/genai | ^1.32.0 |
| tailwindcss | ^4.1.17 |
| shadcn/ui + Radix | (full shadcn set in `components/ui`) |
| zod | ^4.1.13 |
| framer-motion, recharts, react-markdown, sonner, vaul, embla | UI libraries |
| posthog-js | ^1.313.0 |
| resend | ^6.9.2 |
| web-push | ^3.6.7 (boilerplate only) |
| typescript | ^5.9.3 |

**Top-level layout:**
```
app/            Next.js routes: (main) shell, (bare)/quickTry, admin, seller, connect, [storeName]/try-on, api/*
components/     feature folders + components/ui (shadcn)
convex/         schema.ts, types.ts, http.ts, crons.ts, per-feature queries/mutations/actions, workflows/
lib/            analytics.ts (PostHog), mock-data (types only now), hooks, utils
memory/         MEMORY.md + project_onboarding_flow.md (Claude memory: 4-step auth-first onboarding)
.cursor/        rules (convex rules, UI colors, PRD "project-description.mdc"), plans (native prompt, rec engine spec)
Policies.ts, T&Cs.ts   legal copy as TS constants, rendered by /privacyPolicy and /termsAndConditions
middleware.ts   WorkOS authkitMiddleware + public path allowlist
```

**A separate native app existed.** It was an Expo/React Native repo (`~/WORK/nima-native`, not present here) that shared this Convex backend. The evidence:
- `convex/auth.ts` does WorkOS PKCE code exchange for `EXPO_PUBLIC_WORKOS_CLIENT_ID`.
- Push goes through Expo (`convex/notifications/actions.ts` → `exp.host`).
- `.cursor/plans/native-update prompt.md` describes it.

---

## 2. Tech stack and third-party services

| Concern | Service / lib | Details | Paid? |
|---|---|---|---|
| Auth | **WorkOS AuthKit** | Redirect login (Google + email). `middleware.ts`, `app/sign-in|sign-up|sign-out|callback`. Convex validates WorkOS JWTs via JWKS (`convex/auth.config.ts`). User profile synced client-side (`components/UserDataSync.tsx` → `users.mutations.getOrCreateUser`). Webhook `POST /webhooks/workos` (**unsigned**). Mobile PKCE proxy in `convex/auth.ts`. | Free to 1M MAU, then paid |
| Backend / DB / storage / cron / workflows | **Convex Cloud** | All data. File storage (`_storage`) for user photos, generated images, product images. Crons in `convex/crons.ts`. `@convex-dev/workflow` for onboarding look generation. | Paid beyond free tier |
| Hosting | Vercel (implied: AI Gateway key, Next.js) | | Paid tiers |
| LLM text | **OpenAI** via `@ai-sdk/openai` (optionally Vercel AI Gateway `VERCEL_AI_GATEWAY_API_KEY`, baseURL `api.vercel.ai/v1`) | gpt-4.1 (web chat stream), gpt-4o (vision tagging, try-on prompt writing, outfit selection), gpt-4o-mini (RN chat, comments, seller chat, AI outfit composer), o3-mini (style profile) | Paid |
| Image generation / try-on | **Google Gemini** via `@google/genai` (`GOOGLE_AI_STUDIO_KEY`) | `gemini-3-pro-image-preview` primary, `gemini-3.1-flash-image-preview` fallback on 503. Also used for wardrobe "background removal" (regenerating the item on white). | Paid (per image) |
| Payments | **Fingo Pay** (M-Pesa STK push) | `POST https://api.fingopay.io/v1/mpesa/charge`, Bearer `FINGO_LIVE_KEY`, `Idempotency-Key`. Amount in cents (KES×100). Webhook `POST /webhooks/fingo` (Convex), proxied from `shopnima.ai/api/fingo/webhook` (`app/api/fingo/webhook/route.ts`). HMAC-SHA256 `X-Fingo-Signature: t=..,v1=..`, 300 s tolerance. Merchant ref prefixes: `nima_cr_` credits, `nima_ord_` orders, `nima_sub_` seller subscriptions. | Transaction fees |
| Email | **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`) | Only one template: seller new-order email (`convex/emails/templates.ts`) | Free tier / paid |
| Push | **Expo Push** (`exp.host/--/api/v2/push/send`) | 9 notification types in `convex/notifications/actions.ts`. Tokens in `push_tokens`. Web never registers. | Free |
| Web push | `web-push` + `public/sw.js` + `app/actions.ts` | Next.js docs boilerplate. SW never registered; subscription held in a module variable. **Dead.** | — |
| Analytics | **PostHog** (`NEXT_PUBLIC_POSTHOG_KEY/HOST`) | `components/PostHogProvider.tsx`, ~30 events in `lib/analytics.ts` | Free tier / paid |
| Logistics | **None** | No Pick Up Mtaani, Sendy, or G4S. Flat shipping fee. | — |
| Images CDN | Next/Image remote patterns for convex.cloud, unsplash, Google avatars, WorkOS CDN | | — |

**Environment variables referenced (names only; no values in the repo):**
- `OPENAI_API_KEY`, `GOOGLE_AI_STUDIO_KEY`, `VERCEL_AI_GATEWAY_API_KEY`
- `FINGO_LIVE_KEY`, `FINGO_WEBHOOK_SECRET`
- `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`, `EXPO_PUBLIC_WORKOS_CLIENT_ID`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`

### 2.1 Virtual try-on: exactly how it works

**Core file:** `convex/workflows/actions.ts`. Near-duplicate copies exist in `convex/workflows/itemTryOn.ts` (dead duplicate of `generateItemTryOnImage`) and `convex/connect/actions.ts`.

**Full-look try-on** (`generateLookImage`). Used by onboarding, "generate more", chat looks, recreate, and create-look:

1. Set `looks.generationStatus = 'processing'`.
2. Load the user's **primary** `user_images` row (a selfie or full-body photo uploaded at onboarding).
3. Load the look's catalog items (primary `item_images` URL) and any `wardrobeItems` (background-cleaned images).
4. Fetch all images in parallel and convert them to base64.
5. **Prompt writing:** call `gpt-4o` as a "fashion photography director". It writes an image prompt under 500 characters that describes the person wearing each item (`"{colors} {name} by {brand}"`), keeps identity, uses natural light and a clean background, with no markdown.
6. Call Gemini with `contents = [text, userImage, ...itemImages(max 5)]` and `responseModalities: ['TEXT','IMAGE']`. The text is this wrapper:
   ```
   Virtual try-on fashion photo: Create an image of this person (shown in the first reference image) wearing the clothing items shown in the other reference images.
   Reference Image 1: Photo of the person who should be wearing the clothes
   Reference Image N: <item description>
   <gpt-4o prompt>
   Important:
   - Keep the person's face, body type & size, and identity exactly as shown in Reference Image 1
   - Dress them in ALL the clothing items from the other reference images
   - Make it look like a professional fashion photograph
   - The person should look natural and confident wearing these items
   ```
   The mimeType is always declared `image/jpeg`, even for PNGs.
7. If no image part comes back, retry with a simpler prompt plus the user image only (the garments are described in text).
8. Store the PNG in Convex storage, insert `look_images` (`generationProvider:'google-gemini'`), and set the look to `completed`. On error, set `failed` and record `errorMessage`.

**Single-item try-on** (`generateItemTryOnImage`, started by `workflows/index.ts startItemTryOn`):
- Same flow, with a single-item gpt-4o prompt: framing by category, "show ONLY this single item".
- Uses the selected colour variant.
- The fallback is **text-only with no user photo**, which produces a random person. This is a bug.
- Results are cached per (item, user) in `item_try_ons`. A cached result is free. A failed retry costs 1 credit again.

**QuickTry** (`generateQuickTryOnImage`): user primary photo plus a camera-captured item photo, one fixed prompt: *"Virtual try-on: Show the person from Reference Image 1 wearing the clothing item captured in Reference Image 2. Keep the person's face, body, and identity exactly as shown. Professional fashion photo, clean background."*

**Seller try-on link** (`generateSellerTryOnImage`): the customer's uploaded photo plus the seller item. Same short prompt. Charges `sellers.tryOnCredits`.

**Nima Connect** (`convex/connect/actions.ts generateConnectTryOn`): a partner-supplied `productImageUrl` (fetched server-side, an SSRF risk) plus a guest or linked-user photo. gpt-4o prompt, then Gemini, with one retry.

**Wardrobe "background removal"** (`convex/wardrobe/actions.ts processWardrobeUpload`):
1. gpt-4o vision lists items as JSON (≤12). Each has description, category, subcategory, tags, color, season, formality, position.
2. For each item, Gemini is asked to *"Generate a clean product photo of this exact item on a pure white background…"*. The item is regenerated, not segmented.

**Photo validation at onboarding** (`convex/userImages/actions.ts validateOnboardingImage`): gpt-4o `generateObject` checks face_visible, face_clear, is_portrait, quality, valid, and issue (a friendly message of 15 words or fewer). It is lenient and **fails open**.

**Timing and cost notes.**
- Each look costs roughly 1 gpt-4o call plus 1–2 Gemini Pro image calls.
- Onboarding also runs o3-mini (style profile), gpt-4o (selection), and 3× gpt-4o-mini (comments).
- Sequential `runAction` calls hit Convex auth-token expiry (~30 s), so chat looks are now scheduled independently (`convex/chat/actions.ts generateChatLookImages`).

---

## 3. Data model (Convex `convex/schema.ts`, 1,321 lines, 30 tables)

Conventions: all tables carry Convex `_id` and `_creationTime`, and most have `createdAt` / `updatedAt` (ms numbers). "Enum" means a `v.union` of literals.

| Table | Key fields | Indexes / notes |
|---|---|---|
| **users** | `workosUserId`, `email`, `emailVerified`, `username?`, `firstName?`, `lastName?`, `profileImageId?`, `profileImageUrl?`, `gender?`(male/female/prefer-not-to-say), `age?`, `stylePreferences[]`, `shirtSize?`, `waistSize?`, `height?`, `heightUnit?`(cm/ft), `shoeSize?`, `shoeSizeUnit?`(EU/US/UK), `country?`, `currency?`, `budgetRange?`(low/mid/premium), `occasions?[]`, `phoneNumber?`, `phoneVerified?`, `subscriptionTier`(free/style_pass/vip, legacy), `dailyTryOnCount`/`dailyTryOnResetAt` (deprecated), **`credits?`** (purchased), **`freeCreditsUsedThisWeek?`**, **`weeklyCreditsResetAt?`**, `onboardingCompleted`, `onboardingWorkflowStartedAt?`, `styleProfile?`(any: text or structured), `isActive`, `role?`(user/admin/seller), `savedShippingAddress?`{fullName, addressLine1/2, city, state, postalCode, country, phone} | by_workos_user_id, by_email, by_username |
| **user_images** | `userId?` (null during onboarding), `storageId`, `onboardingToken?`, `filename?`, `contentType?`, `sizeBytes?`, `imageType`(full_body/upper_body/face/other), `isPrimary`, `status`(onboarding/pending/processed/failed), `processedUrl?` | by_user, by_user_and_primary, by_onboarding_token |
| **items** | `sellerId?` (null = Nima-curated), `publicId`(item_xxx), `sku?`, `name`, `brand?`, `description?`, `category`(top/bottom/dress/outfit/outerwear/shoes/accessory/bag/jewelry/swimwear), `subcategory?`, `gender`(male/female/unisex), `price` (**whole KES** despite "cents" comment), `currency`, `originalPrice?`, `colors[]`, `sizes[]`, `material?`, `tags[]`, `occasion?[]`, `season?[]`, `sourceStore?`, `sourceUrl?`, `affiliateUrl?`, `inStock`, `stockQuantity?` (never decremented), `isActive`, `isFeatured?`, counters (`viewCount`, `saveCount`, `purchaseCount`, `tryOnCount`, `lookbookSaveCount`, `cartAddCount`, `lookInclusionCount`) | by_public_id, by_category, by_gender_and_category, by_active_and_category, by_active_and_gender, by_seller, by_seller_and_active; search `search_items` on name (filters category, gender, isActive) |
| **item_images** | `itemId`, `storageId?` / `externalUrl?`, `altText?`, `sortOrder`, `isPrimary`, `imageType`(front/back/side/detail/model/flat_lay) | by_item, by_item_and_primary |
| **looks** | `publicId`(look_xxx), `itemIds[]`, `wardrobeItemIds?[]`, `totalPrice`, `currency`, `name?`, `styleTags[]`, `occasion?`, `season?`, `nimaComment?`, `targetGender`, `targetBudgetRange?`, `isActive`, `isFeatured?`, `isPublic?`, `sharedWithFriends?`, `viewCount?`, `saveCount?`, `selectedSize?`, `selectedColor?`, `generationStatus?`(pending/processing/completed/failed), `status?`(pending/saved/discarded), `createdBy?`(system/user), `creatorUserId?`, `creationSource?`(chat/apparel/recreated/shared/system), `originalLookId?` | by_public_id, by_active_and_gender, by_occasion, by_active_and_featured, by_creator_and_status, by_public_and_active, by_user_and_save_status, by_creation_source |
| **look_images** | `lookId`, `userId`, `storageId?`, `userImageId`, `status`, `generationProvider?`, `generationJobId?`, `errorMessage?`, `expiresAt?` | by_look, by_look_and_user, by_user, by_status |
| **lookbooks** | `userId`, `name`, `description?`, `coverImageId?`, `autoCoverItemId?`, `isPublic`, `shareToken?`, `isCollaborative?`, `collaboratorIds?[]` (future), `itemCount`, `isArchived?` | by_user, by_user_and_archived, by_share_token |
| **lookbook_items** | `lookbookId`, `userId`, `itemType`(look/item), `lookId?`, `itemId?`, `note?`, `sortOrder` | by_lookbook, by_user, by_lookbook_and_item, by_lookbook_and_look |
| **threads** | `userId`, `title?`, `contextType?`(general/look/item/outfit_help), `contextLookId?`, `contextItemId?`, `isArchived?`, `lastMessageAt`, `messageCount` | by_user, by_user_and_archived, by_user_and_last_message |
| **messages** (AI chat) | `threadId`, `userId`, `role`(user/assistant), `content`, `messageType?`(text/fitting-ready/no-matches), `lookIds?[]`, `attachments?[{type: image/look/item, storageId?, lookId?, itemId?}]`, `model?`, `tokenCount?`, `status`(sent/streaming/error), `errorMessage?` | by_thread, by_user |
| **item_try_ons** | `itemId`, `userId`, `storageId?`, `userImageId`, `selectedSize?`, `selectedColor?`, `status`, `generationProvider?`, `generationJobId?`, `errorMessage?`, `expiresAt?` | by_item_and_user, by_user, by_status |
| **quick_try_ons** | `userId`, `userImageId`, `capturedItemStorageId`, `resultStorageId?`, `status`, `errorMessage?` | by_user, by_status |
| **seller_try_ons** | `sellerId`, `itemId`, `customerImageStorageId`, `resultStorageId?`, `status`, `errorMessage?` | by_seller, by_status |
| **wardrobeItems** | `userId`, `imageStorageId` (cleaned), `originalImageStorageId`, `description`, `category`(tops/bottoms/shoes/outerwear/accessories/dresses, a free string), `subcategory?`, `tags[]`, `color`, `season?[]`, `formality`(casual/smart-casual/semi-formal/formal/athletic), `source`(single_upload/closet_scan) | by_user, by_user_and_category, by_user_and_formality |
| **recommendations** | `userId`, `itemIds[]`(2–4), `occasion`, `nimaComment`, `status`(pending_comment/active/expired/tried_on), `weekOf`, `expiresAt`, `wardrobeItemIds?[]`, `isWardrobeMix?` | by_user_and_status, by_user_and_created, by_expires |
| **look_interactions** | `lookId`, `userId`, `interactionType`(love/dislike/save/recreate), `seenByOwner?` | by_look, by_user, by_look_and_user, by_look_and_type, by_created_at |
| **item_likes** | `userId`, `itemId` | by_user, by_item, by_user_and_item, by_user_and_created |
| **friendships** | `requesterId`, `addresseeId`, `status`(pending/accepted) | by_requester, by_addressee, by_users, by_status, by_addressee_and_status |
| **direct_messages** | `senderId`, `recipientId`, **`lookId`** (look-share only, no text), `isRead` | by_sender, by_recipient, by_recipient_and_read, by_users, by_recipient_and_created |
| **cart_items** | `userId`, `itemId`, `quantity`, `selectedSize?`, `selectedColor?`, `addedAt` | by_user, by_user_and_item |
| **orders** | `userId`, `orderNumber`(ORD-YYYYMMDD-XXXX), `shippingAddress`{…}, `subtotal`, `serviceFee`, `shippingCost`, `total`, `currency`, `paymentStatus`(pending/paid/failed/refunded), `paymentMethod?`, `paymentIntentId?`, `merchantTransactionId?`, `mpesaPhoneNumber?`, `status`(pending/processing/partially_shipped/shipped/delivered/cancelled) | by_user, by_order_number, by_status, by_created_at, by_merchant_transaction_id |
| **order_items** | `orderId`, `sellerId?`, `itemId`, snapshot (`itemName`, `itemBrand?`, `itemPrice`, `itemImageUrl?`), `quantity`, `selectedSize?`, `selectedColor?`, `lineTotal`, `fulfillmentStatus`(pending/processing/shipped/delivered/cancelled), `trackingNumber?`, `trackingCarrier?`, `shippedAt?`, `deliveredAt?` | by_order, by_seller, by_seller_and_status, by_item |
| **sellers** | `userId`, `slug`, `shopName`, `description?`, `logoStorageId?`, `bannerStorageId?`, `contactEmail?`, `contactPhone?`, `verificationStatus`(pending/verified/rejected; never changed), `verificationNotes?`, `tier?`(basic/starter/growth/premium), `isActive`, `tryOnCredits?` (25 on signup) | by_user, by_slug, by_verification_status, by_tier |
| **payouts** | `sellerId`, `periodStart`, `periodEnd`, `grossRevenue`, `netAmount`, `status`(pending/processing/paid/failed), `stripeTransferId?`, `paidAt?`, `failureReason?` (**never written**) | by_seller, by_seller_and_status, by_period |
| **credit_purchases** | `userId`, `creditAmount`, `priceKes`, `phoneNumber`, `merchantTransactionId`, `fingoTransactionId?`, `status`(pending/completed/failed), `failureReason?` | by_user, by_merchant_transaction_id, by_user_and_status |
| **push_tokens** | `userId`, `token` (Expo), `platform`(ios/android/web) | by_user, by_token |
| **tier_config** | `tier`, `maxProducts|null`, `revenueChartDays`, `orderHistoryDays|null`, `topProductsLimit|null`, `showEngagementCounts`, `showCartCounts`, `priceKes` | by_tier |
| **seller_subscriptions** | `sellerId`, `tier`(starter/growth/premium), `status`(pending/active/expired/cancelled/failed), `periodStart?`, `periodEnd?`(+30 d), `amountKes`, `phoneNumber`, `merchantTransactionId`(nima_sub_), `fingoTransactionId?`, `failureReason?` | by_seller, by_seller_and_status, by_status, by_period_end, by_merchant_transaction_id |
| **seller_chat_messages** | `sellerId`, `role`, `content` | by_seller, by_seller_and_created |
| **api_partners** | `name`, `slug`, `websiteUrl`, `apiKeyHash`(SHA-256), `apiKeyPrefix`, `allowedDomains[]`, `webhookUrl?`, `webhookSecret?`, `plan`(free/starter/growth/enterprise), `monthlyTryOnLimit`, `tryOnsUsedThisMonth`, `billingResetAt`, `isActive`, `sellerId?` | by_api_key_prefix, by_slug, by_seller |
| **api_sessions** | `partnerId`, `sessionToken`, `nimaUserId?`, `guestFingerprint?`, `externalProductId`, `externalProductUrl?`, `productImageUrl`, `productName?`, `trackingId?`, `productCategory?`, `guestImageStorageId?`, `resultStorageId?`, `guestTryOnUsed`, `guestTryOnCount?`, `status`(created/photo_needed/photo_uploaded/processing/completed/failed/expired), `errorMessage?`, `expiresAt` | by_session_token, by_partner, by_nima_user, by_expires_at |
| **api_usage_logs** | `partnerId`, `sessionId`, `eventType`(session_created/photo_uploaded/tryon_generated/tryon_failed/user_converted/item_added_to_cart/item_purchased), `externalProductId?`, `wasAuthenticated`, `generationTimeMs?`, `itemValue?`, `currency?`, `trackingId?` | by_partner, by_partner_and_created, by_event_type |
| **wrapped_settings** | `year`, `runDate`, `theme`(aurora/geometric/fluid), `isActive` | by_year |
| **user_wrapped** | `userId`, `year`, `styleEra`, `styleEraDescription`, `dominantTags[]`, `topItems[{itemId,name,count}]`, `colorPalette[{color,percentage}]`, `moodSwings[{quarter,months,mood,topTag}]`, `topBrands[{brand,saveCount}]`, `personalityType`, `personalityDescription`, `trendsAhead[]`, `trendsSkipped[]`, `mostSavedLookId?`, totals, `shareToken`, `viewedAt?` | by_user_and_year, by_share_token |

**Prisma translation notes:**
- Replace the scattered try-on tables (`look_images`, `item_try_ons`, `quick_try_ons`, `seller_try_ons`, `api_sessions` result) with one **`TryOnJob`** table: `kind`, `sourcePhotoId`, `garment refs`, `status`, `provider`, `model`, `costCredits`, `resultMediaId`, `error`.
- Replace the denormalised credit fields with a **`CreditLedger`** (append-only entries: grant/spend/purchase/refund/expire) plus a cached balance.
- Normalise `Money` as integer minor units (KES cents) consistently. The legacy app flip-flopped (see migration `convex/admin/migrations.ts fixItemPrices`).
- Replace `direct_messages` with `Conversation`/`Message` tables that support text, look, item, and image payloads.
- Use a proper `ProductVariant` (size/colour/stock) instead of `sizes[]`/`colors[]`/`stockQuantity`.
- Add `Shipment` (Pick Up Mtaani agent/door, tracking) and `Payout`/`Commission` tables. They were missing.
- Use cuid/uuid plus CSPRNG tokens. The legacy code used `Math.random` for public IDs, share tokens, and order numbers.

---

## 4. Features: implemented vs stubbed

| Area | Status | Where / notes |
|---|---|---|
| **Guest browsing** | Partial | Allowlist in `middleware.ts`. `/` = `components/onboarding/GateSplash.tsx` (Google sign-in). Guests can browse `/discover` (Explore + Apparel tabs) and `/look/*`. `/product/[id]` is **not** public, so tapping an item bounces a guest to sign-in. Onboarding requires auth ("auth-first"). |
| **Questionnaire / onboarding** | Implemented (4-step) | `components/onboarding/OnboardingWizard.tsx`: PhotoUpload → StyleChat → Loading → Success (`memory/project_onboarding_flow.md`). StyleChat (`components/onboarding/steps/StyleChatStep.tsx`): gender; pick ≥2 of 8 outfit images (`components/onboarding/types.ts STYLE_OUTFIT_IMAGES`, files in `public/*.png`); occasions (Work/Office, Casual Hangouts, Dates & Nights Out, Events & Weddings, Active/Fitness, All); budget (Smart Saver ≤KES 2,000 / Best of Both 2–10k / Treat Yourself 10k+). Saves via `completeOnboardingV2` (forces KE/KES). Sizes are **not collected** (legacy `SizeFitStep` and 5 other steps are dead code). Success grants the "5 FREE CREDITS" message. |
| **Photos** | Implemented | `PhotoUploadStep.tsx`: JPG/PNG, 10 MB, 1–4 photos, AI validation (fails open). Pre-auth uploads keyed by a client `onb_` token, then claimed after auth (`convex/userImages/mutations.ts`). Profile photo management with a primary flag: `components/profile/PhotosTab.tsx`. Max 10 photos (`MAX_USER_PHOTOS`). |
| **For You feed** | Stub / dead | `convex/looks/queries.ts getFeedLooks` (simple score: gender/style tag/budget/featured) is never called. The practical "For You" is `/engine` → `components/engine/RecommendationFeed.tsx`: weekly rule-based recommendations (`convex/recommendations/mutations.ts`, Monday cron) plus the "My Look" tab on `/discover` (system looks generated for the user). |
| **Explore / social** | Implemented | `getPublicLooks` (public + friends-shared, chronological, fake pagination). Love/dislike/save/recreate (`convex/lookInteractions/*`). Activity feed (`/activity`). Friends (`convex/friends/*`, `components/friends/*`). `/explore` exists but is orphaned; Explore lives inside `/discover`. |
| **Ask Nima chat** | Implemented (3 copies) | Current: `components/engine/NimaChatSheet.tsx` → `app/api/chat/route.ts` (gpt-4.1 stream). Legacy full-page `/ask`, `/ask/[chatId]`. Native: `convex/chat/actions.ts sendChatMessage` (gpt-4o-mini). The LLM emits `[MATCH_ITEMS:occasion|source]`, then the client calls `convex/chat/mutations.ts createLooksFromChat`: **rule-based matching** (formality keywords, coherence scores, complete-outfit detection), 3 looks, **3 credits**, then images. Also `[REMIX_LOOK]`, `[MIX_LOOKS]`, and visual search (`convex/search/visualSearch.ts`, gpt-4o attributes plus a score over the catalog). Fitting room `/fitting/[sessionId]` shows only the first look (TODO). |
| **Virtual try-on** | Implemented | Look, item, QuickTry (`app/(bare)/quickTry`), seller link, Connect. See §2.1. |
| **Recreate look** | Implemented, **free (loophole)** | `components/looks/RecreateLookButton.tsx` → `looks.mutations.recreateLook`. Copies items onto the viewer, schedules `generateLookImage`, notifies the owner. **No credit charge**, and no visibility check on the source look. |
| **Create look from items** | Implemented | Multi-select in Apparel → `components/discover/CreateLookSheet.tsx` → `looks.mutations.createLookFromSelectedItems`. 1 credit, 10/hour limit. **Bug:** it charges the credit *before* validating ≥2 items. |
| **Wardrobe** | Implemented | `convex/wardrobe/*`, `components/engine/WardrobeUploadSheet.tsx`. gpt-4o tagging plus Gemini white-background regeneration. The action has no auth check or quota. Used in chat context and looks, not in recommendations. |
| **Lookbooks** | Implemented | `convex/lookbooks/*`, `/lookbooks`. Looks and items, notes, public flag, share token (viewer path not wired), `quickSave`, `saveTryOnToLookbook`. Collaboration is a stub. |
| **DMs / sharing** | Partial | DMs = look shares only (`convex/directMessages/*`, `/messages`). No friendship requirement, no text. Public share via `/look/{publicId}` with a "shared by" query. Share modals: `components/looks/ShareLookModal.tsx`, `ShareLookViaDMModal.tsx`. |
| **Ghost model (seller photo processing)** | **Not built** | The seller "AI Generate" (`components/seller/products/AIGenerateForm.tsx` → `convex/sellers/actions.ts generateProductDetails`) is gpt-4o vision **text autofill** only (name, description, category, colors, tags, material, occasion, season, suggested KES price range). Photos are stored raw. The only image-cleaning code is the wardrobe Gemini regeneration. |
| **Cart / checkout / payments** | Partial | Cart is complete (`convex/cart/*`). `app/checkout/page.tsx` → `orders.mutations.createOrder`: 10% service fee, **flat shipping 500 backend vs 1,500 shown in UI**, M-Pesa STK push, webhook marks paid. The UI still says "Payment processing coming soon". Cart is cleared before payment. No amount check, no stock decrement, no refunds. "Buy look" is a ComingSoon modal. `components/ask/BuyWithNimaSheet.tsx` (concierge fee 10%, min KES 500) fakes payment via `setTimeout`. |
| **Logistics (Pick Up Mtaani)** | **None** | Only free-text `trackingNumber`/`trackingCarrier` set by the seller. |
| **Seller side / dashboard** | Mostly implemented | Onboarding (`app/seller/onboarding`), products CRUD with tier caps, orders and fulfilment status, analytics (premium-gated), AI insights chat (premium, gpt-4o-mini, `app/api/seller-chat/route.ts`), tiers via Fingo (`convex/sellers/subscriptions.ts`, manual monthly renewal, expiry cron), try-on links (`app/[storeName]/try-on`), Connect API keys (`app/seller/(dashboard)/api`). **Stubs:** verification (never approved), finance/payouts (`finance/page.tsx` shows revenue as "pending payout"), no commission, no way to buy seller try-on credits. |
| **Credits / limits** | Implemented | See §5. The rate limiter (`convex/lib/rateLimiter.ts`) is **never used**. |
| **Privacy** | Weak | Legal pages exist. No account deletion (WorkOS delete only sets `isActive=false`). Private looks are viewable by ID. Look pages can show another user's try-on image. PII IDOR in `users.queries.getUser`. |
| **Admin** | Partial | `/admin`: analytics (8 sub-pages, `convex/admin/analytics.ts`, full-table scans), items CRUD with AI autofill, sellers, billing/tier config, Connect partners, Wrapped. Looks/Users/Orders pages are disabled stubs. Admin role must be set manually in the DB. Many admin functions lack role checks (§9). |
| **Extras** | Implemented | **Nima Wrapped** (rule-based yearly recap, `convex/wrapped/*`, `components/wrapped/*`). **Nima Connect** B2B try-on widget/API (`convex/connect/*`, `convex/http.ts /api/v1/*`, `app/connect/page.tsx`). |

---

## 5. Credits system

**Source files:** `convex/types.ts`, `convex/credits/{mutations,actions,queries}.ts`, `app/(main)/credits/page.tsx`.

**Grant.**
- `FREE_WEEKLY_CREDITS = 5`. These are **lazily reset**: a rolling 7 days from `weeklyCreditsResetAt`, not calendar weeks. The reset happens inside `deductCredit` or during display computation (`calculateAvailableCredits`).
- Free credits do not roll over. There is no signup bonus beyond the 5 weekly.
- The onboarding workflow's 3 looks are **free** (the onboarding workflow does not deduct).

**Spend order.** Free weekly credits first, then purchased `users.credits` (`internal.credits.mutations.deductCredit(userId, count)`). When 2 or fewer remain, it schedules an Expo low-credit push.

**Prices (credits):**

| Action | Cost | Where |
|---|---|---|
| Single-item try-on (new or retry after failure; cached = free) | 1 | `convex/workflows/index.ts startItemTryOn` |
| QuickTry (camera) | 1 | `convex/quickTryOns/mutations.ts` |
| Create look from selected items | 1 | `convex/looks/mutations.ts createLookFromSelectedItems` |
| "Generate more" looks (3) | 3 | `convex/workflows/index.ts startGenerateMoreLooks` |
| Chat look generation (3 looks) | 3 | `convex/chat/mutations.ts createLooksFromChat` |
| Connect widget try-on for a linked Nima user | 1 | `convex/connect/actions.ts` |
| Recreate look | **0 (bug)** | `convex/looks/mutations.ts recreateLook` |
| Onboarding 3 looks | 0 | `convex/workflows/index.ts startOnboardingWorkflow` |
| Chat messages, wardrobe processing, visual search, photo validation | 0 (unmetered AI spend) | |

**Purchase packs** (`CREDIT_PACKAGES`, KES 50 per credit flat, no volume discount):

| Pack | Credits | Price |
|---|---|---|
| `pack_10` | 10 | KES 500 |
| `pack_20` (popular) | 20 | KES 1,000 |
| `pack_50` | 50 | KES 2,500 |
| `pack_100` | 100 | KES 5,000 |

**Purchase flow.**
1. `initiatePurchase(packageId, phone)` validates the Kenyan phone (`^(?:\+254|254|0)(?:7|1)\d{8}$`).
2. It inserts a `credit_purchases` row (pending, `nima_cr_` + 16 chars) and saves the phone to the profile.
3. It schedules `callFingoPaySTKPush` (amount = KES×100).
4. The Fingo webhook calls `completePurchase` (idempotent) to add credits and send a push, or `failPurchase`.
5. The UI polls status.

**Gaps.**
- No refund when generation fails; the credit is deducted up front.
- The race-prone read-modify-write is OK in Convex (serialisable), but it must be transactional in Postgres.
- No ledger or audit trail beyond `credit_purchases`.
- The webhook does not verify the paid amount.
- Purchased credits never expire.

**Seller try-on credits.** These are separate: `sellers.tryOnCredits`, 25 granted at seller creation. `addSellerTryOnCredits` exists but **no purchase flow** calls it.

**Seller tiers** (`TIER_PRICES_KES`, `TIER_LIMITS`, admin-overridable `tier_config`):

| Tier | Price | Products | Revenue chart | Order history | Top products |
|---|---|---|---|---|---|
| basic | free | 20 | none | 30 d | hidden |
| starter | KES 5,000/mo | 50 | 30 d | 90 d | 5 |
| growth | KES 15,000/mo | 200 | 90 d | 180 d | 20 |
| premium | KES 30,000/mo | unlimited | 365 d | unlimited | unlimited |

- Engagement counts are shown from starter up; cart counts from growth up.
- The AI insights chat is premium only.

**Connect partner plans:** free 50, starter 500, growth 5,000, enterprise 999,999 try-ons per month. Not billed.

**PRD original monetisation** (`.cursor/rules/project-description.mdc`): Free (20 try-ons/day), Style Pass $7.99, VIP $19.99, plus the Nima Delivers 10–15% fee. This was replaced by credits.

---

## 6. AI prompts (reuse candidates)

| Prompt | File | Model | Summary |
|---|---|---|---|
| **Nima stylist system prompt (current)** | `app/api/chat/route.ts` `NIMA_SYSTEM_PROMPT` + `buildUserContext` + `buildWardrobeContext` | gpt-4.1, temp 0.7, 500 tokens | Warm, direct, 1–3 sentences, emojis. **Don't over-question** (it already knows the profile). Ask "new vs wardrobe vs both" once per session, with 5 phrasings. Emits `[MATCH_ITEMS:occasion|source]` with mandatory formality keywords (interview/formal… work/date… casual/concert… wedding/gala…). Also `[REMIX_LOOK:occasion|twist]` and `[MIX_LOOKS:a|b]`. Strict gender rules. The user context is built from **client-sent** data (a trust issue). |
| Nima stylist (older, clarifying-questions variant) | `convex/chat/actions.ts` `NIMA_SYSTEM_PROMPT` | gpt-4o-mini | Always asks 1–2 occasion questions before `[MATCH_ITEMS]`. |
| AI outfit composer | `convex/chat/actions.ts composeOutfitWithAI` | gpt-4o-mini `generateObject` (zod) | 1–3 outfits from a given item list. Rules: sets/dresses are complete; formality coherence; one per category; 2–4 items; occasion fit. |
| **Style profile generator** | `convex/workflows/actions.ts generateStyleProfile` | o3-mini | Turns onboarding answers (gender, vibes, occasions, KES budget band) into a 2–3 paragraph actionable profile: aesthetic, outfit formula, colours/fabrics, occasion mix, budget tips. The recommendation spec planned a structured Claude Sonnet JSON version instead. |
| **Onboarding look selector** | `convex/workflows/actions.ts selectItemsForLooks` | gpt-4o | 3 looks with varied sizes (2/3/4 items). Complete-outfit rules, no duplicate categories, no repeated items, gender hard-filter in code, JSON array output, regex parse plus a deterministic fallback (`createFallbackLooks`). |
| **"Nima says" caption** | `convex/workflows/actions.ts generateNimaComment` | gpt-4o-mini, temp 0.9 | 1–2 energetic sentences, under 100 characters, addresses the user by name, no emojis ("giving main character energy"). |
| Recommendation comment | `convex/recommendations/actions.ts` | gpt-4o-mini, temp 0.75, 80 tokens | "Warm, witty **Kenyan** fashion stylist", 1–2 sentences referencing the occasion, feed caption. |
| **Try-on prompt director** (look / item / connect) | `convex/workflows/actions.ts` (lines ~791, ~1058), `convex/connect/actions.ts` | gpt-4o | "Fashion photography director" writes an image prompt (≤500/400 chars) preserving identity, with natural light and a clean background. The item variant frames by category. |
| **Try-on image wrapper templates** | `convex/workflows/actions.ts` (`fullPrompt` strings, QuickTry and seller one-liners) | Gemini 3 Pro Image | Reference-numbered instructions (see §2.1). |
| Photo validator | `convex/userImages/actions.ts` | gpt-4o `generateObject`, temp 0.1 | Face visible/clear, portrait, quality, friendly issue message, lenient. |
| Wardrobe item extractor + white-bg regeneration | `convex/wardrobe/actions.ts` | gpt-4o vision → Gemini image | JSON list of items (category, formality, colour, tags, position), then an isolated product shot per item. |
| Product autofill (seller/admin) | `convex/sellers/actions.ts`, `convex/admin/aiActions.ts` | gpt-4o `generateObject`, temp 0.3 | "Fashion expert and product cataloging specialist". Zod schema incl. `suggestedPriceRange` in KES. |
| Visual search attribute extractor | `convex/search/visualSearch.ts` | gpt-4o `generateObject` | Category, colours, style, gender, description. Then a heuristic catalog score. |
| Seller AI business analyst | `app/api/seller-chat/route.ts` (system prompt builder ~line 133), context in `convex/sellers/aiChat.ts` | gpt-4o-mini, temp 0.4, 800 tokens | Seller KPIs plus anonymised platform trends. Privacy rules: never reveal which seller sells what, no PII. |
| Formality keyword taxonomy (non-LLM) | `convex/chat/mutations.ts` (`FORMALITY_KEYWORDS`, `getRequiredFormalityFromOccasion`, `isCompleteOutfit`), duplicated in `convex/recommendations/mutations.ts` | — | Useful heuristics for candidate filtering before any LLM or embedding step. |
| Wrapped copy (non-LLM) | `convex/wrapped/constants.ts` | — | Style eras, personality types, quarterly moods, 2025 trend lists. |

---

## 7. Legal: `Policies.ts` and `T&Cs.ts`

Both files hold TS constant objects (heading, content, list, subsections) rendered by `app/privacyPolicy/page.tsx` and `app/termsAndConditions/page.tsx`. Company "Nima AI Inc", `support@shopnima.ai`, effective 13 Feb 2026.

**`Policies.ts`:**
- `DATA_HANDLING_POLICY`: data collected (photos, measurements, email, Google, history, messages, location, device); Google Cloud storage; encryption; retention; sharing (lists **Firebase, Google Analytics, Meta Ads**); user rights; breach notice; "GDPR compliance".
- `COOKIE_POLICY`: necessary, analytics (GA), marketing (Meta/Google Ads), preferences; 12-month persistence; consent.
- `AI_TRANSPARENCY_NOTICE`: 4 points (generative try-on; approximate fit; secure processing; no training on user images without authorisation).
- `PRIVACY_POLICY` (12 sections):
  - Information collected (user, automatic, seller)
  - Uses
  - AI and image handling (photos "deleted after processing unless saved")
  - Sharing (Google Cloud, GA/PostHog, Fingo, ad platforms; sellers get aggregates only)
  - Ads
  - Payments (Fingo, Apple IAP, Google Play Billing)
  - Security, retention, rights, children under 13, changes
- `PERMISSIONS_JUSTIFICATION`: camera, photos, approximate location. Written for app-store review.

**`T&Cs.ts`:**
- `TERMS_OF_SERVICE`, 11 sections: acceptance, services, accounts, user content licence, prohibited conduct (incl. images of others without consent), seller responsibilities, payments/fees (commissions, subscriptions, IAP), AI disclaimer, termination, liability limits, **governing law Delaware, USA**.
- `CONTENT_MODERATION_GUIDELINES`: 3 rules.

**Reusability: good skeleton, needs rewriting before launch.**
- **Inaccurate vs the implementation.**
  - Firebase, GA, and Meta Ads are not used (PostHog is).
  - "Google Cloud" is really Convex (AWS) plus the OpenAI/Google APIs.
  - Photos are said to be "deleted after processing" but are actually retained indefinitely. The file contradicts itself (Data Handling §4 vs Privacy §9).
  - It claims rights (deletion, export) the app doesn't implement.
- **Wrong jurisdiction** for a Kenya-first product. It must address the **Kenya Data Protection Act 2019**:
  - ODPC registration as data controller/processor
  - lawful basis and explicit consent for biometric-like facial images (sensitive personal data)
  - cross-border transfer disclosures (OpenAI/Google/US hosting)
  - a DPO contact
  - a 72-hour breach notice
- **Missing.**
  - Credits terms (non-refundable? expiry? KES pricing)
  - The marketplace role (Nima as intermediary; seller-buyer contract; returns/refunds; delivery via Pick Up Mtaani)
  - Consumer Protection Act (Kenya) returns
  - UGC licence for the social feed
  - Minimum age (the app needs 18+ or parental consent for photo uploads)
  - AI-generated content labelling
  - Dispute resolution in Kenya
- **Reuse** the structure-as-data pattern (`{heading, content, list, subsections}`) and the AI transparency and prohibited-conduct points. Rewrite the rest with counsel.

---

## 8. UI

### Routes (app/)

- **Public:**
  - `/` (GateSplash)
  - `/onboarding`
  - `/sign-in`, `/sign-up`, `/sign-out`, `/callback`
  - `/discover`, `/discover/category/[category]`, `/discover/gender/[gender]`
  - `/look/[id]`
  - `/termsAndConditions`, `/privacyPolicy`
  - `/connect` (partner widget)
  - `/[storeName]/try-on`, `/[storeName]/try-on/[productId]` (seller try-on links)
  - `/wrapped/[year]` (share token)
- **App shell `(main)`:**
  - `/engine` (current Ask Nima: recommendation feed, wardrobe, chat sheet)
  - `/ask`, `/ask/[chatId]` (legacy)
  - `/fitting/[sessionId]`
  - `/product/[id]`
  - `/explore`
  - `/lookbooks`, `/lookbooks/[id]`
  - `/activity`
  - `/messages`, `/messages/[userId]`
  - `/cart`
  - `/orders`, `/orders/[id]`
  - `/credits`
  - `/profile`, `/profile/discarded-looks`
- **Bare:** `/quickTry` (camera try-on).
- **Checkout:** `/checkout`.
- **Seller:**
  - `/seller/onboarding`
  - `/seller` (dashboard)
  - `/seller/products`, `/seller/products/[itemId]/edit`
  - `/seller/orders`, `/seller/orders/[orderId]`
  - `/seller/finance`
  - `/seller/analytics/{revenue,products,customers,engagement,conversion}`
  - `/seller/ai-insights`
  - `/seller/api`
  - `/seller/billing`
  - `/seller/settings`
- **Admin:**
  - `/admin`
  - `/admin/analytics/{cart,chat,connect,looks,saves,social,try-ons,users}`
  - `/admin/items`, `/admin/sellers`, `/admin/billing`, `/admin/connect`, `/admin/wrapped`
- **API:** `/api/chat`, `/api/seller-chat`, `/api/fingo/webhook`. `/api/health` is allowlisted but missing.

### Navigation (`components/Navigation.tsx`)

- **Mobile bottom nav:** Discover, Ask Nima (`/engine`), **Try On** (raised camera button → `/quickTry`), Lookbooks, Profile.
- **Desktop header:** Discover, Ask Nima, Lookbooks, Orders, Profile, plus theme toggle, credits pill (⚡ total → `/credits`), activity, messages, and cart icons.

### Design tokens

"Loro Piana quiet luxury". Defined in `app/globals.css` (Tailwind v4 `@theme inline`), with the brief in `.cursor/rules/ui-colors.mdc`. **Default theme is dark.**

| Token | Light | Dark |
|---|---|---|
| background | #FAF8F5 (Ivory Cream) | #1A1614 (Deep Espresso) |
| surface / card | #F5F0E8 | #252220 |
| surface-alt | #EDE6DC | #302B28 |
| primary | #5C2A33 (Nima Burgundy) | #C9A07A (Rose Gold) |
| primary-hover | #44242D | #D4B896 |
| secondary | #A67C52 (Camel) | #A66B73 (Soft Burgundy) |
| foreground | #2D2926 (Charcoal) | #F5F0E8 |
| muted-foreground | #6B635B | #C4B8A8 |
| text-muted | #9C948A | #8C8078 |
| border / input | #E0D8CC | #3D3835 |
| success | #6B7F5E (Sage) | #8FA881 |
| destructive | #B85C5C | #D4807A |
| warning | #C4A35A | #D4C078 |
| chart-1..5 | #5C2A33 #A67C52 #6B7F5E #C4A35A #8C6A50 | #C9A07A #A66B73 #8FA881 #D4C078 #B8828A |

- **Fonts** (`app/layout.tsx`, next/font): **Cormorant Garamond** (serif, headings), **DM Sans** (body), JetBrains Mono.
- **Radius:** `--radius: 0.5rem`.
- **Motion:** `float`, `pop-in` (spring `cubic-bezier(.34,1.56,.64,1)`), `shimmer`, `pulse-glow`, `word-fade-in`, streaming cursor, `.stagger-1..5`.
- **Bug:** about 44 files use `text-text-primary`, `text-text-secondary`, `text-text-muted`, or `bg-primary-hover`, but these classes are never mapped in `@theme`, so they silently do nothing. CLAUDE.md documents them as if they worked.
- Manifest colours (`#ffffff`/`#000000`) don't match the brand. The viewport sets `userScalable:false` (an accessibility issue).
- Brand assets: `public/nima-logo.png`, `public/nima-mascott.png` (mascot, used as favicon and loader), `public/popup-demo.png`, 8 style-quiz images, sounds `confident-543.mp3` and `wrapped.mp3`.

### Notable components (UX worth re-creating)

- **Onboarding:**
  - `components/onboarding/GateSplash.tsx` (animated chat-bubble splash)
  - `steps/StyleChatStep.tsx` (conversational quiz instead of forms; good pattern)
  - `steps/PhotoUploadStep.tsx` ("Be the model in every look", AI validation feedback)
  - `steps/LoadingStep.tsx` (mascot plus ring, polls the workflow)
  - `steps/SuccessStep.tsx`
- **Engine and chat:**
  - `components/engine/RecommendationFeed.tsx` + `RecommendationCard.tsx` (collage card with "Try it on")
  - `NimaChatSheet.tsx` (bottom-sheet chat that parses commands into looks)
  - `FloatingAskButton.tsx`
  - `WardrobeUploadSheet.tsx`
- **Discover and looks:**
  - `components/discover/LookCard.tsx` / `LookCardWithCreator.tsx` (masonry cards)
  - `CreateLookSheet.tsx`
  - `FloatingLookLoader.tsx` (global progress with sound)
  - `components/looks/ShareLookModal.tsx`, `ShareLookViaDMModal.tsx`, `SaveDiscardModal.tsx`, `RecreateLookButton.tsx`
- **Fitting and purchase:** `components/ask/ProductSwapperModal.tsx` (swap an item within a look), `FittingRoomCard.tsx`, `BuyWithNimaSheet.tsx` (concierge checkout UI).
- **Wrapped:** `components/wrapped/*` (Spotify-Wrapped-style slides; 3 themes: Aurora, Geometric, Fluid).
- **Seller:**
  - `app/(bare)/quickTry/page.tsx` (camera capture UX, gallery fallback)
  - `app/connect/page.tsx` (widget state machine: demo → upload → processing → result → sign-up gate)
  - Seller analytics pages (recharts)
  - `components/seller/ai-insights/SellerAiChatClient.tsx`

---

## 9. Code quality, bugs, tech debt

**General.**
- No tests.
- 263 `console.log`s in the backend and 68 in the frontend. `app/page.tsx` logs the WorkOS id and email.
- 277 `.filter()` uses and 40 full-table `.collect()` scans (27 in `convex/admin/analytics.ts`), despite the CLAUDE.md rules.
- Huge files: `convex/looks/queries.ts` 2,269; `convex/sellers/queries.ts` 2,206; `convex/chat/mutations.ts` 1,840; `app/(main)/discover/page.tsx` 1,199.
- Fake pagination (the cursor is ignored).
- `Math.random` IDs and tokens.
- Convex "explicit typing" boilerplate roughly doubles line counts.

**Duplication.**
- 3 chat UIs, and 2 stylist system prompts.
- Try-on generation is copy-pasted 5×. `convex/workflows/itemTryOn.ts` is a dead duplicate.
- Admin vs seller product forms and tables.
- Formality logic lives in both chat and recommendations.
- Near-identical discover category and gender pages.
- `BUDGET_OPTIONS` is defined twice.

**Security (critical first).**
1. **Account takeover.** `convex/users/mutations.ts getOrCreateUser` looks up the user by **client-supplied `email`** and re-binds `workosUserId` to the caller. The WorkOS webhook `convex/http.ts /webhooks/workos` does **no signature verification** ("disabled for development").
2. **Unauthenticated admin.** `convex/admin/items.ts` (create/update/delete items, upload URLs) has no auth at all. `convex/admin/analytics.ts` (10 queries) and parts of `admin/queries.ts` also lack role checks. `admin/aiActions.ts` is a public OpenAI-spending action. The Wrapped admin functions check only that the caller is logged in.
3. **PII IDOR.** `users.queries.getUser(userId)` and `getUserByWorkosId` return the full user document (email, phone, address) without auth.
4. **Arbitrary storage deletion.** Onboarding image mutations accept any `storageId` and delete it. So do `sellerTryOns.createSellerTryOn` and Connect `photo/save`.
5. **Pricing and payments.**
   - Negative cart quantities (`addToCart`) reduce the order total.
   - The Fingo webhook does not verify the amount.
   - The cart is cleared before payment.
   - The checkout shows 1,500 shipping while the server charges 500.
   - Sellers can mark unpaid orders shipped.
6. **Abuse and cost.**
   - The rate limiter (`convex/lib/rateLimiter.ts`) is never imported, and its write is missing.
   - Unauthenticated seller try-on drains credits; `itemId`/`sellerId` ownership is not checked.
   - Onboarding uploads are unlimited via self-minted tokens.
   - `/api/chat` has no quota and trusts the client profile.
   - Recreate is a free generation.
   - Connect: the guest limit resets per session; GET session doesn't check partner ownership; key comparison isn't constant-time; server-side fetch of partner URLs is an SSRF risk; `auth.ts` is a public token-exchange proxy that attaches the WorkOS secret.
7. **Privacy.**
   - Private looks are readable by ID.
   - Look detail falls back to another user's try-on image.
   - No deletion cascade.
   - `createSeller` overwrites an admin role with `seller`.

**Functional bugs.**
- `createLookFromSelectedItems` charges the credit before validating.
- The item try-on fallback generates without the user photo.
- Failed generations are not refunded.
- The fitting room shows only the first look (TODO at `app/(main)/fitting/[sessionId]/page.tsx:119`).
- `getFeedLooks` would leak private looks if wired up.
- `looks.loveCount` is not maintained.
- `sanitize.isContentSafe` uses global-regex `.test()` (stateful `lastIndex`).
- The order number has no uniqueness check.
- `generateWeeklyRecommendationsForAll` collects all users in one mutation (won't scale).
- The manifest and service worker are never registered.
- The seller API docs hard-code a dev Convex URL (`rare-guineapig-47.convex.site`).

**Dead code.**
- `/ask` routes, orphaned `/explore`
- 6 old onboarding steps, `lib/mock-*.ts` (still the canonical frontend types!)
- `app/actions.ts` web-push, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@convex-dev/workpool`
- `payouts` table, `subscriptionTier`/`dailyTryOn*` fields
- Admin Looks/Users/Orders nav items

**How the product evolved (git log).**
- Dec 2025: Next+Convex init.
- Then, in order: lookbooks, chat plus fitting room, "Nima Wrapped", social/sharing, switch to `gemini-2.5-flash-image` with preference images, self-fit builder, PostHog and security pass, cart/infinite scroll, seller dashboard, KES currency, analytics/activity.
- Feb 2026: T&Cs and policies.
- Then: tier subscriptions, seller AI insights and demographics, **Nima Connect** widget/API (Mar), credits on web, quick try-on plus seller try-on links, Gemini 3.1 flash fallback, photo validation, shortened onboarding.
- Apr 2026: payment webhooks, then the **recommendation engine plus wardrobe plus chat upgrade** (last commits, 2026-04-16).
- Workflow: PR-per-branch merges from `Clint` and `brian-dev` into `main`/`production`, with many "fixed build errors" commits.

---

## 10. Reuse vs discard for the rebuild (Fastify + Prisma + Postgres + WS + Better Auth + Expo)

### REUSE (adapt, don't copy verbatim)

| What | Path | How |
|---|---|---|
| Data model shape | `convex/schema.ts` | Starting point for `schema.prisma`, with the normalisation changes in §3 (TryOnJob, CreditLedger, variants, conversations, shipments, payouts). |
| Try-on pipeline design + prompt templates | `convex/workflows/actions.ts` (`generateLookImage`, `generateItemTryOnImage`, QuickTry/seller variants, `generateContentWithFallback`) | Re-implement as a queue worker (BullMQ/pg-boss) behind a provider interface. Keep the reference-image ordering and "Important:" identity-preservation block. Drop the GPT-4o "prompt director" hop, or make it optional, to cut cost and latency. Never fall back to generation without the user photo. Refund credits on failure. |
| Stylist system prompt + command protocol | `app/api/chat/route.ts` (`NIMA_SYSTEM_PROMPT`, `buildUserContext`, `buildWardrobeContext`) | Port the persona, "don't over-question", wardrobe/new/both, and the formality-keyword rules. Replace the `[MATCH_ITEMS:…]` text tags with **tool calls** (AI SDK tools). Build the user context server-side from the DB. |
| Style-profile, look-selection, caption, rec-comment prompts | `convex/workflows/actions.ts` (`generateStyleProfile`, `selectItemsForLooks`, `generateNimaComment`, `createFallbackLooks`), `convex/recommendations/actions.ts` | Use `generateObject` with zod instead of regex JSON parsing. Keep the deterministic fallback. |
| Outfit composition heuristics | `convex/chat/mutations.ts` (`FORMALITY_KEYWORDS`, `getRequiredFormalityFromOccasion`, `isCompleteOutfit`, coherence scoring), `convex/recommendations/mutations.ts` | Move into a shared `outfit-rules` package used for candidate filtering before LLM ranking. |
| Photo validation prompt + schema | `convex/userImages/actions.ts` | Reuse, but fail closed or retry, not open. |
| Wardrobe extraction prompt | `convex/wardrobe/actions.ts` | Reuse the JSON tagging prompt. Consider real segmentation (rembg / BiRefNet self-hosted) instead of Gemini regeneration, which alters garments. That also becomes the basis for the **ghost-model / seller photo** feature. |
| Product autofill schema/prompt | `convex/sellers/actions.ts` (`productDetailsSchema`) | Reuse for seller listing creation. |
| Seller analyst prompt | `app/api/seller-chat/route.ts` (~line 133) | Reuse, including its privacy rules. |
| Credit constants & packs | `convex/types.ts` (`CREDIT_PACKAGES`, `FREE_WEEKLY_CREDITS`, `TIER_LIMITS`, `TIER_PRICES_KES`), `convex/credits/mutations.ts` (spend order logic) | Reuse the economics as seed config (DB-editable, like `tier_config`). Implement as a ledger. |
| Fingo Pay integration | `convex/credits/actions.ts`, `convex/orders/actions.ts`, `convex/sellers/subscriptionActions.ts`, webhook in `convex/http.ts` (~lines 300–490) | Port the STK push call and the HMAC verification (`t=..,v1=..`, 300 s window, `crypto.subtle.verify`). Add amount verification, event-ID dedupe, and a single payments module. Keep the `nima_cr_`/`nima_ord_`/`nima_sub_` reference convention. |
| Kenyan phone regex, KES budget bands, occasions, style-quiz taxonomy | `convex/credits/mutations.ts`, `components/onboarding/steps/StyleChatStep.tsx`, `components/onboarding/types.ts`, `public/*.png` quiz images | Reuse directly (Expo onboarding). |
| Onboarding UX (4-step, conversational quiz, photo-first) | `components/onboarding/*`, `memory/project_onboarding_flow.md` | Re-create in Expo. Allow **guest** quiz and photo before auth (tie to a device session in Better Auth). |
| Design tokens + fonts + motion | `app/globals.css`, `.cursor/rules/ui-colors.mdc`, `app/layout.tsx` | Port into the Expo theme (NativeWind/Tamagui tokens). Define the `text-*` tokens properly. |
| Brand assets | `public/nima-logo.png`, `public/nima-mascott.png`, quiz images, sounds | Reuse (confirm ownership/licence). |
| Wrapped concept + copy | `convex/wrapped/constants.ts`, `components/wrapped/*` | Later phase. The rule-based generator is fine. |
| Connect B2B widget concept | `convex/connect/*`, `app/connect/page.tsx`, `/api/v1/*` in `convex/http.ts` | Later phase. Redesign the auth (full-key hash, constant-time compare, partner-scoped sessions, SSRF-safe fetch). |
| Seller try-on links | `app/[storeName]/try-on/*`, `convex/sellerTryOns/*` | Good growth feature. Needs rate limits, captcha, and ownership checks. |
| Legal structure | `Policies.ts`, `T&Cs.ts` | Keep the data-as-TS pattern and AI transparency points. Rewrite the content for Kenya DPA / marketplace / credits (see §7). |
| Analytics event taxonomy | `lib/analytics.ts` | Reuse event names with self-hosted PostHog. |

### DISCARD

- **Convex, WorkOS, and the Next.js web shell entirely.** Replaced by Fastify/Prisma/Postgres/Better Auth/Expo. That includes `middleware.ts`, `components/ConvexClientProvider.tsx`, `UserDataSync.tsx`, `convex/auth*.ts`, and `webhooks/workos.ts`.
- **All authorization code.** Rewrite it from scratch with centralized policy checks (per §9, the legacy checks cannot be trusted).
- **The rate limiter and sanitizer** (`convex/lib/*`). Use Fastify rate-limit plus zod validation.
- **Dead and legacy code:**
  - `/ask` chat pages and the RN `sendChatMessage` duplicate
  - `workflows/itemTryOn.ts`
  - old onboarding steps
  - `lib/mock-*.ts`
  - `app/actions.ts` (web-push)
  - `payouts` (Stripe) and `subscriptionTier`/`dailyTryOn*` fields
  - `getFeedLooks` in its current form
- **Fake payment UIs** (`BuyWithNimaSheet` setTimeout, ComingSoon modals). Build a real checkout with Pick Up Mtaani delivery options.
- **Admin analytics built on full-table scans.** Use SQL aggregates or materialized views.
- **Text-tag command parsing** (`[MATCH_ITEMS]`). Use tool calling.
- **The Vercel AI Gateway dependency.** Call providers directly, or via a self-hosted gateway (LiteLLM).
- **Unused dependencies:** `@ai-sdk/anthropic`, `@ai-sdk/google`, `@convex-dev/workpool`, `web-push`.

### Build new (absent in legacy)

- Ghost-model / seller photo processing
- Pick Up Mtaani logistics
- Payouts and commission
- Seller verification (KYC)
- Refunds and returns
- Stock/variants
- Text DMs with realtime WebSockets
- A true personalised For-You feed (interaction signals, embeddings via pgvector)
- Account deletion and data export
- A credit ledger with refunds
- Moderation of UGC and photos
- Push via Expo with a proper token lifecycle
