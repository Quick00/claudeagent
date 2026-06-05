/**
 * Periodic repo sync script.
 * Production: npx tsx scripts/sync-repos.ts
 * Development: npx tsx scripts/sync-repos.ts --env-local
 *
 * Pulls latest changes for all active repositories and updates lastPulledAt.
 * Repos are made read-only after each pull.
 */

import { config as loadEnv } from 'dotenv';
if (process.argv.includes('--env-local')) {
  loadEnv({ path: '.env.local' });
}

import * as Sentry from '@sentry/nextjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { syncRepo } from '../src/lib/repo-manager';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
});

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    console.error('[sync] GITLAB_TOKEN not set');
    Sentry.captureMessage('[sync] GITLAB_TOKEN not set', 'error');
    await Sentry.flush(2000);
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
      Sentry.captureException(err, {
        tags: { script: 'sync-repos' },
        extra: { repo: repo.name, gitlabProjectId: repo.gitlabProjectId },
      });
    }
  }

  console.log('[sync] Done');
}

main()
  .catch(async (err) => {
    console.error('[sync] Fatal error:', err);
    Sentry.captureException(err, { tags: { script: 'sync-repos' } });
    await Sentry.flush(2000);
    process.exit(1);
  })
  .finally(async () => {
    await Sentry.flush(2000);
    await prisma.$disconnect();
  });
