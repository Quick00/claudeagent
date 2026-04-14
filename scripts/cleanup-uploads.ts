import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { unlink, readdir, stat, rmdir } from 'fs/promises';
import path from 'path';

function isFsError(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

const RETENTION_DAYS = 14;
const ORPHAN_GRACE_MINUTES = 5;
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    // --- Phase 1: Remove old attachments (by retention policy) ---
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const oldAttachments = await prisma.attachment.findMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (oldAttachments.length === 0) {
      console.log('No attachments older than %d days found.', RETENTION_DAYS);
    } else {
      console.log('Found %d attachment(s) older than %d days.', oldAttachments.length, RETENTION_DAYS);

      let filesDeleted = 0;
      let fileErrors = 0;

      for (const attachment of oldAttachments) {
        try {
          await unlink(attachment.storagePath);
          filesDeleted++;
        } catch (err) {
          if (isFsError(err, 'ENOENT')) {
            fileErrors++;
            console.warn('  Could not delete file: %s (already gone)', attachment.storagePath);
          } else {
            fileErrors++;
            console.error('  Failed to delete file: %s', attachment.storagePath, err);
          }
        }
      }

      const result = await prisma.attachment.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });

      console.log(
        'Retention cleanup done. Files removed: %d, file errors: %d, DB records deleted: %d',
        filesDeleted,
        fileErrors,
        result.count,
      );
    }

    // --- Phase 2: Remove orphaned files not tracked in the database ---
    const uploadRoot = path.resolve(UPLOAD_PATH);
    const knownPaths = new Set(
      (await prisma.attachment.findMany({ select: { storagePath: true } }))
        .map((a) => path.resolve(a.storagePath)),
    );

    let orphansDeleted = 0;
    let orphanErrors = 0;
    const graceThreshold = Date.now() - ORPHAN_GRACE_MINUTES * 60_000;

    // Upload dir uses per-conversation subdirectories (uploads/<convId>/filename)
    let topNames: string[];
    try {
      topNames = await readdir(uploadRoot);
    } catch (err) {
      if (isFsError(err, 'ENOENT')) {
        console.log('Upload directory %s does not exist, skipping orphan cleanup.', uploadRoot);
        return;
      }
      throw err;
    }

    for (const name of topNames) {
      const entryPath = path.join(uploadRoot, name);
      const entryStat = await stat(entryPath).catch((err) => {
        if (isFsError(err, 'ENOENT')) return null;
        throw err;
      });
      if (!entryStat) continue;

      if (entryStat.isDirectory()) {
        let subNames: string[];
        try {
          subNames = await readdir(entryPath);
        } catch (err) {
          if (isFsError(err, 'ENOENT')) continue;
          throw err;
        }
        for (const subName of subNames) {
          const filePath = path.join(entryPath, subName);
          const fileStat = await stat(filePath).catch((err) => {
            if (isFsError(err, 'ENOENT')) return null;
            throw err;
          });
          if (!fileStat?.isFile()) continue;
          if (fileStat.mtimeMs > graceThreshold) continue; // skip recent files (may be in-flight uploads)
          if (!knownPaths.has(filePath)) {
            try {
              await unlink(filePath);
              orphansDeleted++;
              console.log('  Removed orphan: %s', filePath);
            } catch (err) {
              if (isFsError(err, 'ENOENT')) {
                // Already gone — not a real error
              } else {
                orphanErrors++;
                console.error('  Failed to remove orphan: %s', filePath, err);
              }
            }
          }
        }
        // Remove the subdirectory if now empty
        try {
          const remaining = await readdir(entryPath);
          if (remaining.length === 0) {
            await rmdir(entryPath);
            console.log('  Removed empty dir: %s', entryPath);
          }
        } catch (err) {
          if (isFsError(err, 'ENOENT') || isFsError(err, 'ENOTEMPTY')) {
            // Already gone or not empty — fine
          } else {
            console.error('  Failed to clean up dir: %s', entryPath, err);
          }
        }
      } else if (entryStat.isFile()) {
        if (entryStat.mtimeMs > graceThreshold) continue; // skip recent files
        if (!knownPaths.has(entryPath)) {
          try {
            await unlink(entryPath);
            orphansDeleted++;
            console.log('  Removed orphan: %s', entryPath);
          } catch (err) {
            if (isFsError(err, 'ENOENT')) {
              // Already gone — not a real error
            } else {
              orphanErrors++;
              console.error('  Failed to remove orphan: %s', entryPath, err);
            }
          }
        }
      }
    }

    if (orphansDeleted > 0 || orphanErrors > 0) {
      console.log('Orphan cleanup done. Removed: %d, errors: %d', orphansDeleted, orphanErrors);
    } else {
      console.log('No orphaned files found.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
