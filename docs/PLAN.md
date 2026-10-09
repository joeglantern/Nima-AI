# Nima AI — Technical Plan (v3)

_Updated 2026-09-21. Inputs: `NIMA AI BRIEF.pdf`, the Canva design (11 screens), and research on current open-source models and integrations._

**Constraints (from you)**
- Open-source and self-hosted everywhere, **except try-on image generation**. That uses **Google Gemini**, the way the original app did (§4).
- Hosting is a normal **Contabo VPS** (CPU only). No home GPU or laptop in the setup.
- App Store and Google Play developer accounts **already exist**.
- Nima is **one Expo app** that ships to iOS, Android and **the web (Expo web)**. The web must be **truly responsive** (phone → tablet → desktop), not a stretched phone layout.

---

## 1. What we're building (from brief + design)

AI stylist + virtual try-on + social fashion feed + marketplace, Kenya-first (KSh, M-Pesa, Pick Up Mtaani).

**Design notes (Canva)**
- **Top navigation:** `Shop` · `For You` · `My Store`. Buyers and sellers use one account.
- **For You:** a full-bleed look card with Love / Save / Comments and a **"Nima Says"** AI caption.
- **Shop:** a masonry grid.
- **Auth:** a bottom sheet (Apple / Google / email) that appears only on gated actions.
- **Share sheet:** friend avatars, search, a group icon and Send.
- **Profile:** a **credits pill**, style tags, story-style highlight circles, and tabs: Looks · Lookbooks · Wardrobe · Recreations · Orders. The store profile reuses this header.
- **Visual tokens:**
  - cream `#FAF8F3`
  - deep brown `#4A2A12`
  - terracotta `#B8645A`
  - serif display (Cormorant-style) with a DM Sans-style UI font
  - egg/bean mascot

**Credits (decided):** every AI action is paid for with credits held in a **credit ledger** (an append-only `CreditLedger` table; the balance is the sum).
- **Free users** get a weekly credit grant, tunable in config. The old app gave 5; the brief suggests about 20. Start at 5 and raise it once real Gemini costs are known (see the cost maths in §4).
- **Credit packs** can be bought with M-Pesa via Fingo.
- **Premium sellers** get monthly credits plus the ghost-mannequin photo feature.
- **Costs per action are config, not code:** try-on, outfit try-on, accessory try-on, ghost-mannequin photo. Ask Nima chat is free but rate-limited, since it runs on our own CPU.
- **Failed jobs refund automatically.**
- **Starting numbers, taken from the previous app** (these were live at shopnima.ai):
  - 5 free credits per week, spent before purchased ones.
  - Packs of 10 / 20 / 50 / 100 credits for KES 500 / 1,000 / 2,500 / 5,000, i.e. KES 50 per credit.
  - Try-on = 1, quick camera try-on = 1, create a look = 1, 3 looks from chat = 3, onboarding looks = free.
- **Every generation path charges**, including recreate, retry and wardrobe processing. The old app leaked those.
- **iOS rule:** Apple rejected in-app credit sales via M-Pesa.
  - **iPhone:** credits are bought with Apple In-App Purchase, via the open-source `expo-iap` library. Apple takes 15–30%, so iOS pack prices can be higher.
  - **Android and web:** M-Pesa via Fingo.
  - **Physical products** use M-Pesa on every platform, which Apple allows.

This caps Gemini spend and makes try-on pay for itself: a credit sells for KES 50 (about $0.39) and one Gemini image costs about $0.07–0.13 (§4).

---

## 2. What "free" really means (costs you can't avoid)

All software is open-source and costs nothing. These still cost money:

| Unavoidable | Why | How we minimise it |
|---|---|---|
| Contabo VPS | Somewhere has to run the server | One VPS. Pick one with a lot of RAM (the LLM runs in RAM, see §5) |
| Domain name | Needed for HTTPS, email and app links | About $10/yr |
| Apple's 15–30% cut on iOS credit sales | Apple requires In-App Purchase for digital goods like credits | Only on iOS; Android and web use M-Pesa |
| Fingo Pay transaction fees | Payment processors charge per transaction. This comes out of sales, it isn't a subscription | Priced into the platform fee |
| Pick Up Mtaani delivery fees | Charged per parcel | The buyer pays at checkout |
| **Google Gemini API** (try-on images) | Image generation needs a GPU; paying per image is simpler and proven by the old app | Credits cover it; cheaper model by default (§4) |
| **SMS OTP** | Every SMS costs money | **We skip SMS.** We use email OTP, magic links and Google/Apple sign-in, which are all free |

