import type { HeadTree } from '@/lib/repo-tree';

export type Freshness =
  | { state: 'fresh' }
  | { state: 'stale'; changedPaths: string[] }
  | { state: 'unverified' };

export interface SourceLike {
  gitlabProjectId: number;
  path: string;
  blobSha: string;
}

/**
 * Freshness is never stored. It is derived by comparing each source's
 * recorded blob hash with the blob at the repository's current HEAD.
 * Pinned entries are human-owned policy and never go stale.
 */
export function computeFreshness(
  entry: { kind: string },
  sources: SourceLike[],
  headTrees: Map<number, HeadTree>,
): Freshness {
  if (entry.kind === 'pinned') return { state: 'fresh' };
  if (sources.length === 0) return { state: 'unverified' };

  const changedPaths: string[] = [];
  for (const source of sources) {
    const current = headTrees.get(source.gitlabProjectId)?.blobs.get(source.path);
    if (current !== source.blobSha) changedPaths.push(source.path);
  }

  return changedPaths.length > 0 ? { state: 'stale', changedPaths } : { state: 'fresh' };
}
