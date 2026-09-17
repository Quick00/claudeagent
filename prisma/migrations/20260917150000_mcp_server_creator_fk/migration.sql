/*
  Constrains McpServer.createdByUserId to User.id.

  Guarded the same way as 20260915121932_add_mcp_server_linking: deployments
  sync with `prisma db push --accept-data-loss` from docker-entrypoint.sh
  rather than `migrate deploy`, so the table and the constraint may already
  exist, and an unguarded ALTER recorded as a failed migration blocks every
  later deploy.

  The UPDATE runs first because the column was unconstrained until now: a
  database where a creator was deleted still holds their id, and ADD
  CONSTRAINT would fail 23503 on those rows.
*/
DO $$ BEGIN
  IF to_regclass('"McpServer"') IS NOT NULL THEN
    UPDATE "McpServer" SET "createdByUserId" = NULL
    WHERE "createdByUserId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "McpServer"."createdByUserId");
  END IF;
END $$;

-- AddForeignKey (idempotent: only add if not already present)
DO $$ BEGIN
  IF to_regclass('"McpServer"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpServer_createdByUserId_fkey') THEN
    ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
