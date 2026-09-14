import { prisma } from '@/lib/prisma';
import { getHeadTree, type HeadTree } from '@/lib/repo-tree';

/** HEAD trees of every active repository, keyed by gitlabProjectId. Repos whose clone is unreadable are skipped. */
export async function loadActiveHeadTrees(): Promise<Map<number, HeadTree>> {
  const repos = await prisma.repository.findMany({
    where: { active: true },
    select: { gitlabProjectId: true, localPath: true, name: true },
  });

  const trees = new Map<number, HeadTree>();
  await Promise.all(
    repos.map(async (repo) => {
      try {
        trees.set(repo.gitlabProjectId, await getHeadTree(repo.localPath));
      } catch (err) {
        console.error(`[knowledge] Cannot read HEAD tree for ${repo.name}:`, (err as Error).message);
      }
    }),
  );
  return trees;
}
