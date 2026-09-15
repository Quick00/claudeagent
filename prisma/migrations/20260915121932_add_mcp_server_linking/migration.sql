/*
  Warnings:

  - You are about to drop the column `repositoryId` on the `KnowledgeEntry` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `KnowledgeEntry` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "KnowledgeEntry" DROP CONSTRAINT "KnowledgeEntry_repositoryId_fkey";

-- DropIndex
DROP INDEX "KnowledgeEntry_embedding_idx";

-- AlterTable
ALTER TABLE "KnowledgeEntry" DROP COLUMN "repositoryId",
DROP COLUMN "source",
ADD COLUMN     "correctionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'derived',
ADD COLUMN     "lastRetrievedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "KnowledgeSource" (
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
CREATE TABLE "KnowledgeReview" (
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
CREATE TABLE "VerificationRun" (
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
CREATE TABLE "RepoSync" (
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
CREATE TABLE "McpServer" (
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
CREATE TABLE "McpServerConnection" (
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
CREATE TABLE "McpOAuthState" (
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "KnowledgeSource_gitlabProjectId_path_idx" ON "KnowledgeSource"("gitlabProjectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_entryId_gitlabProjectId_path_key" ON "KnowledgeSource"("entryId", "gitlabProjectId", "path");

-- CreateIndex
CREATE INDEX "KnowledgeReview_status_createdAt_idx" ON "KnowledgeReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRun_entryId_createdAt_idx" ON "VerificationRun"("entryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "McpServerConnection_userId_mcpServerId_key" ON "McpServerConnection"("userId", "mcpServerId");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeReview" ADD CONSTRAINT "KnowledgeReview_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoSync" ADD CONSTRAINT "RepoSync_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpServerConnection" ADD CONSTRAINT "McpServerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpServerConnection" ADD CONSTRAINT "McpServerConnection_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthState" ADD CONSTRAINT "McpOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthState" ADD CONSTRAINT "McpOAuthState_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
