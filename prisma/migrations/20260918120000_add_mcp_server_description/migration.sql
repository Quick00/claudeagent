/*
  IF NOT EXISTS because a database that predates `migrate deploy` was synced
  with `prisma db push` and may already carry the column; an unguarded ALTER
  recorded as a failed migration blocks every later deploy.
*/
DO $$ BEGIN
  IF to_regclass('"McpServer"') IS NOT NULL THEN
    ALTER TABLE "McpServer" ADD COLUMN IF NOT EXISTS "description" TEXT;
  END IF;
END $$;