The App Store and Google Play developer accounts already exist, so they cost nothing extra. **Sign in with Apple is still mandatory** when Google login is offered (Apple flagged the old app).

**Not used (paid, and not needed):** OpenAI, the Claude API, Photoroom, Cloudflare R2, Resend, PostHog cloud and Tailscale.

---

## 3. Stack (all open source)

| Concern | Choice | License / notes |
|---|---|---|
| API | **Fastify 5 + TypeScript (ESM)** | MIT |
| Contracts | **Zod + `fastify-type-provider-zod`** → OpenAPI → generated typed client | MIT |
| DB | **PostgreSQL 17 + Prisma**, with `pgvector`, `pg_trgm`, `citext` | PostgreSQL / Apache-2.0. Vectors via `Unsupported("vector(n)")` + raw SQL/TypedSQL |
| Auth | **Better Auth 1.7.x**: `anonymous` (guests), Google, Apple, **email OTP / magic link**, passkeys, `@better-auth/expo` | MIT. Guest data migrates to the real account in `onLinkAccount`. No SMS |
| Realtime | **`@fastify/websocket`** + **Valkey pub/sub** | MIT / BSD |
| Jobs | **BullMQ on Valkey** | MIT / BSD |
| Object storage | **Garage** (lightweight, S3-compatible) or **SeaweedFS** | AGPL (running it unmodified puts no obligations on our code) / Apache-2.0. **Not MinIO**, which was archived in 2026 |
| Images | **imgproxy** in front of storage for resizing and WebP/AVIF, cached by Caddy | Apache-2.0 |
| Search | Postgres FTS + `pg_trgm`, then **Meilisearch** later | MIT |
| Email | **Stalwart** or **Postal** on the VPS, with SPF/DKIM/DMARC/rDNS | AGPL / MIT. Contabo allows port 25 (about 25 mails/min). Deliverability to Gmail needs IP warm-up |
| Push | **Expo push service** | Free, no per-message fee |
| Errors | **GlitchTip** | MIT, Sentry-SDK compatible |
| Uptime | **Uptime Kuma** | MIT |
| Analytics | Our own `events` table + roll-ups (also powers seller analytics), optionally **Umami** for web traffic | MIT |
| Try-on images | **Google Gemini API** (`@google/genai`) | Paid per image. The only paid AI service |
| Deploy | **Docker Compose + Caddy** (automatic HTTPS) | Apache-2.0 |
| CI | GitHub Actions (free for public repos, and generous free minutes for private ones), or Woodpecker CI self-hosted | — |
| App | **Expo SDK + Expo Router**: iOS, Android and **web** from one codebase | MIT |
| Styling | **NativeWind** (Tailwind for RN) with responsive `sm: md: lg: xl:` prefixes | MIT |
| Monorepo | **Turborepo + pnpm** | MIT |

---

## 4. Virtual try-on (Gemini, like the original app, but improved)

### How the original app did it
1. The user taps try-on. Credits are taken and a "pending" job is created.
2. The server downloads the user's photo and up to 5 item photos.
3. **GPT-4o writes a prompt** ("fashion photography director": keep the face and body, show every item, natural light, clean background).
4. **Gemini `gemini-3-pro-image-preview`** gets the prompt plus the images, falling back to `gemini-3.1-flash-image-preview` when Google is overloaded (503). The template is roughly: *"Create an image of this person (Reference Image 1) wearing the clothing items in the other reference images… keep face, body type & size and identity exactly… dress them in ALL the items."*
5. If the result is empty it retries once with a simpler prompt. The image is stored and the app updates.

The same recipe powered item try-on, outfit/look images, camera Quick Try-On, recreate, seller try-on links, the Nima Connect partner API, wardrobe clean-up and ghost mannequin. Code: `reference/Nima-Universe/packages/backend/convex/workflows/actions.ts`.

**Why keep this approach:** Gemini handles **several items at once and accessories** (bags, jewellery, headwraps), which dedicated try-on models don't. It's proven on real Kenyan outfits, needs no GPU of our own, and scales instantly.

