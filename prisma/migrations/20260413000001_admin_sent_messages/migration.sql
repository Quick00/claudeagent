-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "seenByOwner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sentByAdminId" TEXT;

-- CreateIndex
CREATE INDEX "Message_sentByAdminId_idx" ON "Message"("sentByAdminId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentByAdminId_fkey" FOREIGN KEY ("sentByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
