/*
  Records who uploaded each Attachment, so an upload not yet linked to a
  message can only be opened or attached by its uploader (or an admin).

  Guarded like 20260917150000_mcp_server_creator_fk: deployments sync with
  `prisma db push --accept-data-loss`, so the column, index and constraint may
  already exist. Existing rows stay NULL: the uploader was never recorded.
*/
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "uploadedById" TEXT;

CREATE INDEX IF NOT EXISTS "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attachment_uploadedById_fkey') THEN
    ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
