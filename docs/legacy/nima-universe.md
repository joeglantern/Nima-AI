# Legacy Audit: `Nima-Universe` (newest previous-team repo)

- **Source:** `reference/Nima-Universe` (paths below are relative to that folder unless stated)
- **History:** 37 commits, 2026-04-22 to 2026-07-22. Authors: `4kClinton` (almost all of it), then `VEE$MONEYYY` (the last 5 commits, all App Store prep)
- **Audited:** 2026-09-21
- **Verdict:** A feature-rich Convex monorepo that works end to end: AI stylist, Gemini try-on, a social layer, a marketplace, M-Pesa via Fingo, a seller portal, a tailor MVP, a B2B try-on API and Wrapped. The data model and prompts are worth mining. The code itself should **not** be ported. It is Convex-bound, has several security and cost holes, and duplicates logic across two clients.

---

## 0. How the code evolved (git log)

| Date | Milestone |
|---|---|
| 2026-04-22 | `Initial monorepo: packages/backend + apps/web + apps/native`. The code was consolidated from earlier repos, so most features predate this commit. |
| 04-23 to 04-27 | Ghost mannequin feature; Convex `_generated` committed so Vercel and EAS can build; Metro monorepo fixes |
| 04-29 | Seller bulk upload, watermark, product edit |
| 05-04 | Referrals, analytics, credits analytics, "Delete my Account", gender validator |
| 05-07 | Seller Shopify scraper |
| 05-15 to 05-23 | **Nima Tailored** (made-to-measure) MVP: schema, customer routes, seller portal, admin QC and payouts, seed data |
| 06-05 | "Native Upgrade & Tracking seller try on Data" (referrer and UTM attribution) |
| 07-16 | IG Stores analytics, item-source analytics, **multi-provider auth refactor** (`authIdentities` table, `lib/auth.ts`), native Google disabled |
| 07-20 to 07-22 | App Store release work: iOS builds, Google sign-up, Help/Support page, Husky fix, **credits badge removed on iOS** |

---

## 1. Purpose and structure

npm-workspaces monorepo. Root `package.json` declares the workspaces `apps/web`, `apps/native` and `packages/backend`. There is one shared Convex deployment (dev: `gallant-tortoise-992`).

| Path | What it is | Framework / versions |
|---|---|---|
| `packages/backend/` (`nima-backend`) | **Convex backend**: schema, queries, mutations, actions, HTTP routes, crons, workflows | `convex ^1.31.7` (root pins `^1.42.3`), `@convex-dev/workflow ^0.3.4`, `ai ^5.0.108`, `@ai-sdk/openai ^2.0.80`, `@google/genai ^1.32.0`, `resend ^6.9.2`, `jimp`, `zod ^4` |
| `apps/native/` (`nima-native`) | **Consumer mobile app** (iOS/Android; web via RN-web). Consumer features only, no seller or admin UI. | Expo SDK **54**, RN **0.81.5**, React 19.1, Expo Router 6 (typed routes), NativeWind 4 + Tailwind 3.4, Reanimated 4, gorhom bottom-sheet 5, expo-image, expo-camera, expo-notifications, expo-apple-authentication, `@react-native-google-signin`, Sentry RN 7.2, Jest + RNTL |
| `apps/web/` (`nima-web`) | **Next.js web app**: the full consumer app **plus** the seller portal, admin console, tailor portal, Nima Connect widget, Wrapped, legal and support pages | Next **16.1**, React 19.2, Tailwind **4**, shadcn/Radix (about 50 `components/ui/*`), `@workos-inc/authkit-nextjs`, AI SDK 5 (`useChat`), framer-motion, recharts, posthog-js, web-push, react-hook-form + zod, sonner, vaul |
| `apps/rules/*.mdc` | Cursor rules: `project-description.mdc` (the original **PRD**, Jan 2025), `ui-colors.mdc` (design system), plus Convex coding rules | n/a |
| `convex/_generated/`, `apps/native/convex/_generated/` | **Duplicated copies** of the Convex generated API, kept so Vercel and EAS resolve imports. Tech debt. | n/a |
| Root | `APP_STORE_REVIEW_REPLIES.md`, `eas.json`, `.husky/pre-push` (runs the native Jest suite), a stray `WhatsApp Image ...jpeg` | n/a |

Hosting: web on **Vercel** (`www.shopnima.ai`); native via **EAS** (project `2cd055b1-...`, owner `nima-ais-organization`). Bundle IDs: iOS `ai.shopnima.app`, Android `com.nima.app`. URL scheme `shopnima://`. Universal links cover `/look/`, `/product/`, `/lookbook/` and `/callback` (`apps/native/public/.well-known/*`).

### Secrets check
- `.env.local.example` (root), `apps/web/.env.local.example`, `apps/native/.env.local.example` and `packages/backend/.env.local.example` contain **placeholder values** (for example `your...`) plus the non-secret dev Convex URL and WorkOS **client IDs**. No real API keys were found in the examples.
- A **Sentry DSN** is hardcoded in `apps/native/app/_layout.tsx`. It is public-ish but should move to env.
- `apps/native/INSTRUCTIONS.md` contains the WorkOS staging **client ID**. This is a public identifier, not a secret.
- Signing credentials and Firebase files are gitignored and **not present**.

---

## 2. Tech stack and third-party services

