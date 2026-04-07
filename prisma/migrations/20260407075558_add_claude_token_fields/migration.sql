-- AlterTable
ALTER TABLE "User" ADD COLUMN "claudeEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "claudeRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "claudeToken" TEXT;
ALTER TABLE "User" ADD COLUMN "claudeTokenExpiresAt" DATETIME;
