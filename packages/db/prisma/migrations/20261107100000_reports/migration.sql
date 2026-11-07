-- Reports of looks and people, one per reporter and target. Additive.
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'NUDITY', 'HATE', 'SCAM', 'OTHER');

CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "lookId" TEXT,
    "userId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reports_reporterId_lookId_key" ON "reports"("reporterId", "lookId");
CREATE UNIQUE INDEX "reports_reporterId_userId_key" ON "reports"("reporterId", "userId");
CREATE INDEX "reports_resolvedAt_createdAt_idx" ON "reports"("resolvedAt", "createdAt");

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_lookId_fkey" FOREIGN KEY ("lookId") REFERENCES "looks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