| Concern | Service / library | Paid? | Where |
|---|---|---|---|
| Backend / DB / storage / realtime | **Convex** (managed): DB, file storage (`_storage`), scheduler, crons, `@convex-dev/workflow` | Paid SaaS (free tier) | `packages/backend/convex/*` |
| Auth | **WorkOS AuthKit** (hosted email/password, PKCE on native), **native Sign in with Apple** and **native Google**. All are validated as Convex `customJwt` providers. Identities are unified through the `authIdentities` table. | WorkOS has a free tier to 1M MAU, then paid | `convex/auth.config.ts`, `convex/lib/auth.ts`, `convex/auth.ts` (code exchange), `convex/webhooks/workos.ts`, `apps/native/lib/auth.ts`, `apps/web/proxy.ts` |
| LLM (text) | **OpenAI** via Vercel AI SDK. Models: `gpt-4.1` (web chat), `gpt-4o-mini` (native chat, "Nima Says", rec comments, outfit fallback), `gpt-4o` (try-on prompt writer, look curation, vision tagging, photo validation), `o3-mini` (style profile). Optional **Vercel AI Gateway** (`VERCEL_AI_GATEWAY_API_KEY`). | Paid | see section 6 |
| Image generation / try-on | **Google Gemini** (AI Studio key `GOOGLE_AI_STUDIO_KEY`). Primary model `gemini-3-pro-image-preview` ("Nano Banana Pro"); fallback on 503 is `gemini-3.1-flash-image-preview`. | **Paid, and the main cost driver** | `convex/workflows/actions.ts`, `convex/wardrobe/actions.ts`, `convex/sellers/actions.ts`, `convex/admin/aiActions.ts`, `convex/connect/actions.ts` |
| Payments | **Fingo Pay** M-Pesa STK Push (`POST https://api.fingopay.io/v1/mpesa/charge`, Bearer `FINGO_LIVE_KEY`, `Idempotency-Key`). Webhook signed with HMAC-SHA256 (`X-Fingo-Signature: t=..., v1=...`, 5-minute replay window). One webhook handles credits, orders, seller subscriptions and tailored orders. | Transaction fees | `convex/credits/actions.ts`, `convex/orders/actions.ts`, `convex/sellers/subscriptionActions.ts`, `convex/tailor/tailoredOrders/*`, `convex/http.ts` (`/webhooks/fingo`), `apps/web/app/api/fingo/webhook/route.ts` (proxy) |
| Payouts | Tailor payouts via Fingo/M-Pesa (`payoutAction.ts`). The `payouts` table still has a legacy `stripeTransferId`; Stripe is not actually used. | n/a | `convex/tailor/tailoredOrders/payoutAction.ts` |
| Push | **Expo Push API** (`https://exp.host/--/api/v2/push/send`), tokens in `push_tokens`; **Web Push/VAPID** (`web-push`, `public/sw.js`) on web | Free | `convex/notifications/actions.ts`, `apps/native/lib/hooks/usePushNotifications.ts`, `apps/web/lib/utils/notifications.ts` |
| Email | **Resend** (seller new-order email; the call site is currently commented out) | Paid (free tier) | `convex/emails/actions.ts`, `templates.ts` |
| WhatsApp / SMS | **WhatsApp Cloud API** with fallback to **Africa's Talking SMS** (tailor order alerts) | Paid | `convex/tailor/notifications/actions.ts` |
| Analytics | **PostHog** (web, `posthog-js`); native `lib/analytics.ts` is a **no-op shim** (the SDK was never installed); a large custom admin analytics layer in Convex | Free tier | `apps/web/components/PostHogProvider.tsx`, `apps/web/lib/analytics.ts`, `convex/admin/analytics.ts` (2,467 lines) |
| Error monitoring | **Sentry** (native, with session replay and `sendDefaultPii: true`) | Paid (free tier) | `apps/native/app/_layout.tsx` |
| Scraping | Shopify `/products.json` scraper (Next API route) | Free | `apps/web/app/api/scrape-store/route.ts`, `convex/sellers/actions.ts:importScrapedProducts` |
| Logistics | **None.** No Pick Up Mtaani or any courier integration. Flat shipping fee. | n/a | n/a |

### 2.1 How virtual try-on works (exact)

All variants use **Gemini image models with reference images**. There is no dedicated try-on model (no FASHN or Kolors, even though the schema comments mention them).

Common pipeline, from `convex/workflows/actions.ts`:
1. A client mutation creates a record with status `pending`, **deducts credits**, and schedules an internal action (`ctx.scheduler.runAfter(0, ...)`). The UI subscribes reactively to the record status (`pending` → `processing` → `completed`/`failed`).
2. The action loads the user's **primary photo** (`user_images.isPrimary`) and the garment image(s) (`item_images.isPrimary`, from Convex storage or an external URL). It `fetch`es both and base64-encodes them.
3. **Prompt writer step (multi-item look and single item):** `gpt-4o` acts as a "fashion photography director" and writes a prompt of 400 to 500 characters or fewer from the item descriptions (`"{colors} {name} by {brand}"`, category, description).
4. It calls `genAI.models.generateContent({ model: 'gemini-3-pro-image-preview', contents: [text, userImage, ...itemImages], config: { responseModalities: ['TEXT','IMAGE'] } })`. The text part is a fixed wrapper: "Reference Image 1: the person ... Reference Image N: item ...", followed by the generated prompt, followed by "Important: keep face, body type & size, identity exactly ... dress them in ALL items ... professional fashion photograph". A look sends at most 1 user image plus 5 item images (the comment cites a 14-image limit).
5. On a 503 it retries with `gemini-3.1-flash-image-preview`. If no image part comes back, it retries once with a **simpler prompt**.
6. It takes the first `inlineData` part, stores it as PNG in Convex storage, and writes `look_images` / `item_try_ons.storageId` (or `resultStorageId`) with `status: completed`. Errors are mapped to friendly messages by `toFriendlyErrorMessage()`.

| Variant | Entry mutation | Action | Credits | Notes |
|---|---|---|---|---|
| **Look (multi-item) try-on** | `workflows/index.ts:startOnboardingWorkflow` (free, first time), `startGenerateMoreLooks` (3), `chat/mutations.ts:createLooksFromChat` (3), `looks/mutations.ts:createLookFromSelectedItems` (1) | `generateLookImage` | see left | Also includes the user's **wardrobe items** (background-removed images) as references |
| **Single item try-on** | `workflows/index.ts:startItemTryOn` | `generateItemTryOnImage` | 1 (cached result is free; retry after failure costs 1) | Keyed by (item, user, size, color). Selected color is injected into the prompt. The duplicate implementation in `workflows/itemTryOn.ts` is **dead code**. |
| **Quick Try-On** (camera: point at a garment in real life) | `quickTryOns/mutations.ts` | `generateQuickTryOnImage` | 1 | No prompt-writer step; fixed one-line prompt |
| **Seller try-on link** (public `/{storeName}/try-on/{productId}`, customer uploads a photo) | `sellerTryOns/mutations.ts:createSellerTryOn` | `generateSellerTryOnImage` | 1 **seller** credit (`sellers.tryOnCredits`, 100 granted on seller creation) | Records `referrerHost` and `utmSource` for IG attribution |
| **Nima Connect** (B2B widget/API for external stores) | `http.ts /api/v1/sessions*` | `connect/actions.ts:generateConnectTryOn` | Partner monthly quota; 1 user credit if linked to a Nima user | API key `nima_pk_...` stored as a SHA-256 hash plus a prefix; guest try-on supported |

The **onboarding workflow** (`convex/workflows/onboarding.ts`, durable `@convex-dev/workflow`) runs in four steps:
- **Step 0:** `o3-mini` writes a rich style profile, saved to `users.styleProfile`.
- **Step 1:** `gpt-4o` picks 3 looks of 2, 3 and 4 items from up to 500 catalog items listed inline in the prompt. Categories are hard-filtered by gender in code, and there is a rule-based fallback.
- **Step 2:** images for the 3 looks are generated in parallel.
- **Step 3:** a push notification is sent.

Other image jobs on the same Gemini model:
- **Ghost mannequin:** `sellers/actions.ts:generateGhostMannequin` and `admin/aiActions.ts:generateGhostMannequin`.
- **Wardrobe:** `wardrobe/actions.ts:processWardrobeUpload`. `gpt-4o` identifies up to 12 items; Gemini then generates an isolated product shot of each on white. Closet-scan mode does the same per item.

---

## 3. Data model (Convex schema)

Source: `packages/backend/convex/schema.ts` (1,554 lines, about 43 tables). All tables have Convex `_id` and `_creationTime`; most also have `createdAt` and `updatedAt` (epoch ms).

Money is described as "cents" in the comments, but in practice **prices are whole KES**. The scraper stores `Math.round(price)`, and Fingo gets `total * 100`.

### 3.1 Compact listing

