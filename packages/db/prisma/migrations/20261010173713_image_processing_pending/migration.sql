-- AlterEnum
ALTER TYPE "ImageProcessing" ADD VALUE 'PENDING';

-- DropIndex
DROP INDEX "looks_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "products_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "products_title_trgm_idx";

-- DropIndex
DROP INDEX "profiles_handle_trgm_idx";

-- DropIndex
DROP INDEX "stores_name_trgm_idx";

-- DropIndex
DROP INDEX "wardrobe_items_embedding_hnsw_idx";
