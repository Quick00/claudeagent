-- Baseline migration: captures the Repository model and repositoryId columns
-- that were added to the database without a corresponding migration file.
-- Marked as already-applied via `prisma migrate resolve --applied` so no SQL
-- runs against the existing database. Keeps migration history aligned with
-- the actual production schema.
--
-- Uses IF NOT EXISTS / IF NOT EXISTS guards so this is idempotent — safe to
-- run on environments where the Repository schema was already created manually
-- or via `prisma db push`.
--
-- The HNSW index on KnowledgeEntry.embedding is intentionally NOT dropped
-- here — it exists in production (created via raw SQL in an earlier
-- migration) but Prisma cannot represent it in schema.prisma because the
-- vector column uses `Unsupported(...)`. See commit 75e38c3.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "repositoryId" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "repositoryId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Repository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "gitlabProjectId" INTEGER NOT NULL,
    "gitlabUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "localPath" TEXT NOT NULL,
    "lastPulledAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Repository_gitlabProjectId_key" ON "Repository"("gitlabProjectId");

-- AddForeignKey (idempotent: only add if not already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_repositoryId_fkey') THEN
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeEntry_repositoryId_fkey') THEN
    ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
