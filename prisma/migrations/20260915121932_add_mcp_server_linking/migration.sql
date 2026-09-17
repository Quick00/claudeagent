/*
  Adds the MCP server linking tables, and catches the migration history up
  with schema drift that had accumulated before them (KnowledgeEntry columns,
  KnowledgeSource / KnowledgeReview / VerificationRun / RepoSync).

  Every statement is guarded (IF [NOT] EXISTS, pg_constraint lookups) because
  deployed environments do not get their schema from this history at all:
  docker-entrypoint.sh syncs with `prisma db push --accept-data-loss`, so a
  real database may already be in the pushed shape — repositoryId / source
  already dropped, the new tables already present — or in the pre-push shape,
  or anywhere in between. An unguarded DROP CONSTRAINT here failed with
  42704 against such a database, was recorded as a failed migration, and
  blocked every later `migrate deploy`. Same approach as
  20260413000000_baseline_repository.

  The HNSW index on KnowledgeEntry.embedding is recreated at the end rather
  than dropped: the vector column is `Unsupported(...)` in schema.prisma, so
  Prisma cannot represent the index and `migrate dev` diffs it as an extra
  index to remove. It is what serves the `ORDER BY embedding <=> $vector`
  queries in src/lib/embeddings.ts; dropping it turns every knowledge search
  into a sequential scan. If a future `migrate dev` emits
  `DROP INDEX "KnowledgeEntry_embedding_idx"` again, delete that line.
*/
-- DropForeignKey
ALTER TABLE "KnowledgeEntry" DROP CONSTRAINT IF EXISTS "KnowledgeEntry_repositoryId_fkey";

-- AlterTable
ALTER TABLE "KnowledgeEntry" DROP COLUMN IF EXISTS "repositoryId",
DROP COLUMN IF EXISTS "source",
ADD COLUMN IF NOT EXISTS "correctionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'derived',
ADD COLUMN IF NOT EXISTS "lastRetrievedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "gitlabProjectId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "blobSha" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KnowledgeReview" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "KnowledgeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VerificationRun" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL DEFAULT '',
    "costUsd" DOUBLE PRECISION,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RepoSync" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT,
    "gitlabProjectId" INTEGER NOT NULL,
    "fromSha" TEXT NOT NULL,
    "toSha" TEXT NOT NULL,
    "changedFiles" TEXT[],
    "reason" TEXT NOT NULL DEFAULT 'sync',
    "wouldStaleCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "McpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'HTTP',
    "resource" TEXT NOT NULL,
    "authorizationServerUrl" TEXT NOT NULL,
    "authorizeEndpoint" TEXT NOT NULL,
    "tokenEndpoint" TEXT NOT NULL,
    "registrationEndpoint" TEXT,
    "revocationEndpoint" TEXT,
    "scope" TEXT,
    "tokenEndpointAuthMethod" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "clientSecretExpiresAt" TIMESTAMP(3),
    "registrationAccessToken" TEXT,
    "registrationMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "McpServerConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "McpOAuthState" (
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeSource_gitlabProjectId_path_idx" ON "KnowledgeSource"("gitlabProjectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeSource_entryId_gitlabProjectId_path_key" ON "KnowledgeSource"("entryId", "gitlabProjectId", "path");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeReview_status_createdAt_idx" ON "KnowledgeReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VerificationRun_entryId_createdAt_idx" ON "VerificationRun"("entryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "McpServerConnection_userId_mcpServerId_key" ON "McpServerConnection"("userId", "mcpServerId");

-- AddForeignKey (idempotent: only add if not already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeSource_entryId_fkey') THEN
    ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeReview_entryId_fkey') THEN
    ALTER TABLE "KnowledgeReview" ADD CONSTRAINT "KnowledgeReview_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationRun_entryId_fkey') THEN
    ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RepoSync_repositoryId_fkey') THEN
    ALTER TABLE "RepoSync" ADD CONSTRAINT "RepoSync_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpServerConnection_userId_fkey') THEN
    ALTER TABLE "McpServerConnection" ADD CONSTRAINT "McpServerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpServerConnection_mcpServerId_fkey') THEN
    ALTER TABLE "McpServerConnection" ADD CONSTRAINT "McpServerConnection_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpOAuthState_userId_fkey') THEN
    ALTER TABLE "McpOAuthState" ADD CONSTRAINT "McpOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpOAuthState_mcpServerId_fkey') THEN
    ALTER TABLE "McpOAuthState" ADD CONSTRAINT "McpOAuthState_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Restore the HNSW index (see header). `db push` drops it too, since Prisma
-- does not know about it, so a pushed database also needs this.
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_embedding_idx" ON "KnowledgeEntry" USING hnsw (embedding vector_cosine_ops);
