# Legacy analysis: Nima-Native, nima-demo, docs

Analysed: 2026-09-21. Source: `reference/Nima-Native`, `reference/nima-demo`, `reference/docs`.
No secret values are reproduced here. Where credentials exist, only their presence is noted.

---

## TL;DR

- **Nima-Native** is a real, fairly complete Expo SDK 54 app (about 25k lines of app/components/lib code) on top of a **copy of the shared Convex backend** (about 41k lines in `convex/`). The Convex folder is a fork of `reference/Nima-Convex/convex`: `schema.ts` is byte-identical, and 14 function files have drifted. Native is a little ahead on the recommendation engine, wardrobe and the chat prompt.
- AI runs **entirely server-side in Convex actions**. OpenAI (gpt-4.1, gpt-4o, gpt-4o-mini, o3-mini) handles chat, prompt-writing, photo validation and item selection. Google **Gemini `gemini-3-pro-image-preview`**, falling back to `gemini-3.1-flash-image-preview`, handles all try-on and look images. Every AI provider is a paid API. Nothing is self-hosted.
- The credit system is already implemented: 5 free credits per week plus purchased packs (10/20/50/100 credits for KES 500/1000/2500/5000) via **Fingo Pay M-Pesa STK push**. The credit logic ports directly to Postgres.
- The app has **no guest browsing**. Every route except splash, onboarding and callback requires WorkOS login. Checkout is **stubbed** behind a "Coming Soon" modal, the seller side and Wrapped exist **only in the backend**, and web support is minimal.
- **nima-demo** is a small fake third-party store ("NOIR") that demonstrates the **Nima Connect B2B try-on widget API** (`/api/v1/sessions`, `/api/v1/track`). **docs** is an untouched **Mintlify starter template** with zero Nima content.

---

## 1. Nima-Native: structure, SDK, routing, data layer

### 1.1 Git evolution (31 commits, 2026-02-05 to 2026-04-22)

| Date | Author | Milestone |
|---|---|---|
| 02-05 | 4kClinton | Initial push (port from Next.js web app, as comments say "ported from Next.js") |
| 02-11 | Brian | Six "updates" commits (profile and UI) |
| 02-13 | 4kClinton | Category pages and styles. `.env` untracked. Commit message says "remove secrets from history" (see note below). Then payments, credits and cart, then activity, grid and chat history |
| 02-14 | 4kClinton | `npx expo-doctor` cleanup |
| 02-18/19 | 4kClinton | Haptics, lookbook fixes, image compression, "Create a look" styling, swipe feature, "Successful Build 1" (first EAS build), offline banner, orders and Fingo, universal links |
| 02-20 | 4kClinton | Share modal rework |
| 03-26 | 4kClinton | Profile swipe tutorial |
| 04-21 | 4kClinton | **Recommendation engine, Quick Try-On (camera), floating chat bubble.** This is the biggest late feature drop |
| 04-22 | 4kClinton | Nav fix on `/profile`, merged as PR #11 |

Contributors: 4kClinton (main dev), Brian, and zyraglobal7 (org account that merges PRs).
**History note:** the "removed" `.env` is still in git history (commits `ffff476`, `3c3d0c3`). It contains only *public* client values: the Convex URL, the WorkOS client ID and redirect URI, and a PostHog key and host. No server secrets were found in tracked files or history. `eas.json` and `INSTRUCTIONS.md` also embed public WorkOS client IDs and the Convex deployment URL. These are not secrets, but they identify the legacy deployment.

### 1.2 Stack and config

| Item | Value | File |
|---|---|---|
| Expo SDK | **~54.0.33**, RN 0.81.5, React 19.1, New Architecture on | `package.json`, `app.config.js` |
| Router | expo-router ~6.0.23, `typedRoutes: true` | `app.config.js` |
| Styling | NativeWind 4.2 + Tailwind 3.4, `darkMode: "class"` | `tailwind.config.js`, `babel.config.js`, `metro.config.js` |
| Backend | Convex ^1.31.7 + `@convex-dev/workflow` | `convex/convex.config.ts` |
| AI SDKs | `ai` ^6, `@ai-sdk/openai` ^3, `@google/genai` ^1.40 (**server-side only, used inside `convex/`**) | |
| UI libs | @gorhom/bottom-sheet 5, reanimated 4.1, gesture-handler, lucide-react-native, expo-image, expo-linear-gradient, react-native-toast-message | |
| Native modules | expo-camera, expo-image-picker, expo-notifications, expo-secure-store, expo-haptics, netinfo | |
| Identity | name "Nima", slug `nima-ai`, v1.1.0, scheme `shopnima://`, iOS bundle ID `ai.shopnima.app`, Android package `com.nima.app`, EAS owner `nima-ais-organization` | `app.config.js` |
| Deep links | Android intent filters for `shopnima.ai/{look,product,lookbook,callback}`. The iOS AASA in `public/.well-known/` uses `<TEAM_ID>.com.nima.app`, which **does not match** the iOS bundle ID and still has a placeholder team ID, so iOS universal links are broken | |
| Tooling | No tests, no lint and no CI. There are `.cursor/rules/*` (Convex rules, a PRD and a colour guide) and `.idea` files | |

### 1.3 Folder layout