| Table | Key fields | Indexes / notes for Prisma |
|---|---|---|
| **users** | `email`, `emailVerified`, `workosUserId?`, `username?`, `firstName`, `lastName`, `profileImageId/Url`, `gender (male/female/prefer-not-to-say)`, `age`, `stylePreferences[]`, `shirtSize`, `waistSize`, `height`+`heightUnit`, `shoeSize`+`shoeSizeUnit(EU/US/UK)`, `country`, `currency`, `budgetRange(low/mid/premium)`, `occasions[]`, `phoneNumber`, `phoneVerified`, `subscriptionTier(free/style_pass/vip)` (unused), `dailyTryOnCount/ResetAt` (deprecated), **`credits`** (purchased), **`freeCreditsUsedThisWeek`**, **`weeklyCreditsResetAt`**, `onboardingCompleted`, `onboardingWorkflowStartedAt`, `styleProfile (any: text or JSON)`, `isActive`, `role(user/admin/seller)`, `savedShippingAddress{}`, `referralCode` | unique email, username, referralCode |
| **authIdentities** | `userId`, `issuer`, `subject`, `provider(workos/apple/google)`, `email` | unique (issuer, subject). Better Auth's `account` table replaces this. |
| **referrals** | `referrerId`, `refereeId`, `referralCode`, `status(pending/credited)`, `creditAmountKes (500)`, `creditedAt`, `expiresAt (+14d)`, `usedAt` | n/a |
| **user_images** | `userId?`, `storageId`, `onboardingToken?` (pre-auth upload), `filename`, `contentType`, `sizeBytes`, `imageType(full_body/upper_body/face/other)`, `isPrimary`, `status(onboarding/pending/processed/failed)`, `processedUrl` | max 10 per user |
| **items** | `sellerId?` (null means Nima-curated), `publicId (item_xxx)`, `sku`, `name`, `brand`, `description`, `category(top/bottom/dress/outfit/outerwear/shoes/accessory/bag/jewelry/swimwear)`, `subcategory`, `gender(male/female/unisex)`, `price`, `currency`, `originalPrice`, `colors[]`, `sizes[]`, `material`, `tags[]`, `occasion[]`, `season[]`, `sourceStore`, `sourceUrl`, `affiliateUrl`, `inStock`, `stockQuantity`, `isActive`, `isFeatured`, `kind(ready_made/tailored_design)`, counters (`viewCount`, `saveCount`, `purchaseCount`, `tryOnCount`, `lookbookSaveCount`, `cartAddCount`, `lookInclusionCount`) | full-text search on `name` filtered by category, gender, isActive. Use Postgres FTS / pg_trgm (+ pgvector later). |
| **item_images** | `itemId`, `storageId?` / `externalUrl?`, `altText`, `sortOrder`, `isPrimary`, `imageType(front/back/side/detail/model/flat_lay)` | n/a |
| **looks** | `publicId (look_xxx)`, `itemIds[]`, `wardrobeItemIds[]`, `totalPrice`, `currency`, `name`, `styleTags[]`, `occasion`, `season`, **`nimaComment`**, `targetGender`, `targetBudgetRange`, `isActive`, `isFeatured`, **`isPublic`** (Explore), **`sharedWithFriends`**, `viewCount`, `saveCount`, `selectedSize/Color`, `generationStatus(pending/processing/completed/failed)`, `status(pending/saved/discarded)`, `createdBy(system/user)`, `creatorUserId`, `creationSource(chat/apparel/recreated/shared/system)`, `originalLookId` | The item arrays should become a `LookItem` join table |
| **look_images** | `lookId`, `userId`, `storageId?`, `userImageId`, `status`, `generationProvider`, `generationJobId`, `errorMessage`, `expiresAt` | Generated try-on image per (look, user) |
| **item_try_ons** | `itemId`, `userId`, `storageId?`, `userImageId`, `selectedSize`, `selectedColor`, `status`, `generationProvider`, `errorMessage`, `expiresAt` | Cache key (item, user, size, color) |
| **quick_try_ons** | `userId`, `userImageId`, `capturedItemStorageId`, `resultStorageId`, `status`, `errorMessage` | n/a |
| **seller_try_ons** | `sellerId`, `itemId`, `customerImageStorageId`, `resultStorageId`, `status`, `referrerUrl`, `referrerHost`, `utmSource` | n/a |
| **lookbooks** | `userId`, `name`, `description`, `coverImageId`, `autoCoverItemId`, `isPublic`, `shareToken`, `isCollaborative`, `collaboratorIds[]` (future), `itemCount`, `isArchived` | n/a |
| **lookbook_items** | `lookbookId`, `userId`, `itemType(look/item)`, `lookId?`, `itemId?`, `note`, `sortOrder` | Polymorphic. Try-ons are saved via a separate mutation. |
| **threads** | `userId`, `title`, `contextType(general/look/item/outfit_help)`, `contextLookId`, `contextItemId`, `isArchived`, `lastMessageAt`, `messageCount` | Ask Nima conversations |
| **messages** | `threadId`, `userId`, `role(user/assistant)`, `content`, `messageType(text/fitting-ready/no-matches)`, `lookIds[]`, `attachments[{type,storageId,lookId,itemId}]`, `model`, `tokenCount`, `status(sent/streaming/error)` | n/a |
| **friendships** | `requesterId`, `addresseeId`, `status(pending/accepted)` | Friend requests rate-limited per day |
| **user_blocks** | `blockerId`, `blockedId` | App Store 1.2. **Recorded but not enforced server-side.** |
| **reports** | `reporterId`, `targetUserId`, `targetType(user/message/look)`, `targetId`, `reason`, `status(pending/reviewed/actioned/dismissed)` | n/a |
| **direct_messages** | `senderId`, `recipientId`, `lookId`, `isRead` | **Look-sharing only; no text DMs** |
| **look_interactions** | `lookId`, `userId`, `interactionType(love/dislike/save/recreate)`, `seenByOwner` | Drives the Activity feed |
| **item_likes** | `userId`, `itemId` | n/a |
| **cart_items** | `userId`, `itemId`, `quantity`, `selectedSize`, `selectedColor`, `addedAt` | n/a |
| **orders** | `userId`, `orderNumber (ORD-YYYYMMDD-XXXX)`, `shippingAddress{fullName,addressLine1/2,city,state,postalCode,country,phone}`, `subtotal`, `serviceFee` (10%), `shippingCost` (flat 500), `total`, `currency`, `paymentStatus(pending/paid/failed/refunded)`, `paymentMethod`, `merchantTransactionId`, `mpesaPhoneNumber`, `status(pending/processing/partially_shipped/shipped/delivered/cancelled)` | n/a |
| **order_items** | `orderId`, `sellerId?`, `itemId`, snapshot (`itemName`, `itemBrand`, `itemPrice`, `itemImageUrl`), `quantity`, `size`, `color`, `lineTotal`, `fulfillmentStatus`, `trackingNumber`, `trackingCarrier`, `shippedAt`, `deliveredAt` | Multi-seller split fulfillment |
| **payouts** | `sellerId`, `periodStart/End`, `grossRevenue`, `netAmount`, `status`, `stripeTransferId`, `paidAt`, `failureReason` | Largely unused |
| **credit_purchases** | `userId`, `creditAmount`, `priceKes`, `phoneNumber`, `merchantTransactionId`, `fingoTransactionId`, `status(pending/completed/failed)`, `failureReason` | n/a |
| **push_tokens** | `userId`, `token`, `platform(ios/android/web)` | n/a |
| **sellers** | `userId`, `slug`, `shopName`, `description`, `logoStorageId`, `bannerStorageId`, `contactEmail`, `contactPhone`, `websiteUrl`, `verificationStatus(pending/verified/rejected)`, `verificationNotes`, `tier(basic/starter/growth/premium)`, `isActive`, **`tryOnCredits`**, `watermarkEnabled`, tailor fields (`sellerType`, `weeklyCapacity`, `skillTags[]`, `turnaroundDays{casual,formal,traditional,structured}`, `laborPricing[{garmentType,priceKES}]`), `inventoryLastRefreshedAt` | n/a |
| **tier_config** | `tier`, `maxProducts`, `revenueChartDays`, `orderHistoryDays`, `topProductsLimit`, `showEngagementCounts`, `showCartCounts`, `priceKes` | Admin-editable |
| **seller_subscriptions** | `sellerId`, `tier`, `status(pending/active/expired/cancelled/failed)`, `periodStart/End (+30d)`, `amountKes`, `phoneNumber`, `merchantTransactionId (nima_sub_...)`, `fingoTransactionId` | n/a |
| **seller_chat_messages** | `sellerId`, `role`, `content` | Premium AI analyst |
| **api_partners** | `name`, `slug`, `websiteUrl`, `apiKeyHash`, `apiKeyPrefix`, `allowedDomains[]`, `webhookUrl/Secret`, `plan(free/starter/growth/enterprise)`, `monthlyTryOnLimit` (50/500/5000/999999), `tryOnsUsedThisMonth`, `billingResetAt`, `sellerId?` | Nima Connect |
| **api_sessions** | `partnerId`, `sessionToken`, `nimaUserId?`, `guestFingerprint`, `externalProductId/Url`, `productImageUrl`, `productName`, `productCategory`, `trackingId`, `guestImageStorageId`, `resultStorageId`, `guestTryOnUsed/Count`, `status (7 states)`, `expiresAt` | n/a |
| **api_usage_logs** | `partnerId`, `sessionId`, `eventType(session_created/photo_uploaded/tryon_generated/tryon_failed/user_converted/item_added_to_cart/item_purchased)`, `wasAuthenticated`, `generationTimeMs`, `itemValue`, `currency`, `trackingId` | n/a |
| **wardrobeItems** | `userId`, `imageStorageId` (cleaned), `originalImageStorageId`, `description`, `category`, `subcategory`, `tags[]`, `color`, `season[]`, `formality(casual/smart-casual/semi-formal/formal/athletic)`, `source(single_upload/closet_scan)` | n/a |
| **recommendations** | `userId`, `itemIds[]`, `wardrobeItemIds[]`, `isWardrobeMix`, `occasion`, `nimaComment`, `status(pending_comment/active/expired/tried_on)`, `weekOf`, `expiresAt` | Weekly "For You" feed |
| **wrapped_settings** / **user_wrapped** | Year-end recap: `styleEra`, `topItems[]`, `colorPalette[]`, `moodSwings[]`, `topBrands[]`, `personalityType`, `trendsAhead/Skipped`, `mostSavedLookId`, totals, `shareToken` | Nice-to-have |
| **fabrics**, **tailoredOrders**, **tailorInspirations**, **tailorInspirationChoices**, **measurements** | Tailor MVP: fabric stock (meters available/reserved, price per meter), a 12-state tailored order with `statusHistory[]` (payout = 80% of retail), inspirations that tailors accept or skip, per-garment measurement sets (`source: form_upload/cv_landmarking`) | Out of scope for the brief, but a good reference |

