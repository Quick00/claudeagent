import { execFileSync } from 'child_process';
import type { PrismaClient } from '@prisma/client';

export interface ChangedFile {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  path: string;
  oldPath?: string;
}

export type RepoSyncDb = Pick<PrismaClient, 'knowledgeSource' | 'repoSync'>;

/** Parse `git diff --name-status -M -z`: `<status>\0<path>\0`, or `R<score>\0<old>\0<new>\0` for renames/copies. */
export function parseNameStatus(output: string): ChangedFile[] {
  const tokens = output.split('\0');
  const result: ChangedFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const raw = tokens[i++];
    if (!raw) continue;
    const status = raw[0] as ChangedFile['status'];
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      if (oldPath && path) result.push({ status, path, oldPath });
    } else {
      const path = tokens[i++];
      if (path) result.push({ status, path });
    }
  }
  return result;
}

export function diffCommits(localPath: string, fromSha: string, toSha: string): ChangedFile[] {
  if (!fromSha || !toSha || fromSha === toSha) return [];
  const output = execFileSync('git', ['diff', '--name-status', '-M', '-z', fromSha, toSha], {
    cwd: localPath,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  return parseNameStatus(output);
}

/**
 * Record a sync. Renamed files keep their provenance (path rewrite); nothing
 * else is mutated — freshness is computed from blob hashes at read time.
 * `wouldStaleCount` is the metric that decides whether automated
 * re-verification (phase 4) is worth building.
 */
export async function recordRepoSync(
  db: RepoSyncDb,
  repo: { id: string | null; gitlabProjectId: number },
  fromSha: string,
  toSha: string,
  changed: ChangedFile[],
  reason: string = 'sync',
): Promise<{ wouldStaleCount: number }> {
  for (const c of changed) {
    if (c.status === 'R' && c.oldPath) {
      await db.knowledgeSource.updateMany({
        where: { gitlabProjectId: repo.gitlabProjectId, path: c.oldPath },
        data: { path: c.path },
      });
    }
  }

  const affectedPaths = changed.filter((c) => c.status !== 'R').map((c) => c.path);
  const affected = affectedPaths.length > 0
    ? await db.knowledgeSource.findMany({
        where: { gitlabProjectId: repo.gitlabProjectId, path: { in: affectedPaths } },
        select: { entryId: true },
        distinct: ['entryId'],
      })
    : [];

  await db.repoSync.create({
    data: {
      repositoryId: repo.id,
      gitlabProjectId: repo.gitlabProjectId,
      fromSha,
      toSha,
      changedFiles: changed.map((c) => c.path),
      reason,
      wouldStaleCount: affected.length,
    },
  });

  return { wouldStaleCount: affected.length };
}