```
app/            Expo Router screens (28 files)
components/     by feature: ask, credits, discover, engine, fitting, friends, landing,
                lookbooks, onboarding, orders, profile, quick-try-on, ui, wardrobe
convex/         full backend copy (schema + ~85 function files, 41k lines)
lib/            auth (WorkOS PKCE), auth-storage (chunked SecureStore), analytics (no-op PostHog stub),
                contexts (Theme, User, Selection, Network), hooks (credits, push, onboarding), Colors.ts
shims/          react-native-pager-view.web.js (web shim, now vestigial because PagerView is no longer imported)
public/.well-known/  AASA + assetlinks
```

### 1.4 Routes and screens

Root: `app/_layout.tsx` holds a `Stack` wrapped in GestureHandler, AppErrorBoundary, BottomSheetModalProvider, SafeArea, Theme, Network, ConvexProviderWithAuth(WorkOS), User and Selection providers. It also renders a global custom `Header`, a `NoInternetBanner` and push registration. It enforces auth: `PUBLIC_PATHS = ["/", "/onboarding", "/callback"]` and redirects everything else to `/`.

| Route | File | Status / purpose |
|---|---|---|
| `/` | `app/index.tsx` | Animated `GateSplash` for signed-out users, which launches WorkOS directly. Signed-in users go to onboarding or to discover |
| `/onboarding` | `app/onboarding.tsx` | `OnboardingWizard` (requires auth) |
| `/callback` | `app/callback.tsx` | WorkOS OAuth code exchange (web and deep link) |
| **Tabs** `(tabs)/_layout.tsx` | | Custom tab bar with a raised centre camera button |
| `/(tabs)/discover` | `discover.tsx` | Tab "Discover" with sub-tabs **My Look / Explore / Apparel** (`FilterTabs`). Also kicks off the onboarding look workflow |
| `/(tabs)/engine` | `engine.tsx` | Tab **"For You"**: weekly catalogue recommendations, wardrobe mixes, a **Wardrobe** sub-tab (upload / closet scan), and a floating "Ask Nima" button that opens `AskNimaSheet` |
| `/(tabs)/quick-try-on` | `quick-try-on.tsx` | Dummy route. The tab button opens `QuickTryOnModal` |
| `/(tabs)/ask` | `ask.tsx` | Hidden (`href:null`). This is a legacy full-screen chat that duplicates `AskNimaSheet` |
| `/(tabs)/lookbooks` | `lookbooks.tsx` | Lookbooks, saved looks and liked items |
| `/(tabs)/profile` | `profile/index.tsx` | Tabs: Settings / Photos / Style & Fit / Account |
| `/(tabs)/profile/discarded-looks` | | Restore discarded looks |
| `/look/[id]` | `look/[id].tsx` (873 lines) | Look detail: love/dislike/save, add to lookbook, add to cart, **recreate**, retry, delete, share |
| `/product/[id]` | `product/[id].tsx` (758 lines) | Item detail, image pager, **single-item try-on**, add to cart, save |
| `/fitting/[sessionId]` | `fitting/[sessionId].tsx` | "Fitting room" carousel of chat-generated looks |
| `/lookbook/[id]` | | Lookbook detail (edit, delete) |
| `/discover/category/[category]`, `/discover/gender/[gender]` | | Filtered apparel grids |
| `/cart` | `cart.tsx` | Real cart. "Proceed to Checkout" opens a **Coming Soon modal** |
| `/checkout` | `checkout.tsx` (795 lines) | Complete M-Pesa checkout UI plus `orders.createOrder`, but **unreachable** (the screen is commented out in the Stack and cart doesn't navigate to it) |
| `/orders`, `/orders/[id]` | | Order list and detail |
| `/messages`, `/messages/[userId]` | | DMs, meaning shared looks between friends |
| `/activity` | | Notifications feed (loves, saves and recreates on your looks) |
| `/explore` | `explore.tsx` | **Stub** (a "Explore" text placeholder). The real Explore is the Discover sub-tab |
| `/ask/[chatId]` | `ask/[chatId].tsx` | **Stub** (prints the chat ID) |

CLAUDE.md mentions an `(auth)/` group, but it **does not exist**. Auth is handled entirely by WorkOS hosted UI.

### 1.5 State and data layer

- There is no state library. **Convex reactive `useQuery`/`useMutation`/`useAction`** is the whole data layer and gives real-time updates for free.
- React Context: `ThemeContext` (light/dark/system, syncs NativeWind), `UserContext` (current user), `SelectionContext` (multi-select of up to 6 items for "Create a look"), and `NetworkContext` (NetInfo).
- AsyncStorage holds the onboarding token and draft. SecureStore holds tokens, chunked for large JWTs (`lib/auth-storage.ts`).
- Long AI jobs follow this pattern: a mutation inserts a row with `status: pending`, deducts credits and schedules an internal action (`ctx.scheduler.runAfter` or a durable `@convex-dev/workflow`). The action calls the AI, stores the image in Convex `_storage` and patches the row to `completed`. The client watches the row reactively. **In the rebuild this maps to a Postgres job table plus a worker queue plus a WebSocket push.**

---

## 2. Third-party services

| Concern | Service | Where | Paid? | Rebuild note |
|---|---|---|---|---|
| Auth | **WorkOS AuthKit**: hosted login, OAuth PKCE via expo-web-browser, code and refresh exchange proxied through Convex actions (`convex/auth.ts`) to avoid CORS, WorkOS webhook `/webhooks/workos` | `lib/auth.ts`, `app/callback.tsx`, `convex/auth.ts`, `convex/webhooks/workos.ts` | Free tier up to 1M MAU, but it is proprietary SaaS | Replace with Better Auth |
| Backend, DB, file storage | **Convex Cloud**. Images are stored in Convex `_storage` and served by signed URLs | everywhere | Paid beyond free tier | Replace with Fastify, Prisma, Postgres and S3-compatible storage (MinIO) |
| Chat LLM | OpenAI **gpt-4.1** via `@ai-sdk/openai`. Optional Vercel AI Gateway if `VERCEL_AI_GATEWAY_API_KEY` is set (the baseURL `api.vercel.ai/v1` looks wrong) | `convex/chat/actions.ts` | Paid | |
| Utility LLM | gpt-4o (photo validation with `generateObject`, item selection, try-on prompt-writing, wardrobe analysis, visual search, admin and seller AI), gpt-4o-mini (look comments, recommendation comments, chat titles), **o3-mini** (style profile) | `convex/workflows/actions.ts`, `userImages/actions.ts`, `wardrobe/actions.ts`, `recommendations/actions.ts`, `search/visualSearch.ts` | Paid | |
| Image generation / try-on | Google **Gemini `gemini-3-pro-image-preview`**, with fallback **`gemini-3.1-flash-image-preview`** on 503 (`generateContentWithFallback`) | `convex/workflows/actions.ts`, `workflows/itemTryOn.ts` (duplicate), `wardrobe/actions.ts`, `connect/actions.ts` | Paid, per image | |
| Payments | **Fingo Pay** M-Pesa STK push (`api.fingopay.io/v1/mpesa/charge`). Webhook `/webhooks/fingo` with HMAC `X-Fingo-Signature` and 5-minute replay window (well done) | `convex/credits/actions.ts`, `orders/actions.ts`, `sellers/subscriptionActions.ts`, `convex/http.ts` | Transaction fees | Keep Fingo, or use Daraja directly |
| Push | **Expo Push API** (`exp.host/--/api/v2/push/send`). Tokens are kept in the `push_tokens` table. There are 10 notification types: low credit, purchase, DM, look ready, try-on ready, onboarding looks ready, order confirmed, look interaction, daily matches and recreate | `convex/notifications/actions.ts`, `lib/hooks/usePushNotifications.ts` | Free | Keep (Expo push works with a self-hosted backend) |
| Email | **Resend** (seller dashboard emails) | `convex/emails/*` | Free tier / paid | Swap for Nodemailer + SMTP if needed |
| Analytics | PostHog, which is **only stubbed** (`lib/analytics.ts` logs in `__DEV__`, no-op in prod) | | | Could self-host PostHog |
| Crashes | None. There is a custom `ErrorBoundary` only | | | |

Server env vars referenced by name only: `OPENAI_API_KEY`, `GOOGLE_AI_STUDIO_KEY`, `VERCEL_AI_GATEWAY_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `FINGO_LIVE_KEY`, `FINGO_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`. Client env vars: `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_WORKOS_CLIENT_ID`, `EXPO_PUBLIC_WORKOS_REDIRECT_URI` (plus `EXPO_PUBLIC_POSTHOG_*` in history). Android also needs `google-services.json` (gitignored) for FCM.

### 2.1 Try-on implementation in detail

All variants follow the same recipe. First, **download images to base64**. Second, optionally have **GPT-4o write a prompt**. Third, send the text plus inline JPEG parts to Gemini with `responseModalities: ['TEXT','IMAGE']`. Fourth, take the first `inlineData` part, store it as PNG in `_storage` and patch the status. There is no dedicated VTON model (no FASHN, IDM-VTON or Kolors). This is pure "nano-banana-pro" style multimodal editing. The schema still has a `generationProvider` field that mentions "fashn_ai" and "kolors", which was the original plan.

| Flow | Entry mutation | Action | Images sent | Credits |
|---|---|---|---|---|
| **Onboarding looks** (3 looks) | `workflows.index.startOnboardingWorkflow`, called from `LoadingStep` | durable workflow `workflows/onboarding.ts` runs step 0 `generateStyleProfile` (o3-mini), then step 1 `selectItemsForLooks` (gpt-4o, catalogue filtered by gender/budget, no duplicate categories, fallback compositions), then `generateLookImage` for each look | user primary photo plus up to 5 item images | Free |
| **Generate more looks** | `startGenerateMoreLooks` | same workflow, excluding previous item IDs | same | **3** |
| **Look image** (chat / create-a-look / recreate / wardrobe) | `chat.createLooksFromChat`, `looks.createLookFromSelectedItems`, `createLookFromWardrobeItems`, `recreateLook`, `retryLookGeneration` | `workflows.actions.generateLookImage` | user photo plus catalogue item images plus wardrobe item images | chat 3, create 1, wardrobe 1, **recreate 0 and retry 0 (leak)** |
| **Single item try-on** | `workflows.index.startItemTryOn` from `product/[id]` | `workflows.actions.generateItemTryOnImage` | user photo plus item primary image | 1 (retry 1) |
| **Quick try-on (camera)** | `quickTryOns.createQuickTryOn` from `QuickTryOnModal` (expo-camera or gallery, then upload to storage) | `generateQuickTryOnImage`. No GPT step, fixed prompt | user photo plus captured garment photo | 1 |
| **Seller try-on link** | `sellerTryOns` | `generateSellerTryOnImage` | customer photo plus seller item | seller `tryOnCredits` |
| **Nima Connect (B2B widget)** | HTTP `/api/v1/sessions` | `connect/actions.generateConnectTryOn` | guest or user photo plus partner product URL | partner monthly quota |

**GPT-4o prompt-writer** (look / item). It uses a "fashion photography director" meta-prompt: maintain identity, show all items (or only the single item, cropping per category), natural lighting, clean background, under 400 to 500 characters.
**Gemini final prompt template:**
> "Virtual try-on fashion photo: Create an image of this person (shown in Reference Image 1) wearing the clothing items shown in the other reference images. Reference Image 1: Photo of the person… Reference Image N: <item description> … <GPT prompt> … Important: Keep the person's face, body type & size, and identity exactly as shown in Reference Image 1; Dress them in ALL the clothing items…; professional fashion photograph."

On an empty result it **retries once** with a short, simplified prompt that keeps the reference images.
**Quick try-on prompt:** "Virtual try-on: Show the person from Reference Image 1 wearing the clothing item captured in Reference Image 2. Keep the person's face, body, and identity exactly as shown. Professional fashion photo, clean background."

**Photo validation** at onboarding: `userImages/actions.validateOnboardingImage` calls gpt-4o `generateObject` with the schema `{valid, face_visible, face_clear, is_portrait, quality, issue}` under a lenient rubric. This is worth reusing.
**Wardrobe ingestion:** `wardrobe/actions.processWardrobeUpload` has two modes. In `single_upload`, gpt-4o analyses the item as JSON and then Gemini produces a clean white-background product shot. In `closet_scan`, gpt-4o lists every item with its position and Gemini generates an isolated image for each item.

Images are fetched fully into memory as base64 with no resizing server-side. The client compresses via ImagePicker `quality: 0.8`.

### 2.2 Ask Nima (chat)

`convex/chat/actions.sendChatMessage` runs gpt-4.1, non-streaming "for RN compatibility", with `maxOutputTokens` 500 and temperature 0.7. The system prompt is a persona ("warm, confident AI personal stylist… 1-3 sentences") plus the user profile plus the wardrobe list. The model emits a **control tag `[MATCH_ITEMS:<occasion keywords>|new|wardrobe|both]`**. The client (`components/ask/AskNimaSheet.tsx`) parses it and shows a `SearchingCard`. It then calls `chat.createLooksFromChat`, a rule-based item matcher (formality and occasion scoring in `chat/mutations.ts`, 1.9k lines), which saves a `fitting-ready` message and schedules image generation. The user then opens `/fitting/[sessionId]`. The `no-matches` message type renders an `ExploreCard`. Threads and history live in the `threads` and `messages` tables (`ChatHistoryDrawer`).

### 2.3 "For You" recommendation engine (added 2026-04-21)

This is rule-based and runs inside Convex mutations (`convex/recommendations/mutations.ts`):
- Items get a formality level (casual, smart_casual, formal or evening) from keyword lists. Outfits are scored for coherence: formality distance, shared occasions ×15, shared tags ×5. Occasion strings map to a formality level.
- A weekly cron (Monday 03:00 UTC, 06:00 EAT) creates one recommendation per user occasion (up to 5, each 2 to 4 items). A daily cron (03:00 UTC) creates wardrobe-mix recommendations and sends a push. A daily cleanup expires old ones.
- gpt-4o-mini writes a one-sentence "warm, witty **Kenyan** stylist" comment per recommendation (`recommendations/actions.ts`).
- The client shows `RecommendationCard`. Tapping "try on" converts the recommendation into a look via `createLookFromSelectedItems` or `createLookFromWardrobeItems` (1 credit).

---

## 3. Convex schema

**Verdict: this is the shared backend, not its own schema.** `Nima-Native/convex/schema.ts` is **identical** to `Nima-Convex/convex/schema.ts` (1,321 lines, 34 tables). `eas.json` points the app at one Convex cloud deployment, which is almost certainly the same one the Nima-Convex web app and seller dashboard use. 14 function files differ: `chat/actions`, `chat/mutations`, `crons`, `looks/mutations`, `notifications/actions`, `quickTryOns/mutations`, `recommendations/*`, `users/mutations`, `wardrobe/*`, `workflows/actions` and `workflows/onboarding`. **Native is newer** on these (wardrobe-aware recommendations, reworked chat prompt, daily wardrobe cron). Whoever deployed last "won", which is a classic two-repos-one-backend hazard. `Nima-Universe` (the later monorepo) has no `convex/schema.ts` at its root; it keeps its backend in `packages/backend`.

| Table | Key fields (abridged) |
|---|---|
| `users` | workosUserId, email, username, names, profileImage, gender, age, stylePreferences[], sizes (shirt, waist, height+unit, shoe+unit), country, currency, budgetRange(low/mid/premium), occasions[], phone, subscriptionTier(free/style_pass/vip), **credits, freeCreditsUsedThisWeek, weeklyCreditsResetAt**, onboardingCompleted, styleProfile(any), role(user/admin/seller), savedShippingAddress |
| `user_images` | userId?, storageId, **onboardingToken** (pre-auth uploads), imageType(full_body/upper_body/face/other), isPrimary, status |
| `items` | sellerId?, publicId, sku, name, brand, category(enum), subcategory, gender, price, currency, originalPrice, colors[], sizes[], material, tags[], occasion[], season[], source/affiliate URLs, inStock, stock, isActive, isFeatured, counters (view, save, purchase, tryOn, lookbookSave, cartAdd, lookInclusion) |
| `item_images` | itemId, storageId or externalUrl, sortOrder, isPrimary, imageType(front/back/side/detail/model/flat_lay) |
| `looks` | publicId, itemIds[], wardrobeItemIds[], totalPrice, name, styleTags, occasion, nimaComment, targetGender, targetBudget, isPublic, sharedWithFriends, generationStatus, status(saved/discarded…), createdBy(system/user), creatorUserId, **creationSource(chat/apparel/recreated/shared/system)**, originalLookId, selectedSize/Color |
| `look_images` | lookId, userId, storageId, userImageId, status, generationProvider, jobId, error |
| `lookbooks` / `lookbook_items` | name, cover, isPublic, shareToken, collaborative + collaboratorIds, itemCount / itemType(look/item), lookId or itemId, note, sortOrder |
| `threads` / `messages` | chat threads with context look/item / role, content, messageType(text/fitting-ready/no-matches), lookIds[], attachments, model, tokens, status |
| `friendships` | requester, addressee, status (pending/accepted/…) |
| `direct_messages` | sender, recipient, **lookId** (DMs are look shares only, no free text), isRead |
| `look_interactions` | lookId, userId, type(love/dislike/save/recreate), seenByOwner |
| `item_likes` | userId, itemId |
| `item_try_ons` / `quick_try_ons` / `seller_try_ons` | try-on job rows (source images, result storageId, status, error) |
| `cart_items` | userId, itemId, qty, size, colour |
| `orders` / `order_items` | orderNumber, shippingAddress, subtotal, serviceFee, shipping, total, paymentStatus, M-Pesa phone, merchantTransactionId, status / per-seller line items with fulfilment and tracking |
| `payouts` | seller payouts (still has a `stripeTransferId` leftover) |
| `credit_purchases` | creditAmount, priceKes, phone, merchantTransactionId, fingoTransactionId, status |
| `push_tokens` | userId, Expo token, platform |
| `sellers`, `tier_config`, `seller_subscriptions`, `seller_chat_messages` | shop profile, verification, tier(basic/starter/growth/premium), tryOnCredits, KES monthly subs via Fingo, seller AI assistant chat |
| `api_partners`, `api_sessions`, `api_usage_logs` | **Nima Connect** B2B: hashed API keys `nima_pk_…`, allowed domains, webhook, plan quotas, guest sessions, event tracking (tryon, added_to_cart, purchased, with value) |
| `wrapped_settings`, `user_wrapped` | "Nima Wrapped" yearly recap (style era, palette, top items and brands, share token) |
| `wardrobeItems` | userId, image + original, description, category, tags, colour, season, formality, source(single_upload/closet_scan) |
| `recommendations` | userId, itemIds, wardrobeItemIds, isWardrobeMix, occasion, nimaComment, status, weekOf, expiresAt |

---

## 4. Features: implemented vs stubbed

| Feature | Status | Notes / files |
|---|---|---|
| Guest browsing | **Not implemented** | Root layout redirects all non-public paths to `/`. Splash immediately launches WorkOS |
| Onboarding questionnaire | **Implemented (v2)** | Auth first. Step 0 is photo upload with AI validation. Step 1 is `StyleChatStep`, a chat-style questionnaire: gender, then 8 style-vibe image cards (pick at least 2), then occasions, then budget (KES tiers). Step 2 claims images and starts the workflow. Step 3 shows a preview of 3 generated looks. `completeOnboardingV2`. Old v1 steps (`AccountStep`, `GenderAgeStep`, `SizeFitStep`, `LocationBudgetStep`, `StyleVibeStep`, `WelcomeStep`) are **dead code** |
| User photos | Implemented | Onboarding (up to 4) plus Profile > Photos (up to 10, set primary, delete) |
| For You | Implemented (Apr 2026) | `engine.tsx` weekly and wardrobe recommendations |
| Explore | Implemented as Discover sub-tab | Public looks with creator, love, add friend (`LookCardWithCreator`). `/explore` route is a stub |
| Discover "My Look" | Implemented | User's generated looks plus `FloatingLookLoader` progress |
| Apparel browse | Implemented | Category carousel, gender/category pages, search bar, likes |
| Ask Nima | Implemented | Bottom sheet chat plus history drawer. Uses `lib/mock-chat-data.ts` only for greetings, prompt chips and loader copy (the file is misnamed) |
| Try-on | Implemented | Product single-item, camera Quick Try-On, look images |
| Create a look | Implemented | Multi-select up to 6 items, then `CreateLookSheet`, generate, then save/discard/visibility |
| Recreate | Implemented | `look/[id]` calls `recreateLook` with the user's photo. **No credit charged** |
| Wardrobe | Implemented | Upload single item or scan whole closet (AI extraction), viewer, remove, used in chat and recommendations |
| Lookbooks | Implemented | Create, list with covers, detail, edit/delete, save looks/items/try-ons. Collaborative fields exist in the schema only |
| DMs / sharing | Implemented (look-only DMs) | `ShareOptionsModal`: send to friends or searched users, share publicly, WhatsApp deep link. Friends list and requests. Activity feed |
| Cart | Implemented | |
| Checkout | **Stubbed** | Full screen exists (`checkout.tsx`, M-Pesa + address) but is hidden behind a "Coming Soon" modal. Backend `orders` + Fingo is implemented |
| Orders | Implemented (read-only) | |
| Seller side | **Backend only** | `convex/sellers/*`, tiers and subscriptions, seller AI chat, seller try-on links. No seller UI in Native (lives in the Nima-Convex Next.js web app) |
| Credits | **Implemented** | `CreditsModal` (buy packs via M-Pesa STK, poll status), `useCredits`, gates in try-on, chat and create. 5 free per week plus purchases. Low-credit push at 2 or fewer remaining |
| Wrapped | Backend only | cron plus tables, no screen |
| Visual search | Backend only | `search/visualSearch.findSimilarItems` (gpt-4o) not called from the app |
| Push notifications | Implemented | |
| Offline banner, error boundaries, haptics | Implemented | |
| Analytics | Stub | |
| Dark mode | Implemented | |

---

## 5. Design system

**Palette.** Named "Loro Piana inspired" in `tailwind.config.js`. Mirrored as hex constants in `lib/constants/Colors.ts` and in `.cursor/rules/ui-colors.mdc`.

| Token | Light | Dark |
|---|---|---|
| background | `#FAF8F5` Ivory Cream | `#1A1614` Deep Espresso |
| surface / card / popover / muted | `#F5F0E8` Soft Champagne | `#252220` Dark Cocoa |
| surface-alt | `#EDE6DC` Warm Linen | `#302B28` Coffee |
| primary | `#5C2A33` Burgundy (hover `#44242D`) | `#C9A07A` Rose Gold (hover `#D4B896`) |
| secondary | `#A67C52` Camel (hover `#8C6A50`) | `#A66B73` Soft Burgundy |
| foreground | `#2D2926` Charcoal | `#F5F0E8` Warm White |
| muted-foreground | `#6B635B` Warm Gray | `#C4B8A8` Sand |
| text-muted | `#9C948A` Stone | `#8C8078` |
| border / input | `#E0D8CC` Sand | `#3D3835` |
| ring | = primary | = primary dark |
| success / destructive / warning | `#6B7F5E` / `#B85C5C` / `#C4A35A` | `#8FA881` / `#D4807A` / `#D4C078` |
| radius | sm 4, md 6, lg 8, xl 12 (px) | |

**Fonts.** `@expo-google-fonts` loaded in `app/_layout.tsx`. Tailwind `font-sans` is **DM Sans** (400/500/600/700) and `font-serif` is **Cormorant Garamond** (400 to 700). Serif is used for headings (`Text` variants h1 to h4).

**Implementation caveat.** Dark mode uses parallel `*-dark` tokens with explicit `dark:` classes everywhere (for example `bg-surface dark:bg-surface-dark`), not CSS variables. There are **about 878 hard-coded hex literals** in `app/` and `components/`, including inline `style={{}}` in newer screens like `engine.tsx` and the tab bar. In the rebuild, use CSS-variable tokens (NativeWind v4 `vars()`), so one class set works in both themes. CLAUDE.md says CVA is used, but it isn't: `Button` and `Text` use `switch` statements.

**Components worth porting or re-implementing** (rewrite against the new API, keep the look and feel):

| Component | Path | Why |
|---|---|---|
| `Sheet` (gorhom wrapper with themed backdrop and handle) | `components/ui/Sheet.tsx` | Clean base bottom sheet |
| `AskNimaSheet` + ask/* (ChatInput, MessageBubble, PromptSuggestions, SearchingCard, FittingRoomCard, ExploreCard, WelcomeHero, ChatHistoryDrawer) | `components/ask/` | Complete chat UX |
| `CreateLookSheet` | `components/discover/CreateLookSheet.tsx` | Selection, generate, save/discard flow with haptics |
| `QuickTryOnModal` | `components/quick-try-on/QuickTryOnModal.tsx` | State machine: checking, no_photo, no_credits, capture, uploading, generating, result |
| `FloatingLookLoader` | `components/discover/FloatingLookLoader.tsx` | Nice progress affordance for async generation |
| `LookCard`, `LookCardWithCreator`, `LookGrid`, `ApparelItemCard`, `ApparelGrid`, `ProductCard`, `CategoryCarousel`, `FilterTabs` | `components/discover/` | Feed cards and masonry-ish grids (width via `useWindowDimensions`) |
| `RecommendationCard`, `FloatingAskNimaButton` | `components/engine/` | For You cards |
| `LookCarousel`, `ProductItem` | `components/fitting/` | Fitting room |
| `ShareOptionsModal`, `UserPickerModal` | `components/ui/` | Friends, search, WhatsApp share |
| `CreditsModal` | `components/credits/CreditsModal.tsx` | Packs grid and M-Pesa phone entry with status polling |
| `GateSplash`, `ChatBubble`, `TypingText` | `components/landing/` | Animated "rising sun" gradient splash |
| `StyleChatStep`, `PhotoUploadStep`, `LoadingStep`, `SuccessStep` | `components/onboarding/steps/` | Chat-style onboarding |
| `Header` (cart, DM and activity badges), `NoInternetBanner`, `ErrorBoundary`, `Skeleton`, `Badge`, `Avatar`, `Button`, `Text` | `components/ui/`, `components/` | Primitives |
| Style-vibe images | `assets/*.jpeg` (8 cards), mascot and logo PNGs, `confident_543.mp3` notification sound | Brand assets |

---

## 6. Web responsiveness

This is minimal. The app is mobile-first and web is "it runs":
- `react-native-web` plus Metro web bundler (`app.config.js` `web.bundler: "metro"`).
- `shims/react-native-pager-view.web.js` is aliased in `metro.config.js` for web. It is now unused.
- The WorkOS web callback path uses `sessionStorage` for the PKCE verifier (`lib/auth.ts`, `app/callback.tsx`). SecureStore falls back on web (`lib/auth-storage.ts`), and there is a web branch in `SettingsTab`.
- Only 2 responsive classes (`md:text-6xl` in GateSplash, `md:w-[30%]` in StyleFitTab). Grids compute columns from `useWindowDimensions` in 3 places, and 7 places use static `Dimensions.get` (these don't react to resize). There is no max-width container, no desktop layout and no sidebar navigation. The bottom tab bar is used on desktop too.
- The rebuild's universal app therefore needs real breakpoints and layout work. Nothing here is reusable for desktop web beyond the `useWindowDimensions` grid-column pattern.

---

## 7. CLAUDE.md, INSTRUCTIONS.md and cursor rules

- **CLAUDE.md** (130 lines) describes the product ("Pinterest meets personal stylist") and stack (Expo 54, Router v6, Convex, NativeWind v4, WorkOS PKCE, Vercel AI SDK + OpenAI chat, Gemini images, `@convex-dev/workflow`, Fingo M-Pesa KES). It also covers dev commands (`npm start` + `npx convex dev`), noting there are no tests or lint, the routing overview, backend domain folders, the auth flow in 6 steps, state (Convex queries + 3 contexts), and the **mandatory Convex rules**: explicit `ctx`/`args`/return types plus a `returns` validator on every function, `"use node"` actions in separate files, and indexes instead of `.filter()`. It ends with the design palette, the `shopnima://` scheme and env var names. It is slightly stale: it mentions a nonexistent `(auth)` group, CVA and "~20 tables" (there are 34).
- **INSTRUCTIONS.md** (21 lines) is only a troubleshooting note for the WorkOS "invalid redirect URI" error. It says the URI must be exactly `shopnima://callback` with no trailing slash, and to check the staging env. It embeds a public client ID, which **differs** from the one in `eas.json` (suggesting staging vs production).
- **.cursor/rules**: `project-description.mdc` is a 402-line PRD ("Panel AI for Ian N.", Jan 2025) covering personas, flows, "Lookbooks" naming, the Nima Shop concierge, monetisation tiers, a data model, the MVP scope, risks and open questions. `convex_rules.mdc` and `convex-explicit-types.mdc` hold Convex conventions. `ui-colors.mdc` is the palette guide. **The PRD is worth reading for the rebuild's product spec.**

---

## 8. Code quality and TODOs

**Good:**
- Consistent domain folders and strongly typed Convex validators.
- Durable workflows with retries, and a model fallback on 503.
- Idempotent Fingo webhook with HMAC and replay protection.
- Single-flight WorkOS refresh (to cope with rotating refresh tokens).
- Error boundaries, an offline banner, haptics and dark mode.
- Credits logic is centralised in one `deductCredit` mutation.

**Problems:**
- **No tests, lint or CI**, and no `node_modules` in the clone, so it was not type-checked here.
- About **207 `console.log` calls in convex** and 45 in the client. The logs include full raw AI responses and item lists.
- Duplication:
  - `app/(tabs)/ask.tsx` (561 lines) vs `components/ask/AskNimaSheet.tsx` (702 lines) implement the same chat.
  - `workflows/itemTryOn.ts` duplicates `workflows/actions.generateItemTryOnImage`, and the first appears unused.
  - Formality and matching helpers are copy-pasted between `chat/mutations.ts` and `recommendations/mutations.ts`.
- Very large files: `looks/queries.ts` 2.3k lines, `sellers/queries.ts` 2.2k, `chat/mutations.ts` 1.9k, `admin/analytics.ts` 1.7k, `workflows/actions.ts` 1.5k.
- **Credit leaks:** `recreateLook` and `retryLookGeneration` schedule Gemini generations without deducting credits.
- `styleProfile: v.any()`, and about 55 `any` usages overall.
- Deprecated fields are kept in the schema (`dailyTryOnCount`, `DAILY_TRYON_LIMITS`, `stripeTransferId`).
- Dead code: v1 onboarding steps, `AuthGuard.tsx` (unused), the pager-view shim, and the `/explore` and `/ask/[chatId]` stubs.
- Config issues: iOS AASA/bundle mismatch, a questionable Vercel Gateway base URL, and public IDs hard-coded in `eas.json`.
- Backend forked across two repos (Native vs Nima-Convex) against one deployment.
- Images are handled as base64 in memory with no server-side resizing. Try-on quality depends entirely on Gemini preview models.

**Explicit TODOs:** only `app/index.tsx:32` ("Add a nice Error component"). The "Coming Soon" checkout and the analytics stub are implicit TODOs.

---

## 9. Reuse vs discard for the rebuild (Fastify, Prisma, Postgres, WebSockets, Better Auth, Expo universal)

### Reuse (port the logic and content; rewrite the code for the new stack)

| What | Source | How to reuse |
|---|---|---|
| Domain model | `convex/schema.ts` | Translate to `schema.prisma`. The table list in section 3 is a good starting ERD: users, user_images, items, item_images, looks, look_images, lookbooks, lookbook_items, threads, messages, friendships, direct_messages, look_interactions, item_likes, cart_items, orders, order_items, credit_purchases, push_tokens, wardrobeItems, recommendations, and sellers + tiers + subscriptions. Add a proper `credit_ledger` table instead of mutable balance fields |
| Credit rules | `convex/credits/mutations.ts` (`deductCredit`), `convex/types.ts` (`CREDIT_PACKAGES`, `FREE_WEEKLY_CREDITS`, `TIER_*`) | Same semantics in a Postgres transaction. Fix the recreate and retry leaks. Make costs a config table |
| Fingo M-Pesa integration | `convex/credits/actions.ts`, `convex/http.ts` (`/webhooks/fingo` HMAC verify), `orders/actions.ts` | Port nearly verbatim to Fastify routes |
| AI prompts | `workflows/actions.ts` (style profile, item selection, look/try-on prompt-writer, Gemini final prompt, retry prompt), `userImages/actions.ts` (photo validation schema and rubric), `wardrobe/actions.ts` (item analysis and closet scan), `chat/actions.ts` (`NIMA_SYSTEM_PROMPT` + `[MATCH_ITEMS]` protocol), `recommendations/actions.ts` (Kenyan stylist comment) | Copy into a prompts module. Keep the provider abstraction so a self-hosted or open VTON model can replace Gemini later |
| Rule-based outfit matcher and recommendation scoring | `recommendations/mutations.ts`, `chat/mutations.ts` | Port as a pure TS module (dedupe it) |
| Onboarding content | `components/onboarding/types.ts` (budget KES tiers, occasions, gender, 8 style-vibe cards) + `assets/*.jpeg` | Reuse as-is |
| Async job pattern | workflow and scheduler usage | Re-implement with a job queue (for example BullMQ or pg-boss) plus WebSocket status events |
| Design tokens and fonts | `tailwind.config.js`, `lib/constants/Colors.ts` | Convert to CSS-variable tokens |
| UI components and UX flows | See the section 5 table (Sheet, AskNimaSheet, CreateLookSheet, QuickTryOnModal, FloatingLookLoader, cards, ShareOptionsModal, CreditsModal, GateSplash, StyleChatStep) | Port the JSX and styling, swapping Convex hooks for the new API client (TanStack Query + WS) |
| Expo config knowledge | `app.config.js` (permissions strings, notification sound, intent filters), `eas.json` profiles | Reuse, fixing the AASA |
| Push sending | `convex/notifications/actions.ts` (Expo push API, 10 message templates) | Port directly |
| Product spec | `.cursor/rules/project-description.mdc` | Read as a PRD input |

### Discard

- Everything Convex-specific: `ConvexProviderWithAuth`, `useQuery` wiring, `convex/_generated`, the `@convex-dev/workflow` definitions, and the Convex rules in CLAUDE.md and `.cursor/rules/convex*`.
- WorkOS auth: `lib/auth.ts`, `lib/auth-storage.ts`, `app/callback.tsx`, `convex/auth.ts`, `convex/webhooks/workos.ts`, `INSTRUCTIONS.md`. Better Auth replaces these, though the SecureStore chunking idea may still be useful.
- Dead or stub code: v1 onboarding steps, `AuthGuard.tsx`, `app/(tabs)/ask.tsx` duplicate, `app/explore.tsx`, `app/ask/[chatId].tsx`, `shims/`, `workflows/itemTryOn.ts`, `lib/analytics.ts` (re-do with self-hosted PostHog if wanted), and the misnamed `lib/mock-chat-data.ts` (keep the copy strings, rename the file).
- Deprecated schema fields (`dailyTryOn*`, `subscriptionTier` for consumers, `stripeTransferId`) and the `.idea` and `.vscode` folders.
- Hard-coded hex styling and the parallel `*-dark` classes.
- Vercel AI Gateway code path.

---

## 10. nima-demo

- **What it is:** a Next.js 16 / React 19 / Tailwind 4 demo storefront called **"NOIR – Editorial Fashion"**. It has 11 hard-coded products (USD prices, images in `public/`), a category filter and a product page. 6 commits (2026-03-06 to 03-11) by 4kClinton.
- **What it demonstrates:** the **Nima Connect** partner integration, meaning B2B "Try on with Nima" for third-party shops.
  1. `app/api/nima-session/route.ts` builds an absolute product image URL server-side and POSTs `{productImageUrl, externalProductId, productName, productCategory}` to `NIMA_API_URL` (Convex HTTP `/api/v1/sessions`) with `Authorization: Bearer ${NIMA_API_KEY}`. It returns `{sessionToken, widgetUrl}`.
  2. The product page opens `widgetUrl` (default `http://localhost:3000/connect?session=…`, which is a page in the Nima-Convex web app) in a popup window.
  3. `app/api/nima-track/route.ts` forwards `added_to_cart` and `purchased` events (`itemValue` in cents, currency, `trackingId`) to `NIMA_TRACK_URL` (`/api/v1/track`) for partner attribution analytics (the `api_usage_logs` table).
- **Secrets:** the API key is read from env only. No `.env` file is tracked and no `nima_pk_` key is present in source.
- **Code quality:** verbose request/response logging (it logs full Nima response headers and bodies) and `// TODO: real cart logic` and `// TODO: real checkout logic`. The README is the unmodified create-next-app one.
- **Reusable:** the **integration contract** only. If the rebuild keeps a B2B try-on widget, this is a ready reference client and test harness for the new Fastify `/v1/sessions` + `/v1/track` endpoints. Everything else (UI, products) is throwaway.

## 11. docs

- **It is a template.** It is the stock **Mintlify Starter Kit**: `docs.json` has `"name": "Mint Starter Kit"`, green theme `#16A34A`, and pages index, quickstart, development, essentials/*, ai-tools/{cursor,claude-code,windsurf}, and an api-reference with the sample OpenAPI (plant store create/get/delete/webhook). There is one commit ("Initial commit", 2026-01-12, zyraglobal7). **The word "Nima" does not appear anywhere.**
- **Reusable:** nothing, beyond confirming the team intended Mintlify for (probably Nima Connect API) docs. If public API docs are needed, write an OpenAPI spec from the new Fastify routes and pick a self-hosted docs tool.