### What we do better
| Change | Why |
|---|---|
| **Drop the GPT-4o prompt-writing step.** Build the prompt from a template plus the item data we already store (category, colour, material, description) | One less paid service per try-on, 2–5 s faster, and no OpenAI account. If a model is ever needed, our self-hosted Qwen can do it for free |
| **Pick the model per job.** Default to the cheaper, faster **Gemini Flash image** model (Nano Banana 2) for single items and Quick Try-On. Use **Gemini Pro image** for full outfits and premium sellers | Pro is roughly 2× the price of Flash. Week-1 test decides which is good enough where |
| **Resize images on our server** (imgproxy) before sending: about 1024 px, JPEG | Fewer input tokens, lower cost, faster uploads. The old app sent full-size photos |
| **Chained edits:** "change the top" / "add heels" send the previous result as the base image | Keeps the person consistent across edits |
| **Check the photo before charging** (face visible, full body for outfits, upper body for accessories) with a free self-hosted vision check | No credits wasted on unusable photos |
| **Cache results:** same photo + same items = same result, no new charge | Saves money when users re-open or share |
| **One `chargeAndEnqueue()` for every image job**, with refund on failure | Fixes the old leaks (recreate, retry and chat looks were free) |
| **Fail closed:** no user photo means no generation | The old fallback dropped the photo and showed a random person |
| **Provider interface** (`TryOnProvider`) | We can A/B-test **FASHN v1.6** (a dedicated try-on API, about $0.075/image, sharper on prints and logos) for single garments later, or switch models without touching the app |
| **Async jobs + WebSocket** | The user sees "Nima is dressing you…" and the result appears live. No polling |

### Cost maths (estimates: confirm on Google's pricing page before launch)
| | Per image | Notes |
|---|---|---|
| Gemini Pro image (`gemini-3-pro-image-preview`) | ≈ $0.13 at 1–2K | What the old app used by default |
| Gemini Flash image (Nano Banana 2) | ≈ $0.05–0.07 at about 1K | Cheaper and faster default |
| One credit sold | KES 50 ≈ $0.39 | Android/web via M-Pesa. iOS nets 15–30% less after Apple's cut |

