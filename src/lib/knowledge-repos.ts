import { prisma } from '@/lib/prisma';
import { getHeadTree, type HeadTree } from '@/lib/repo-tree';

/** HEAD trees of every active repository, keyed by gitlabProjectId. Repos whose clone is unreadable are skipped. */
export async function loadActiveHeadTrees(): Promise<Map<number, HeadTree>> {
  const repos = await prisma.repository.findMany({
    where: { active: true },
    select: { gitlabProjectId: true, localPath: true, name: true },
  });

  const trees = new Map<number, HeadTree>();
  for (const repo of repos) {
    try {
      trees.set(repo.gitlabProjectId, getHeadTree(repo.localPath));
    } catch (err) {
      console.error(`[knowledge] Cannot read HEAD tree for ${repo.name}:`, (err as Error).message);
    }
  }
  return trees;
}
