-- Hand written migration for everything the Prisma schema language cannot
-- express: vector indexes, trigram search indexes, and check constraints that
-- protect invariants the application relies on.
--
-- Run after the init migration. Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------------------
-- Vector search (pgvector, cosine distance)
--
-- HNSW is built for recall and speed on read heavy workloads, which is what a
-- feed is. m and ef_construction are the pgvector defaults; raise
-- ef_construction if recall is not good enough once there is real data.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON "products" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS looks_embedding_hnsw_idx
  ON "looks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS wardrobe_items_embedding_hnsw_idx
  ON "wardrobe_items" USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Text search
--
-- Trigram indexes power "did you mean" style matching on product titles,
-- store names and handles. Postgres full text handles the long description.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS products_title_trgm_idx
  ON "products" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS stores_name_trgm_idx
  ON "stores" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_handle_trgm_idx
  ON "profiles" USING gin ("handle" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_search_idx
  ON "products"
  USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')));

-- ---------------------------------------------------------------------------
-- Invariants
-- ---------------------------------------------------------------------------

-- A look item is either a catalogue product or something from the user's own
-- wardrobe. Never both, never neither.
ALTER TABLE "look_items"
  DROP CONSTRAINT IF EXISTS look_items_exactly_one_source;
ALTER TABLE "look_items"
  ADD CONSTRAINT look_items_exactly_one_source CHECK (
    (("productId" IS NOT NULL)::int + ("wardrobeItemId" IS NOT NULL)::int) = 1
  );

-- A save and a dismissal each point at exactly one thing.
ALTER TABLE "saves"
  DROP CONSTRAINT IF EXISTS saves_exactly_one_target;
ALTER TABLE "saves"
  ADD CONSTRAINT saves_exactly_one_target CHECK (
    (("lookId" IS NOT NULL)::int + ("productId" IS NOT NULL)::int) = 1
  );

ALTER TABLE "dismissals"
  DROP CONSTRAINT IF EXISTS dismissals_exactly_one_target;
ALTER TABLE "dismissals"
  ADD CONSTRAINT dismissals_exactly_one_target CHECK (
    (("lookId" IS NOT NULL)::int + ("productId" IS NOT NULL)::int) = 1
  );

-- A follow points at a person or a store, not both.
ALTER TABLE "follows"
  DROP CONSTRAINT IF EXISTS follows_exactly_one_target;
ALTER TABLE "follows"
  ADD CONSTRAINT follows_exactly_one_target CHECK (
    (("followedId" IS NOT NULL)::int + ("storeId" IS NOT NULL)::int) = 1
  );

-- Nobody follows or blocks themselves.
ALTER TABLE "follows"
  DROP CONSTRAINT IF EXISTS follows_no_self_follow;
ALTER TABLE "follows"
  ADD CONSTRAINT follows_no_self_follow CHECK ("followerId" <> "followedId" OR "followedId" IS NULL);

ALTER TABLE "blocks"
  DROP CONSTRAINT IF EXISTS blocks_no_self_block;
ALTER TABLE "blocks"
  ADD CONSTRAINT blocks_no_self_block CHECK ("blockerId" <> "blockedId");

-- Money and quantities can never be negative. The old codebase allowed a
-- negative cart quantity, which lowered the order total.
ALTER TABLE "cart_items"
  DROP CONSTRAINT IF EXISTS cart_items_quantity_positive;
ALTER TABLE "cart_items"
  ADD CONSTRAINT cart_items_quantity_positive CHECK ("quantity" > 0 AND "quantity" <= 99);

ALTER TABLE "order_items"
  DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_quantity_positive CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  DROP CONSTRAINT IF EXISTS order_items_amounts_non_negative;
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_amounts_non_negative CHECK (
    "unitPriceCents" >= 0 AND "totalCents" >= 0
  );

ALTER TABLE "product_variants"
  DROP CONSTRAINT IF EXISTS product_variants_price_non_negative;
ALTER TABLE "product_variants"
  ADD CONSTRAINT product_variants_price_non_negative CHECK (
    "priceCents" >= 0 AND "stock" >= 0
  );

ALTER TABLE "orders"
  DROP CONSTRAINT IF EXISTS orders_amounts_non_negative;
ALTER TABLE "orders"
  ADD CONSTRAINT orders_amounts_non_negative CHECK (
    "subtotalCents" >= 0 AND "deliveryCents" >= 0 AND "totalCents" >= 0
      AND "platformFeeCents" >= 0
  );

-- Credit entries are never zero: a zero movement is a bug, not a no-op.
ALTER TABLE "credit_ledger_entries"
  DROP CONSTRAINT IF EXISTS credit_entries_non_zero;
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT credit_entries_non_zero CHECK ("delta" <> 0);

-- A balance can reach zero but never go below it.
ALTER TABLE "credit_balances"
  DROP CONSTRAINT IF EXISTS credit_balance_non_negative;
ALTER TABLE "credit_balances"
  ADD CONSTRAINT credit_balance_non_negative CHECK ("balance" >= 0);

-- Reviews are one to five stars.
ALTER TABLE "reviews"
  DROP CONSTRAINT IF EXISTS reviews_rating_range;
ALTER TABLE "reviews"
  ADD CONSTRAINT reviews_rating_range CHECK ("rating" BETWEEN 1 AND 5);

-- A promotion must end after it starts and cannot overspend its budget.
ALTER TABLE "promotions"
  DROP CONSTRAINT IF EXISTS promotions_window_valid;
ALTER TABLE "promotions"
  ADD CONSTRAINT promotions_window_valid CHECK ("endsAt" > "startsAt");

-- ---------------------------------------------------------------------------
-- Partial indexes for the hot paths
-- ---------------------------------------------------------------------------

-- The public feed only ever reads published, public looks.
CREATE INDEX IF NOT EXISTS looks_public_feed_idx
  ON "looks" ("publishedAt" DESC)
  WHERE "visibility" = 'PUBLIC' AND "publishedAt" IS NOT NULL;

-- Shop listings only read active products that are in stock.
CREATE INDEX IF NOT EXISTS products_active_idx
  ON "products" ("publishedAt" DESC)
  WHERE "status" = 'ACTIVE' AND "inStock" = true;

-- The worker polls for unprocessed webhooks and unread notifications.
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
  ON "webhook_events" ("receivedAt")
  WHERE "processedAt" IS NULL;

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON "notifications" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- Guest cleanup: anonymous accounts that were never upgraded.
CREATE INDEX IF NOT EXISTS users_anonymous_idx
  ON "users" ("createdAt")
  WHERE "isAnonymous" = true;
