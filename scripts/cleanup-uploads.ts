import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { unlink } from 'fs/promises';

const RETENTION_DAYS = 14;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const oldAttachments = await prisma.attachment.findMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (oldAttachments.length === 0) {
      console.log('No attachments older than %d days found.', RETENTION_DAYS);
      return;
    }

    console.log('Found %d attachment(s) older than %d days.', oldAttachments.length, RETENTION_DAYS);

    let filesDeleted = 0;
    let fileErrors = 0;

    for (const attachment of oldAttachments) {
      try {
        await unlink(attachment.storagePath);
        filesDeleted++;
      } catch {
        fileErrors++;
        console.warn('  Could not delete file: %s (may already be gone)', attachment.storagePath);
      }
    }

    const result = await prisma.attachment.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    console.log(
      'Done. Files removed: %d, file errors: %d, DB records deleted: %d',
      filesDeleted,
      fileErrors,
      result.count,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