- **Paid try-ons are profitable:** even on Pro, a KES 50 credit covers the image about 3×.
- **Free credits are the real cost.** 5 free try-ons a week costs about $0.25–0.65 per active free user per week, so **1,000 active free users ≈ $1,100–2,800/month worst case.** That's why the free grant starts at 5, not 20. Watch it in the admin dashboard and tune it.
- **Privacy:** user photos go to Google. Say so in the privacy policy and at photo upload, and use the paid API tier (Google states paid-tier API data isn't used to train its models; confirm this in the current terms).

### How a try-on runs
1. The user picks items and a photo, and the app calls `POST /tryon`.
2. The photo check runs. Credits are debited and a job queued, in one transaction.
3. A worker on the VPS resizes the images, builds the prompt and calls Gemini (Flash or Pro), with fallback and one retry.
4. The result is stored privately in Garage. The worker pushes `tryon.done` over WebSocket. Credits are refunded if it fails.
5. The notice **"Visualization only — check the seller's size guide"** is always shown.

**Accessories** (jewellery, sunglasses) use the **upper-body photo**. Same pipeline, labelled "beta" until the quality is confirmed.

---

## 5. Other AI (open weights, self-hosted: free)

| Job | Model | License | Runs on |
|---|---|---|---|
| **Ask Nima stylist** (chat + tool calling) | **Qwen3 / Qwen3.6 30B-A3B MoE** (Q4 GGUF, about 18 GB RAM) via **llama.cpp server**, with fallback **Qwen3.5-4B** or **Gemma 4 E4B** | Apache-2.0 | VPS CPU: an estimated 5–10 tok/s |
| "Nima Says" captions, tags, query rewriting | Qwen3.5-4B / Gemma 4 E4B | Apache-2.0 | VPS CPU. Captions are pre-generated in batch, never on request |
| Wardrobe photo tagging (category, colour, pattern) | **Qwen3-VL-4B** (or Florence-2 for speed) | Apache-2.0 / MIT | VPS CPU, as an async job |
| Embeddings (products, looks, wardrobe, taste) | **Marqo-FashionSigLIP** | Apache-2.0 | VPS CPU → pgvector HNSW |
| Background removal | **BiRefNet** (via rembg with `birefnet-general` explicitly selected; **rembg's default model needs a paid license**) | MIT | VPS CPU, a few seconds per image |
| Ghost mannequin (seller photos) | **Gemini image** (paid), like the old app. Charged to seller credits | — | Gemini API |
| Moderation (NSFW on uploads) | Open NSFW classifier (e.g. Falconsai ViT, Apache-2.0) + Qwen3-VL check | Apache-2.0 | VPS CPU |

**Making a CPU LLM feel fast:**
- Keep the system prompt and tool schemas short and **reuse llama.cpp's prompt cache** (`--cache-reuse`, slot save), so the first token doesn't wait 10–60 s.
- **Do the heavy lifting in code, not the model.** The LLM decides *intent + filters* ("wedding, elegant, under KSh 5,000, size M"). Our code runs the vector search and ranking and returns real products. The model then writes a short reply.
- **Stream tokens over WebSocket** so replies appear as they're typed.
- **If CPU chat feels too slow** at launch, a cheap hosted model (e.g. Gemini Flash text on the same Google account) is a drop-in swap behind `LLMProvider`. The original app used OpenAI GPT-4.1 here. See open questions.

**VPS sizing:** because the LLM lives in RAM, choose a Contabo plan with **≥ 12 vCPU and ≥ 48 GB RAM** for comfort. The minimum is 8 vCPU / 32 GB with the 4B model only.

---

## 6. Web: responsive Expo, not a stretched phone

One codebase, with layout chosen by **screen width, not platform**, so a narrow browser gets the phone layout and an iPad or desktop gets a wide one.

**Breakpoints** (NativeWind / Tailwind; plus a `useBreakpoint()` hook for structural changes):

| Width | Navigation | For You | Shop / Explore | Sheets (auth, share) | Ask Nima |
|---|---|---|---|---|---|
| **< 768 (phone)** | Top pills (as in the design) + bottom tab bar | Full-bleed single card, vertical swipe | 2-column masonry | Bottom sheets | Full screen |
| **768–1279 (tablet / small laptop)** | Left icon rail | Centered card (max ~600 px) with product strip beside it | 3–4 columns | Centered modal | Side panel |
| **≥ 1280 (desktop)** | Full left sidebar (logo, Shop / For You / Explore / Messages / My Store / Profile) | Centered feed + **right panel** (Ask Nima, "shop this look", suggestions) | 4–6 columns, filters in a left column | Centered modal / dialog | Docked right panel, always available |

**How it's built**
- **Expo Router layouts switch on width:** `app/(main)/_layout.tsx` renders `<Tabs>` on narrow screens and a `<Sidebar>` + `<Slot>` on wide ones. Routes and URLs stay identical.
- **Responsive primitives** in `packages/ui`:
  - `<Sheet>`: a bottom sheet when narrow, a dialog when wide
  - `<Masonry columns={{base:2, md:3, lg:4, xl:6}}>`
  - `<Container maxW>`
  - `<SplitView>`
- **Web-only polish:**
  - hover states, cursor pointers, keyboard focus rings
  - `Esc` closes dialogs
  - right-click and open-in-new-tab work, because links are real `<a>` tags via Expo Router `Link`
- **Seller dashboard** (My Store) is designed **desktop-first** (tables, charts, bulk product editing) and collapses to stacked cards on phones.
- **SEO and sharing:** Expo Router **static/server output** for public pages (product, look, store, profile), with `<Head>` meta and Open Graph images. Shared links then preview nicely in WhatsApp, which matters for Kenya.
- **Test matrix:** 375 px, 768 px, 1024 px, 1440 px, 1920 px, in light mode (the design is light; dark mode comes later).

---

## 7. Architecture

```
  Expo app: iOS / Android / Web (responsive)
          │ HTTPS REST (typed client)   │ WSS /ws
          ▼                             ▼
┌──────────────────────── Contabo VPS (CPU) ─ Docker Compose ─────────────────────────┐
│ Caddy (TLS) ─► Fastify API ──► Postgres 17 (+pgvector, pg_trgm)                     │
│                │ /api/auth/* (Better Auth)                                          │
│                │ /ws gateway ◄── Valkey pub/sub ──► BullMQ queues                   │
│                │ /webhooks/fingo, /webhooks/pum                   │                 │
│ Garage (S3) ◄─ imgproxy                                          ▼                 │
│ llama.cpp server (Qwen MoE)      Workers: try-on orchestration · media (BiRefNet) · │
│ Stalwart mail · GlitchTip ·      tagging (Qwen-VL) · embeddings (FashionSigLIP) ·   │
│ Uptime Kuma                      feed · payouts · notifications · analytics         │
└──────────────────────────────────────┬──────────────────────────────────────────────┘
                                       │ HTTPS (pay per image)
                                       ▼
                    Google Gemini API: try-on, outfit looks, ghost mannequin
                    (Flash image by default, Pro for outfits / premium)
```

- The API never does slow work inline: enqueue → return `jobId` → the worker pushes the result over WebSocket.
- Valkey and Postgres listen only on the internal Docker network, with passwords. Nothing is exposed publicly except 80/443 (and SSH).
- Every external or AI dependency sits behind an interface in `packages/integrations`:
  - `TryOnProvider` (Gemini now, FASHN possible later), `LLMProvider`, `ImageTagger`, `Embedder`
  - `PaymentProvider`, `LogisticsProvider`, `Mailer`
  
  We can swap models or vendors without touching domain code.

---

## 8. Monorepo layout

```
nima/
├─ apps/
│  ├─ api/            Fastify (REST + WS + webhooks)
│  ├─ worker/         Node BullMQ workers (CPU jobs, orchestration)
│  ├─ ml-cpu/         Python: BiRefNet, FashionSigLIP, Qwen-VL tagging (on VPS)
│  └─ app/            Expo (iOS / Android / Web)
├─ packages/
│  ├─ db/             Prisma schema, migrations, TypedSQL
│  ├─ contracts/      Zod schemas + WS event types
│  ├─ api-client/     Generated typed client
│  ├─ integrations/   gemini, fingo, pickupmtaani, llm, storage, mailer adapters
│  ├─ ai/             Stylist: prompts, tool definitions, context builder
│  ├─ ui/             Responsive primitives + design tokens from Canva
│  └─ config/         tsconfig, eslint, env schema
├─ infra/             docker-compose.yml, Caddyfile, backups/
└─ docs/
```

---

## 9. Data model (Prisma, first cut)

**Identity and profile**
- `User`, `Session`, `Account`, `Verification`: generated by Better Auth. `User.isAnonymous` marks guests.
- `Profile`: `handle`, `displayName`, `bio`, `links`, `avatar`, `isPrivate`.
- `StyleProfile`: every field nullable and autosaved per question.
  - `age`, `gender`, `location`
  - `aesthetics[]`, `colors[]`, `occasions[]`
  - `budgetMin`, `budgetMax`
  - `clothingSize`, `shoeSize`, `measurements` (JSON)
  - `completedSteps[]`
  - `tasteEmbedding` (vector)
- `UserPhoto`: `kind` is `FULL_BODY` or `UPPER_BODY`, plus `storageKey` and `isDefault`. Private, and hard-deletable.

**Catalog and seller**
- `Store`: an optional 1:1 per user. `name`, `slug`, `verifiedAt`, `payoutMethod`, `plan`.
- `Product`: `title`, `description`, `category`, `tags[]`, `status`, `sizeGuide`, `returnPolicy`, `embedding`.
- `ProductVariant` (`size`, `color`, `sku`, `priceCents`, `stock`) and `ProductImage` (`originalKey`, `processedKey`, `processing`).

**Looks and social**
- `Look`:
  - `source`: `USER`, `AI`, `SELLER`, `CURATED`, `RECREATION`
  - `visibility`: try-ons default to `PRIVATE`
  - `coverImageKey`, `caption`, `nimaSays`, `recreatedFromId`, `embedding`
- `LookItem`: a product *or* a wardrobe item, plus a `slot`.
- `WardrobeItem`: image, category, colours, attributes, visibility, embedding.
- `Lookbook` and `LookbookEntry`: an entry points at a Look, Product or WardrobeItem, with `day` / `occasion` / `position`.
- `Save`, `Like`, `NotForMe`, `Comment`, `Follow`. **Follower counts are never exposed publicly**; they appear only in the seller dashboard.
- `Conversation`, `ConversationMember`, `Message`. A Message has `kind` (`TEXT`, `PRODUCT`, `LOOK`, `TRYON`, `LOOKBOOK`), `refId` and `readAt`.

**AI**
- `TryOnJob`: `photoId`, `items[]`, `model`, `status`, `resultKey`, `parentJobId` (for "change the top"), `costCredits`, `queuedAt`/`startedAt`/`finishedAt`.
- `StylistThread` and `StylistMessage`.
- `CreditLedger`: `delta`, `reason` (`WEEKLY_GRANT`, `TRYON`, `REFUND`, …).

**Commerce**
- `Cart`, `CartItem`, `CheckoutGroup`, `Order` (one per store), `OrderItem`.
- `Payment`: `provider`, `providerRef`, `idempotencyKey`, `status`, raw response.
- `Refund`, `Review`.
- `Shipment`: provider, ref, pickup point, status, events.
- `SellerLedgerEntry`, `Payout`, `WebhookEvent`.

**Analytics and ads**
- `Event`: append-only, partitioned monthly. `userId`/`anonId`, `type`, `entityType`, `entityId`, `storeId`, `props`.
- `DailyStoreStats`, `Promotion`.

---

## 10. Key flows (summary)

- **Guest → account:**
  1. On first open, `signIn.anonymous()`. Likes, cart and views are tracked against the guest.
  2. A gated action opens the auth sheet: _"Create an account to try this look on yourself."_
  3. `onLinkAccount` merges the guest's data into the new account.
  4. The questionnaire is a dismissable, autosaving card and never blocks anything.
- **Try-on:**
  1. Check credits → debit in a transaction → enqueue.
  2. A VPS worker calls Gemini and stores the private result.
  3. WebSocket `tryon.done`. Credits are refunded on failure.
  - "Change the top" chains a child job from the previous result.
  - The notice **"Visualization only — check the seller's size guide"** is always shown.
- **Ask Nima:**
  1. The LLM extracts intent and filters.
  2. Tools run: `search_products`, `get_wardrobe`, `get_style_profile`, `find_complements`, `create_look`, `start_tryon`, `add_to_lookbook`.
  3. Only real, in-stock items are returned. The reply streams over WebSocket.
- **Wardrobe:** upload → BiRefNet cut-out → Qwen-VL tags → FashionSigLIP embedding → item appears in Wardrobe.
- **For You:**
  - Candidates come from taste-vector similarity, follows, trending, seasonal sets and labelled promotions.
  - A weighted score, with negative signals from "not for me" and skips.
  - The taste vector is updated from events by a worker. Guests are personalized from session events.
- **Checkout** (Fingo has no native split):
  1. The cart is split into per-store orders.
  2. The buyer picks a Pick Up Mtaani point.
  3. Fingo STK push → verified, idempotent webhook → orders paid → seller ledger credited.
  4. The seller marks the order ready → Pick Up Mtaani package created → tracking webhooks update the shipment.
  5. After collection plus the return window, Fingo B2C/PesaLink pays the seller.
  - ⚠ Holding funds before payout may raise CBK licensing questions. Get a legal check.
- **Seller photos:** upload → BiRefNet white background (free, CPU) → optional Gemini ghost mannequin (seller credits) → seller picks an image.

---

## 11. Realtime events (WebSocket)

- The connection is authenticated with the Better Auth session. Each user is on a `user:{id}` channel via Valkey pub/sub.
- **Events:**
  - `message.new`, `message.read`, `typing`
  - `tryon.queued` (with ETA), `tryon.progress`, `tryon.done`, `tryon.failed`
  - `stylist.delta`, `stylist.done`
  - `payment.status`, `order.updated`, `shipment.updated`
  - `notification.new`
- Offline users get Expo push instead.

---

## 12. Seller analytics

- Every interaction goes to `events` with a `storeId`. Roll-ups populate `DailyStoreStats`: views, clicks, likes, saves, **try-ons**, carts, purchases, conversion, and followers (private).
- **The headline feature is the funnel:** view → try-on → cart → purchase.
- Premium adds aggregated demographics and preferences, with k-anonymity thresholds so individual buyers are never exposed.

---

## 13. VPS layout and ops

- **Docker Compose services:**
  - `caddy`, `api`, `worker`, `ml-cpu`, `llm` (llama.cpp)
  - `postgres`, `valkey`, `garage`, `imgproxy`
  - `stalwart`, `glitchtip`, `uptime-kuma`
- The Expo web build is served as static/server output by Caddy.
- **Backups:**
  - Nightly `pg_dump` plus WAL archiving (pgBackRest), and a Garage snapshot.
  - Copy offsite to a second cheap location, e.g. Contabo Object Storage.
  - Test restores monthly.
- **Security:** UFW (80/443/SSH only), fail2ban, SSH keys only, non-root containers, secrets outside git, and Postgres/Valkey never public.

---

## 14. Roadmap

**Phase 0: Foundations + try-on spike (weeks 1–2)**
- Monorepo, Compose, Postgres, Valkey, Garage, Caddy, CI.
- Better Auth: anonymous, Google, email OTP. Apple is added when the Apple account exists.
- Expo app shell with **responsive layouts** (tabs ↔ sidebar) and Canva tokens.
- **Try-on test:** Gemini Flash vs Pro image on 10–20 real Kenyan outfit photos, using the old prompts without the GPT-4o step. Decide which model is used where.

**Phase 1: Discover and account (weeks 3–5)**
- Stores and products (seeded), Shop grid, For You v1, looks, like/save/not-for-me.
- Profile, questionnaire autosave, photo upload, public SEO pages.

**Phase 2: AI core (weeks 6–9)**
- Gemini try-on pipeline + credits + WebSocket updates.
- llama.cpp stylist with tools.
- Wardrobe (BiRefNet + Qwen-VL + FashionSigLIP) and For You v2 (vectors).

**Phase 3: Social (weeks 10–11)**
- Follows, Explore, DMs and sharing, Recreate Look, Lookbooks, push.
- Start collecting our own licensed try-on dataset.

**Phase 4: Commerce (weeks 12–15)**
- Seller onboarding and product management, background removal.
- Cart, Fingo checkout, Pick Up Mtaani, orders, seller ledger and payouts, reviews and trust badges.

**Phase 5: Growth (weeks 16+)**
- Seller analytics and funnel, promotions, premium plan, admin and moderation.
- Ghost mannequin for sellers, and a FASHN vs Gemini comparison for single garments.

---

## 15. Lessons from the previous code

Full audits live in `docs/legacy/`: `nima-universe.md`, `nima-convex.md`, `nima-native-demo-docs.md`. The source is in `reference/`.

**What existed**
- The old team built three codebases on one shared Convex backend (about 43 tables):
  - **Nima-Convex:** Next.js web app (shopnima.ai) with the seller portal, admin and "Wrapped"
  - **Nima-Native:** the Expo app
  - **Nima-Universe:** the newest monorepo, merging both, plus a tailor portal
- Auth was WorkOS plus native Apple/Google. Payments were Fingo M-Pesa.
- **All AI was paid:** OpenAI for chat, prompts, tagging and captions, and Google Gemini for every image. We keep only Gemini, for images.
- `nima-demo` shows the **Nima Connect** B2B widget, which lets other shops embed "Try on with Nima". `docs` is an empty template.

**How their try-on worked:** see §4. We keep Gemini, drop the GPT-4o step and add the improvements listed there.

**Keep (port the ideas and content, not the Convex code)**
- **Schema shape.** A blueprint for `schema.prisma`: users, user_images, items, looks, lookbooks, wardrobe, recommendations, friendships, DMs, cart, orders, credit_purchases, sellers and tiers, api_partners/sessions (Connect), push_tokens.
- **AI prompts:**
  - stylist (`Nima-Convex/app/api/chat/route.ts`, the best version)
  - style profile, look curation, try-on template, "Nima Says" / Kenyan stylist comments
  - photo validation rubric, wardrobe analysis, closet scan, ghost mannequin
- **Rule-based outfit matcher:** formality and occasion scoring (`chat/mutations.ts`). Useful as For You v1 before vectors.
- **Fingo M-Pesa integration:** STK push plus an HMAC webhook with a replay window. Port nearly verbatim.
- **Credit economics** (see §1) and **seller tiers:** KES 0 / 5k / 15k / 30k per month, with seller try-on credits.
- **Onboarding content** and style-vibe images, and **UX components:**
  - Ask Nima sheet, create-look sheet, Quick Try-On modal (state machine), credits modal
  - share sheet, gate splash, lookbook screens
- **Extra features worth keeping on the roadmap:**
  - Quick Try-On (photograph a garment in a shop)
  - onboarding looks (3 free looks after sign-up)
  - seller try-on links
  - **Nima Connect** B2B API
  - Nima Wrapped
  - tailor portal (to confirm)

**Discard**
- All Convex and WorkOS code, the duplicated Next.js consumer app, the dead For You backend, `docs/`, and the demo UI.
- The legal texts (`Policies.ts`, `T&Cs.ts`) are useful only as structure. They cite services that aren't used, contradict themselves on photo retention, and choose Delaware law. Rewrite them for the **Kenya Data Protection Act 2019**, credits, and marketplace terms.

**Their mistakes → our rules (built in from day one)**
| Old problem | Our rule |
|---|---|
| Account takeover: server trusted a client-supplied email; unsigned auth webhook | Identity only comes from the Better Auth session. Every webhook is signature-verified |
| Admin catalogue and admin AI endpoints had **no auth** | Role-based guards (`requireRole('admin')`) on every route, plus tests that fail if a route lacks a guard |
| `getUser` leaked email, phone and address | Separate public and private DTOs, with Zod response schemas that strip private fields |
| Any file deletable by ID | Storage keys are owned: check ownership before any delete, and use presigned URLs only |
| Negative cart quantities lowered totals | Zod validation (`int().positive()`); totals always computed on the server from DB prices |
| Free and unlimited generation paths (recreate, retry, chat look IDs) | One `chargeAndEnqueue()` used by **every** AI job; refund on failure |
| Rate limiter defined but never used | `@fastify/rate-limit` globally plus per-route limits on AI and auth |
| Account deletion left photos in storage | A deletion job hard-deletes DB rows and storage objects, as the Data Protection Act requires |
| User blocks not enforced on the server | Blocks are checked in queries (feed, DMs, profile, search) |
| Money units inconsistent (cents vs whole KES) | All money is integer **cents** (`amountCents`) everywhere, matching Fingo |
| Single-item fallback dropped the user photo (showed a random person) | Try-on jobs fail closed: no user photo means no generation |
| No guest mode on mobile; Explore was a placeholder; DMs only shared looks; no courier | Covered by this plan: anonymous auth, Explore, text DMs, `LogisticsProvider` + Pick Up Mtaani |
| iPad got a phone layout (Apple flagged it) | Responsive layouts (§6) |
| No tests, lint or CI | Vitest + ESLint + typecheck in CI from week 1 |

**Design tokens:** the old app used **burgundy `#5C2A33` / ivory `#FAF8F5` / rose gold `#C9A07A`** (dark by default). The Canva design uses **brown `#4A2A12` / cream / terracotta**. Both use Cormorant Garamond + DM Sans. **Pick one** (see open questions).

---

## 16. Open questions

1. **Brand colours:** the Canva design (brown `#4A2A12` / cream / terracotta) or the old app (burgundy `#5C2A33` / ivory / rose gold)?
2. **Existing users and data:** shopnima.ai and the old Convex deployment appear to be live. Do we migrate users, products and looks into Postgres, or start fresh? Keep the shopnima.ai domain?
3. **Contabo plan specs** (vCPU / RAM / disk). These decide which chat model size we run.
4. **Fingo:** card API? Sub-merchant or split settlement to avoid holding funds? Fees?
5. **Pick Up Mtaani API key:** request it via their support email; it needs a registered business.
6. **Platform fee** percentage, and the return window before payouts.
7. **Extra features from the old code:** keep Nima Connect (B2B widget), Nima Wrapped, the tailor portal and seller try-on links in the roadmap?
8. **Kenya Data Protection Act:** consent for body photos, deletion, registering as a data controller. Rewrite the privacy policy and terms.
9. **iOS credit pricing:** Apple takes 15–30%. Charge more for packs on iOS, or absorb it?
10. **Ask Nima chat:** keep it free on our VPS (slower, about 5–10 words/s), or use a cheap hosted model like Gemini Flash (fast, pennies per chat), as the old app did with OpenAI?
11. **Google account:** is the old Gemini API key/billing account still available to reuse?
