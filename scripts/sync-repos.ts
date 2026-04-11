/**
 * Periodic repo sync script.
 * Run on cron (e.g. every 10 minutes): npx tsx scripts/sync-repos.ts
 *
 * Pulls latest changes for all active repositories and updates lastPulledAt.
 * Repos are made read-only after each pull.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { syncRepo } from '../src/lib/repo-manager';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.error('[sync] GITLAB_TOKEN not set');
    process.exit(1);
  }

  const repos = await prisma.repository.findMany({
    where: { active: true },
  });

  console.log(`[sync] Found ${repos.length} active repos to sync`);

  for (const repo of repos) {
    try {
      console.log(`[sync] Syncing ${repo.name} (${repo.gitlabProjectId})...`);

      await syncRepo({
        localPath: repo.localPath,
        branch: repo.defaultBranch,
        token,
        gitlabUrl: repo.gitlabUrl,
      });

      await prisma.repository.update({
        where: { id: repo.id },
        data: { lastPulledAt: new Date() },
      });

      console.log(`[sync] ${repo.name} synced successfully`);
    } catch (err) {
      console.error(`[sync] Failed to sync ${repo.name}:`, (err as Error).message);
    }
  }

  console.log('[sync] Done');
}

main()
  .catch((err) => {
    console.error('[sync] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