### 3.2 Lessons for the Prisma schema
- Keep `publicId` slugs (`item_xxx`, `look_xxx`) for shareable URLs.
- Store money as integer KES with one clear convention.
- Replace the denormalized `itemIds[]` arrays with join tables: `LookItem`, `RecommendationItem`, `LookWardrobeItem`.
- Replace `credits` + `freeCreditsUsedThisWeek` on `users` with an append-only **`CreditLedger`** (grant/spend/purchase/refund, with a reason and a reference). Convex's mutable counters make auditing and refunds impossible.
- Unify the four try-on tables (`look_images`, `item_try_ons`, `quick_try_ons`, `seller_try_ons`, plus `api_sessions` results) into one `TryOnJob` table with a `kind` column and a join to the inputs.
- `styleProfile: any` and `measurements.values: any` should be typed JSON (zod-validated).

---

## 4. Features: implemented vs stubbed (mapped to the brief)

Legend: **Done** = implemented and wired end to end; **Partial** = implemented but with gaps; **Stub** = stubbed or placeholder; **Missing** = absent.

| Brief feature | Status | Notes / paths |
|---|---|---|
| Guest browsing | **Partial** | **Web:** `/discover`, `/look/*` and the seller try-on pages are public (`apps/web/proxy.ts`). **Native: no guest mode.** Unauthenticated users see `GateSplash` only (`apps/native/app/index.tsx`); onboarding requires auth. Photos *can* be uploaded pre-auth using an `onboardingToken` (`userImages/mutations.ts: generateOnboardingUploadUrl`, `claimOnboardingImages`). |
| Questionnaire / onboarding | **Done** | Current flow (4 steps): **Photo upload → "StyleChat"** (chat-style sub-stages: gender → style vibe cards (pick 2 or more of 8) → occasions → budget) **→ Loading → Success**. See `apps/*/components/onboarding/OnboardingWizard.tsx`, `steps/StyleChatStep.tsx`, `types.ts` (budget tiers: Smart Saver up to KES 2,000 / Best of Both KES 2,000–10,000 / Treat Yourself KES 10,000+; 6 occasions; 8 vibe cards with images in `assets/`). The old steps (`WelcomeStep`, `GenderAgeStep`, `StyleVibeStep`, `SizeFitStep`, `LocationBudgetStep`, `AccountStep`) are **dead code**. Sizes are collected later in Profile → Style & Fit. |
| Photos | **Done** | Upload, primary flag, image type; **AI photo validation** with `gpt-4o` (face visible and clear, quality) in `userImages/actions.ts`, which fails open. Profile → Photos tab. Max 10. |
| For You feed | **Done** | Native tab "For You" = `app/(tabs)/engine.tsx`: **weekly recommendations** (Monday cron, rule-based formality matching plus `gpt-4o-mini` comments, `recommendations/*`) plus a wardrobe section. Onboarding-generated personal looks show on **Discover** (`(tabs)/discover.tsx`), along with a catalog grid, category and gender pages, and "generate more looks". |
| Explore / social | **Partial** | Web `/explore` exists (public looks, friends' looks: `looks/queries.ts:getPublicLooks`, `getFriendsLooks`). **Native `app/explore.tsx` is an empty placeholder.** Also present: friends (requests/accept), love/dislike/save interactions, an activity feed (`app/activity.tsx`), and a share/unshare look publicly or with friends. |
| Ask Nima chat | **Done** | Web: streaming `/api/chat` (gpt-4.1, AI SDK `useChat`). Native: non-streaming Convex action `chat/actions.ts:sendChatMessage` (gpt-4o-mini). The assistant emits command tags `[MATCH_ITEMS:occasion\|source]`, `[REMIX_LOOK:...]` and `[MIX_LOOKS:...]`; the client parses them and calls `chat/mutations.ts:createLooksFromChat` / `createRemixedLook` / `createMixedLook`, which do rule-based item matching with formality levels plus a GPT fallback (`composeOutfitWithAI`). This creates 3 looks (3 credits) and a **fitting-room** card linking to `/fitting/[lookIds]`. Threads and messages are persisted. **Visual search** (upload a photo, find similar) is web-only: `search/visualSearch.ts`. |
| Virtual try-on | **Done** | See section 2.1. Covers single item (product page), full look, Quick Try-On (camera modal from the centre tab), seller links and Connect API. |
| Recreate look | **Partial** | `looks/mutations.ts:recreateLook` copies another user's look (private) and generates *your* try-on image, then notifies the original creator. **It charges no credits** (a cost hole). |
| Wardrobe | **Done** | `wardrobe/*`: single upload or closet scan, AI tagging, background-cleaned images, used in chat (`source=wardrobe/both`), in recommendations ("wardrobe mix") and in try-on references. UI: `components/wardrobe/WardrobeUploadSheet.tsx`, native For You tab. |
| Lookbooks | **Done** | CRUD, save looks, items or try-ons, notes, share token, liked items, saved looks, discarded looks with restore. Collaboration fields exist but are unused. |
| DMs / sharing | **Partial** | DMs are **look-sharing only** (`direct_messages` has no text field). Native `messages/index.tsx` and `[userId].tsx`. Also: share via native share sheet and deep links, and "share to friend" (`ShareLookViaDMModal`). No realtime text chat and no typing or read UX beyond `isRead`. |
| Ghost model (seller photo processing) | **Done (web seller portal)** | `sellers/actions.ts:generateGhostMannequin` (Gemini ghost-mannequin prompt). Also AI product-detail extraction from an image (`generateProductDetails`, gpt-4o `generateObject`), bulk upload, watermarking (client-side canvas, `apps/web/lib/utils/watermark.ts`), and a Shopify store importer. |
| Cart / checkout / Fingo payments | **Done** | Cart and checkout work on native (`app/cart.tsx`, `app/checkout.tsx`) and web. Checkout = shipping address plus M-Pesa phone → `orders/mutations.ts:createOrder` → Fingo STK push → webhook → `completeOrderPayment`; the client polls `getOrderPaymentStatus`. Fees: **10% service fee plus KES 500 flat shipping**. "Buy the whole look" on web shows a **"Purchases Coming Soon"** modal, but add-to-cart works. |
| Logistics (Pick Up Mtaani) | **Missing** | No courier integration. Sellers set `trackingNumber` and `trackingCarrier` manually (`sellers/mutations.ts:updateOrderItemStatus`). |
| Seller side / store / dashboard | **Done (web only)** | `/seller` landing page and onboarding; dashboard, products (CRUD, AI generate, bulk upload), orders (per-item fulfillment), analytics (conversion, customers, engagement, products, revenue), finance, settings, **billing (tier subscriptions via M-Pesa)**, **API (Nima Connect keys)**, **AI insights chat (Premium)**. Public store `/shop/[slug]`; try-on links `/[storeName]/try-on/[productId]`. **Tailor** portal under `/seller/tailor/*`. Admin console under `/admin/*` (sellers, items, billing, connect, QC, payouts, inspirations, wrapped, 12 analytics pages). |
| Credits / limits | **Done (with holes)** | See section 5. Some rate limits are inline (10 look creations per hour; friend requests per day). `lib/rateLimiter.ts` is **defined but never used**. |
| Privacy | **Partial** | Delete account (`users/actions.ts:deleteMyAccount` → `deleteUserData`) deletes rows plus the WorkOS user, **but leaves storage blobs** (user photos and generated images stay in `_storage`). It also skips `authIdentities`, `wardrobeItems`, `quick_try_ons`, `recommendations`, `user_blocks`, `reports`, `measurements`, `tailoredOrders` and `seller_try_ons`, and it deletes order financial records outright. Other pieces: privacy policy and T&Cs pages (`apps/web/Policies.ts`, `T&Cs.ts`), block/report (`components/moderation/ModerationMenu.tsx`), per-look public / friends-only visibility, private-by-default recreated looks. Sentry runs with `sendDefaultPii: true` plus session replay (a privacy concern for body photos). Convex storage URLs are unauthenticated if leaked. |
| Extras not in the brief | n/a | Nima Wrapped (year-end recap, cron plus 3 animated themes, web), referrals (code generation only; apply and redeem are **never wired in the UI** and never applied to order totals), Nima Connect B2B API, the Tailor MVP, IG-store attribution analytics, and a Premium seller AI analyst |

---

## 5. Credits system

Constants live in `packages/backend/convex/types.ts`. Logic is in `convex/credits/{mutations,actions,queries}.ts`.

- **Free grant:** `FREE_WEEKLY_CREDITS = 5` per rolling week. The reset is lazy: `shouldResetWeeklyCredits()` checks `now - weeklyCreditsResetAt >= 7d` on read and deduct. It is tracked as `freeCreditsUsedThisWeek` (0–5), and unused free credits don't roll over.
- **Spend order:** free weekly credits first, then purchased `users.credits`. `deductCredit({userId, count})` is an internal mutation that returns `insufficient_credits`. At 2 or fewer remaining it schedules a low-credit push notification.
- **Costs:**

| Action | Cost |
|---|---|
| Onboarding 3 looks | 0 (first time) |
| "Generate more looks" (3 looks) | 3 |
| Ask Nima look creation (3 looks) | 3 |
| Create a look from selected items | 1 |
| Single item try-on | 1 (retry after failure: 1; cached: 0) |
| Quick Try-On | 1 |
| Connect try-on by a linked Nima user | 1 |
| Chat messages, wardrobe processing, visual search, recreate look, retry look generation, ghost mannequin | **0** (uncharged, and some are unauthenticated; see section 9) |

- **Purchases** (M-Pesa via Fingo, `credits/mutations.ts:initiatePurchase` → `credits/actions.ts:callFingoPaySTKPush` → `/webhooks/fingo` → `completePurchase`, which is idempotent). The phone number must match `^(?:\+254|254|0)(?:7|1)\d{8}$`.

| Package | Credits | Price (KES) |
|---|---|---|
| `pack_10` | 10 | 500 |
| `pack_20` (popular) | 20 | 1,000 |
| `pack_50` | 50 | 2,500 |
| `pack_100` | 100 | 5,000 |

  The price is a flat KES 50 per credit, with no volume discount.

- **iOS:** the purchase UI is hidden (`IS_IOS` in `apps/native/components/credits/CreditsModal.tsx`, `ProfileHeader.tsx`, `SettingsTab.tsx`) to satisfy Apple guideline 3.1.1. iOS users get free weekly credits only.
- **User subscription tiers** (`subscriptionTier: free | style_pass | vip`, `DAILY_TRYON_LIMITS` 20/100/unlimited) are **deprecated and unused**.
- **Seller-side credits and tiers:**
  - `sellers.tryOnCredits`: 100 granted at `createSeller`; `addSellerTryOnCredits` is admin-only (there is no purchase flow).
  - Seller subscription tiers are billed monthly via M-Pesa (`sellers/subscriptions.ts`, `tierConfig.ts`); a cron expires them daily at 01:00 UTC.

| Tier | Price (KES/month) | Max products | Revenue chart | Order history | Top products |
|---|---|---|---|---|---|
| basic | 0 | 20 | none | 30 days | none |
| starter | 5,000 | 50 | 30 days | 90 days | 5 |
| growth | 15,000 | 200 | 90 days | 180 days | 20 |
| premium | 30,000 | unlimited | 365 days | unlimited | unlimited (plus AI insights chat) |

- **Nima Connect partner plans:** free / starter / growth / enterprise = 50 / 500 / 5,000 / 999,999 try-ons per month.
- **Referral reward:** KES 500 checkout credit to the referrer when the referee completes their first try-on; it expires after 14 days. It is **not wired into checkout**.

---

## 6. AI prompts (reuse candidates)

| Prompt | Model | File : location | Summary |
|---|---|---|---|
| **Ask Nima stylist system prompt** (`NIMA_SYSTEM_PROMPT`) | gpt-4.1 (web) / gpt-4o-mini (native) | `apps/web/app/api/chat/route.ts` (canonical, with `buildUserContext` and `buildWardrobeContext`); a copy lives in `packages/backend/convex/chat/actions.ts` | Warm, confident stylist in 1–3 sentences. "Don't over-question" (the profile is already known). Asks new vs wardrobe vs both **once per session**, using varied phrasings. Emits `[MATCH_ITEMS:occasion\|source]` with **mandatory formality keywords** (interview/formal..., work/date..., casual/concert..., wedding/gala...), plus `[REMIX_LOOK]` and `[MIX_LOOKS]`. Strict gender rules. User context is injected as a structured block. **Replace the tag protocol with real tool calls in the rebuild.** |
| **Style profile generator** | o3-mini | `packages/backend/convex/workflows/actions.ts` `generateStyleProfile` (about line 178) | Turns onboarding answers (with KES budget labels) into a 2–3 paragraph actionable profile: aesthetic, outfit formula, colours and fabrics, occasion mix, budget tips |
| **Look curation (3 outfits)** | gpt-4o | same file, `selectItemsForLooks` (about lines 343–432) | "You are Nima..." with the catalog listed inline. Complete-outfit rules (dress/outfit/jumpsuit means no top or bottom), vary sizes 2/3/4, one item per category, one pair of shoes, gender rules; JSON array output. Paired with the code-side `validateNoDuplicateCategories` and `createFallbackLooks`. |
| **"Nima Says" look caption** | gpt-4o-mini, temp 0.9 | same file, `generateNimaComment` (about line 539) | 1–2 energetic sentences, 100 characters or fewer, addressed by name, **no emojis**, tone like "This is giving main character energy!" Output is clipped to 150 characters. |
| **Weekly rec comment** ("warm, witty Kenyan fashion stylist") | gpt-4o-mini, temp 0.75 | `packages/backend/convex/recommendations/actions.ts` (about line 64) | Occasion-referencing one-liner for the feed |
| **Try-on prompt writer** | gpt-4o, temp 0.7 | `workflows/actions.ts` `generateLookImage` (about line 829) and `generateItemTryOnImage` (about line 1096) | "Fashion photography director" writes a prompt of 400–500 characters or fewer that preserves identity. The single-item version includes crop guidance by category. |
| **Try-on Gemini wrapper prompt** | gemini-3-pro-image-preview | `workflows/actions.ts` (about lines 854 and 1122) plus the simple one-liners for quick and seller try-on (about lines 1316 and 1430) | "Reference Image 1 = person, Reference Image N = item ... keep face, body type & size, identity exactly ... ALL items ... professional fashion photograph" |
| **Ghost mannequin** | gemini-3-pro-image-preview | `packages/backend/convex/sellers/actions.ts` `generateGhostMannequin` (about line 377); duplicate in `admin/aiActions.ts` | Invisible-mannequin 3D fill, remove the person or mannequin, preserve details, white background, e-commerce style |
| **Product details from image** | gpt-4o `generateObject` (zod `productDetailsSchema`) | `sellers/actions.ts` `generateProductDetails` (about line 127); `admin/aiActions.ts` | Cataloguing specialist: name, brand, description, category, colors, tags, material, occasion, season, price range |
| **Photo validator** | gpt-4o `generateObject`, temp 0.1 | `packages/backend/convex/userImages/actions.ts` (about line 68) | Checks face visible and clear, portrait, quality; friendly 15-word issue message; deliberately lenient |
| **Wardrobe item identification** | gpt-4o | `packages/backend/convex/wardrobe/actions.ts` (about lines 95 and 203) | JSON of up to 12 items (description, category, subcategory, tags, color, season, formality, position) |
| **Wardrobe isolation** | Gemini image | `wardrobe/actions.ts` (about line 231) | "Generate a clean product photo of ONLY the {description} (located {position}) on a pure white background" |
| **Outfit composition fallback** | gpt-4o-mini | `packages/backend/convex/chat/actions.ts` `composeOutfitWithAI` (about line 417) | Used when rule-based matching fails |
| **Visual search attribute extraction** | gpt-4o | `packages/backend/convex/search/visualSearch.ts` (about line 118) | n/a |
| **Seller AI business analyst** | gpt-4o-mini | `packages/backend/convex/sellers/aiChatActions.ts` (about line 133); `apps/web/app/api/seller-chat/route.ts` | "AI business analyst for {shop}, a seller on Nima (Kenya)" with shop metrics injected |
| **Wrapped copy** (style era, personality, mood swings) | constants plus an AI action | `packages/backend/convex/wrapped/constants.ts`, `wrapped/actions.ts` | n/a |
| Admin inspiration / fabric analysis | gpt-4o | `packages/backend/convex/admin/aiActions.ts` (`generateInspirationDetails`, `analyzeFabricImage`) | Tailor feature |

---

## 7. UI and design

### 7.1 Design tokens ("Loro Piana inspired": warm, quiet luxury)

Sources: `apps/native/tailwind.config.js`, `apps/native/lib/constants/Colors.ts`, `apps/web/app/globals.css`, `apps/rules/ui-colors.mdc`.

| Token | Light | Dark |
|---|---|---|
| background | `#FAF8F5` Ivory Cream | `#1A1614` Deep Espresso |
| surface / card | `#F5F0E8` Soft Champagne | `#252220` Dark Cocoa |
| surface-alt | `#EDE6DC` Warm Linen | `#302B28` Coffee |
| **primary** | `#5C2A33` **Burgundy** (hover `#44242D`) | `#C9A07A` **Rose Gold** (hover `#D4B896`) |
| secondary | `#A67C52` Camel (hover `#8C6A50`) | `#A66B73` Soft Burgundy |
| foreground | `#2D2926` Charcoal | `#F5F0E8` Warm White |
| muted-foreground | `#6B635B` Warm Gray | `#C4B8A8` Sand |
| text-muted | `#9C948A` Stone | `#8C8078` |
| border / input | `#E0D8CC` Sand | `#3D3835` |
| success / destructive / warning | `#6B7F5E` / `#B85C5C` / `#C4A35A` | `#8FA881` / `#D4807A` / `#D4C078` |
| charts 1–5 | burgundy, camel, sage, gold, brown | n/a |

- **Fonts:** **DM Sans** (sans: body and UI) and **Cormorant Garamond** (serif: headlines and brand). Web adds JetBrains Mono.
- **Radius:** base 8px (sm 4, md 6, lg 8, xl 12).
- **Brand assets:** `apps/native/assets/nima-logo.png`, `nima-mascott.png` (mascot, also used for the splash and push icon), 8 style-vibe images (`assets/style/*.png`, `*.jpeg`), seller hero photos, sounds `confident_543.mp3` (push) and `wrapped.mp3`.

### 7.2 Screens and routes

**Native (`apps/native/app`, Expo Router):**
- Tabs:
  - `(tabs)/discover` (Discover)
  - `(tabs)/engine` (For You)
  - `(tabs)/quick-try-on` (centre button → `QuickTryOnModal`)
  - `(tabs)/lookbooks`
  - `(tabs)/profile` (Photos / Style & Fit / Account / Settings tabs)
  - `(tabs)/ask` (hidden tab; Ask Nima)
- Stack:
  - `index` (GateSplash landing), `onboarding`, `callback` (auth)
  - `ask/[chatId]`, `look/[id]`, `product/[id]`, `fitting/[sessionId]`, `lookbook/[id]`
  - `discover/category/[category]`, `discover/gender/[gender]`
  - `cart`, `checkout`, `orders/index`, `orders/[id]`
  - `messages/index`, `messages/[userId]`
  - `activity`, `discarded-looks`, `explore` (placeholder)

**Web (`apps/web/app`, Next App Router):**
- `/` (gate), `/onboarding`
- `(main)`: `/discover` (plus category and gender), `/engine`, `/explore`, `/ask`, `/ask/[chatId]`, `/look/[id]`, `/product/[id]`, `/fitting/[sessionId]`, `/lookbooks`, `/lookbooks/[id]`, `/profile`, `/profile/discarded-looks`, `/cart`, `/orders`, `/orders/[id]`, `/messages`, `/messages/[userId]`, `/activity`, `/credits`
- `/tailor/*` (feed, design, inspiration/book, measurements, checkout, orders)
- `/checkout`, `(bare)/quickTry`, `/shop/[slug]`, `/[storeName]/try-on[/productId]`, `/connect` (widget), `/wrapped/[year]`
- `/seller` (landing), `/seller/onboarding`, `/seller/(dashboard)/*` (12 pages), `/seller/tailor/*`
- `/admin/*` (21 pages)
- `/support`, `/privacyPolicy`, `/termsAndConditions`
- API: `/api/chat`, `/api/seller-chat`, `/api/scrape-store`, `/api/fingo/webhook`; `sign-in`, `sign-up`, `sign-out`, `callback`

### 7.3 Components worth porting (as design/UX reference, then rewrite)
- **Onboarding chat UX:** `apps/native/components/onboarding/steps/StyleChatStep.tsx` (Nima bubble plus tap-to-answer chips and vibe cards), `PhotoUploadStep.tsx` (per-photo validation states), `LoadingStep.tsx`, `SuccessStep.tsx`, and the option constants in `components/onboarding/types.ts`.
- **Ask Nima UI:** `apps/native/components/ask/*` (`MessageBubble`, `ChatInput`, `PromptSuggestions`, `WelcomeHero`, `FittingRoomCard`, `SearchingCard`, `ExploreCard`, `ChatHistoryDrawer`); web `components/ask/ProductSwapperModal.tsx`, `BuyWithNimaSheet.tsx`.
- **Feed cards:** `components/discover/LookCard.tsx`, `LookCardWithCreator.tsx`, `NimaChatBubble.tsx` (the "Nima says" caption), `FloatingLookLoader.tsx`, `CreateLookSheet.tsx` (multi-select to create a look, max 6), `CategoryCarousel.tsx`; engine `RecommendationCard.tsx`.
- **Try-on:** `components/quick-try-on/QuickTryOnModal.tsx` (camera flow), `components/fitting/LookCarousel.tsx`.
- **Credits:** `components/credits/CreditsModal.tsx` (package → phone → processing → success/failed state machine with an iOS gate).
- **UI kit and hooks:** `components/ui/*` (Button, Card, Sheet, Skeleton, Badge; some have tests), `lib/hooks/useResponsiveLayout.ts` (iPad columns), `lib/contexts/NetworkContext.tsx` plus `NoInternetBanner`, `ErrorBoundary.tsx`, `SwipeTutorial.tsx`, `ModerationMenu.tsx`.
- **Web:** `components/wrapped/*` (slide deck plus themes), `components/shared/BulkUploadModal.tsx`, `lib/utils/watermark.ts`, the admin `AnalyticsChart` and `MetricCard`.

---

## 8. App Store review issues (`APP_STORE_REVIEW_REPLIES.md`)

Submission `fb9bda42-...` was flagged on four guidelines:

1. **2.1(b), business model / paid digital content.** Apple asked five questions about paid content. The team's answer: on iOS nothing digital is sold; AI features run on free weekly credits; the only purchases are **physical clothing** paid with M-Pesa (Fingo), which 3.1.3(e) and 3.1.5(a) exempt from IAP. To make that true, the purchase UI was removed on iOS (commit `3ae1459` "removed credits badge for ios").
   - **Implication for the rebuild:** buying credits on iOS needs StoreKit IAP, or credits must stay free on iOS, or purchases must go through the web only (subject to the rules on reader apps and external purchase links).
2. **4.8, Login Services.** WorkOS offered third-party login without an equivalent privacy-focused option. The fix was native **Sign in with Apple** (`expo-apple-authentication`) on the first screen.
3. **4, iPad layout.** The post-login UI was a narrow phone layout on iPad. The fix was more grid columns on tablet (`useResponsiveLayout`; `supportsTablet: true`).
4. **1.5, Support URL.** There was no working support page. The fix was `https://www.shopnima.ai/support` (support@shopnima.ai), made reachable without auth (commit `8c1ca86`).

The schema also shows earlier **1.2 (UGC)** work: `user_blocks`, `reports` and `ModerationMenu`. Block and report are required for social features, and blocks must actually be **enforced** (they aren't today).

---

## 9. Code quality, bugs and tech debt

### Security and cost (critical)
- **Unauthenticated public actions that call paid AI:** `admin/aiActions.ts` (`generateProductDetails`, `bulkEnrichItem`, `generateGhostMannequin`, `generateInspirationDetails`, `analyzeFabricImage`) are public `action`s with **no auth or role check**. Anyone with the Convex URL can run Gemini and GPT-4o on the team's bill.
- **SSRF / open fetch:** the ghost mannequin, product-details and visual-search actions `fetch(args.imageUrl)` on any URL.
- **Free unlimited image generation:**
  - `chat/mutations.ts:scheduleChatLookImageGeneration` and `chat/actions.ts:generateChatLookImages` accept arbitrary `lookIds`, with **no ownership check and no credit charge**.
  - `recreateLook` and `retryLookGeneration` are also uncharged.
  - `wardrobe/actions.ts:processWardrobeUpload` runs up to 12 Gemini generations before the auth check (auth only happens in the downstream mutation), with no credits.
  - **Lesson for the rebuild:** charge credits in the *same* transaction that enqueues the GPU/API job, and refund on failure.
- **Broken identity lookups after the auth refactor:** 32 usages of `getUserByWorkosId` / `by_workos_user_id` remain (in `chat/actions.ts`, `connect/actions.ts`, `recommendations/queries.ts`, `users/queries.ts`, `wardrobe/*`). These fail for Apple and Google users.
- **Blocks not enforced** (the `user_blocks` table is read only in `moderation/*`). DMs can share **any** look: the ownership check is commented out at `directMessages/mutations.ts:73`.
- **Fingo webhook** doesn't verify that the paid **amount** matches the expected amount; status detection uses fuzzy string matching.
- **Debug beacons** posting to `http://127.0.0.1:7242/ingest/...` were left in production code (6 instances in `chat/mutations.ts`).
- Sentry runs with `sendDefaultPii: true` plus session replay in an app full of body photos.
- Account deletion leaves photos and generated images in storage (see section 4, Privacy).

### Correctness
- **Money units are inconsistent.** Comments say cents, but values are whole KES. `shippingCost = 500 // KES 1500 flat rate`. The seller email divides by 100. Checkout multiplies by 100 for Fingo.
- **Stock and `purchaseCount` change at order creation, before payment.** The cart is cleared before payment too, so a failed STK push loses the cart.
- In `workflows/actions.ts:generateItemTryOnImage`, the fallback "simpler approach" **drops the user photo**. It generates a random person, which silently breaks the core promise. (The dead `workflows/itemTryOn.ts` version got this right.)
- The look-curation prompt lists up to 500 catalog items inline. That costs a lot of tokens and doesn't scale; use retrieval (pgvector / filters) instead.
- Photo validation fails open. A stale duplicate primary image needed `fixDuplicatePrimaryImages`.
- `lib/rateLimiter.ts` is unused; rate limits are ad hoc.

### Structure and tech debt
- Two full clients (Next and Expo) implement the same consumer features twice, with a lot of copy-paste (`components/ask`, `discover`, `onboarding` in both). The seller, admin and tailor portals are web-only.
- There are three copies of Convex `_generated`, committed.
- Large files: `admin/analytics.ts` 2,467 lines, `sellers/queries.ts` 2,253, `looks/queries.ts` 2,231, `chat/mutations.ts` 1,826, `schema.ts` 1,554.
- Duplicated AI code: the try-on action exists 2–3 times; ghost mannequin and product details exist twice; the Nima system prompt exists twice.
- Other debt:
  - 203 `console.log` calls in the backend
  - 13 `v.any()` validators
  - dead onboarding steps and a dead `itemTryOn.ts`
  - deprecated `subscriptionTier` and daily-try-on fields
  - a mock data file (`lib/mock-chat-data.ts`, `mock-data.ts`)
  - native analytics that is a no-op
- **Tests:** only the native unit tests (UI atoms, auth storage, hooks, contexts), about 12 test files. No backend tests.
- **Positives:** consistent Convex validators and explicit return types, a friendly error mapping, a durable workflow for onboarding, a signed and replay-protected webhook, idempotent credit completion, a thoughtful multi-provider identity linking design, and good product breadth.

---

## 10. Reuse vs discard for the rebuild (Fastify + Prisma + Postgres + WS + Better Auth + Expo universal)

### Reuse (port the idea or content, rewrite the code)
| What | From |
|---|---|
| **Data model** (as a Prisma blueprint with the fixes in section 3.2) | `packages/backend/convex/schema.ts` |
| Item taxonomy enums (category, gender, imageType, formality), look `creationSource`, order and fulfillment state machines, tailored-order states | `schema.ts`, `convex/types.ts` |
| **Prompts** (stylist, style profile, look curation rules, Nima Says, rec comments, try-on wrapper, ghost mannequin, photo validator, wardrobe tagging, product details) | See section 6. Main files: `apps/web/app/api/chat/route.ts`, `packages/backend/convex/workflows/actions.ts`, `sellers/actions.ts`, `userImages/actions.ts`, `wardrobe/actions.ts`, `recommendations/actions.ts` |
| **Try-on pipeline design:** GPT prompt writer → Gemini multi-reference → 503 fallback model → retry keeping the user image → friendly errors → job status in DB. Run it as a BullMQ / pg-boss worker and push status over WebSocket. | `workflows/actions.ts`, `workflows/onboarding.ts` |
| Outfit validation rules (one per category, complete-outfit logic, male category hard filter, fallback looks) and formality matching tables | `workflows/actions.ts` (`validateNoDuplicateCategories`, `createFallbackLooks`), `chat/mutations.ts` / `recommendations/mutations.ts` (`OCCASION_FORMALITY`, `FORMALITY_ORDER`) |
| Credits constants (5 free per week, 1 per try-on, 3 per batch of 3 looks, KES 50 per credit packs) as a starting point, re-implemented as a ledger | `convex/types.ts`, `credits/mutations.ts` |
| **Fingo Pay integration** (endpoint, headers, idempotency key, HMAC `t=,v1=` verification, Kenyan phone regex) | `credits/actions.ts`, `http.ts` (lines about 290–505) |
| Onboarding content: budget tiers in KES, occasions, 8 style-vibe cards plus images, chat-style flow | `apps/native/components/onboarding/types.ts`, `steps/StyleChatStep.tsx`, `apps/native/assets/style/*` |
| **Design tokens and fonts**, mascot and logo assets, push sound | `apps/native/tailwind.config.js`, `lib/constants/Colors.ts`, `apps/rules/ui-colors.mdc`, `apps/native/assets/*` |
| Screen inventory and UX flows (tabs: Discover / For You / Try-On / Lookbooks / Profile; hidden Ask; fitting room; Quick Try-On camera) | Section 7.2 |
| Seller tier matrix and seller features list (ghost mannequin, AI product fill, bulk upload, watermark, Shopify import, try-on links with UTM attribution) | `convex/types.ts` `TIER_LIMITS`, `sellers/*`, `apps/web/app/seller/*` |
| App Store compliance learnings: Sign in with Apple, iPad columns, a public support URL, no digital sales on iOS without IAP, block/report | `APP_STORE_REVIEW_REPLIES.md` |
| Multi-provider identity linking by verified email (Better Auth account linking covers this natively) | `convex/lib/auth.ts` |
| Nima Connect partner API shape (sessions, usage logs, conversion tracking), if a B2B API is ever wanted | `http.ts /api/v1/*`, `connect/*` |
| The original PRD for product intent | `apps/rules/project-description.mdc` |

### Discard
- All Convex code (queries, mutations, actions, workflows, `_generated`, `convex.json`), which is tied to the Convex runtime and storage.
- **WorkOS** auth (replaced by Better Auth with Apple, Google and email). Discard `webhooks/workos.ts`, `auth.ts`, `callback` routes and the `INSTRUCTIONS.md` WorkOS notes.
- The separate Next.js consumer app: one Expo universal app replaces both clients. If the seller and admin portals stay web, rebuild them lean rather than porting about 50 shadcn files wholesale.
- Deprecated fields: `subscriptionTier`, `dailyTryOn*`, `payouts.stripeTransferId`, `generationProvider` comments about FASHN and Kolors.
- The `[MATCH_ITEMS]` text-tag protocol (use native tool calling), the inline 500-item catalog prompting (use retrieval), and the duplicate try-on implementations.
- Debug beacons, the unused `rateLimiter.ts`, the dead onboarding steps, mock data files and the stray root image.
- Probably defer or out-of-scope: the Tailor MVP, Wrapped, Nima Connect, the Premium seller AI analyst, and IG-store analytics (the reference remains available).

### Must add (gaps versus the brief)
- Native guest browsing
- A real Explore/social feed on mobile
- Text DMs over WebSockets
- **Pick Up Mtaani logistics**
- Server-enforced blocks
- Complete account and photo deletion
- A credit ledger with charge-at-enqueue and refund-on-failure
- Auth and role guards on every AI endpoint
- iOS monetization strategy (IAP or free-only)
- Unified money units (integer KES)
- Stock reservation only on payment
