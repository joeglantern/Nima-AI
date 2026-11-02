-- Booth sales: paid by scanning a shop's QR at an event and handed over there.
ALTER TYPE "DeliveryMethod" ADD VALUE 'AT_BOOTH';

CREATE TYPE "OrderChannel" AS ENUM ('ONLINE', 'BOOTH');

ALTER TABLE "orders" ADD COLUMN "channel" "OrderChannel" NOT NULL DEFAULT 'ONLINE';

CREATE INDEX "orders_storeId_channel_paidAt_idx" ON "orders"("storeId", "channel", "paidAt");
