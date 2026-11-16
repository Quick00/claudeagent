/*
  Marks attachments Claude generated with the create_file tool, with the
  Message.id of the turn that made them, so the turn can link them to its
  reply when it finishes.

  Guarded like 20261014120000_attachment_uploader: deployments sync with
  `prisma db push --accept-data-loss`, so the column and index may already exist.
*/
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "generatedForMessageId" TEXT;

CREATE INDEX IF NOT EXISTS "Attachment_generatedForMessageId_idx" ON "Attachment"("generatedForMessageId");
