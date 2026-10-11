-- Occasions on a look, for the filters across the top of For You.
ALTER TABLE "looks" ADD COLUMN "occasions" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "looks_occasions_idx" ON "looks" USING GIN ("occasions");
