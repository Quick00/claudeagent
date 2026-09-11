import { execFileSync } from 'child_process';

export interface HeadTree {
  commitSha: string;
  blobs: Map<string, string>;
}

const cache = new Map<string, HeadTree>();

/** Parse `git ls-tree -r -z HEAD` output: `<mode> <type> <sha>\t<path>\0` per entry. */
export function parseLsTree(output: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const entry of output.split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const [, type, sha] = entry.slice(0, tab).split(' ');
    if (type !== 'blob' || !sha) continue;
    blobs.set(entry.slice(tab + 1), sha);
  }
  return blobs;
}

export function getHeadSha(localPath: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localPath, stdio: 'pipe' })
    .toString()
    .trim();
}

/**
 * Return the blob hash of every file at HEAD. Cached per repo path and
 * refreshed only when `rev-parse HEAD` returns a different commit, so the
 * (comparatively expensive) `ls-tree` runs once per sync per repo.
 */
export function getHeadTree(localPath: string): HeadTree {
  const commitSha = getHeadSha(localPath);
  const cached = cache.get(localPath);
  if (cached && cached.commitSha === commitSha) return cached;

  const output = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], {
    cwd: localPath,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  }).toString();

  const tree: HeadTree = { commitSha, blobs: parseLsTree(output) };
  cache.set(localPath, tree);
  return tree;
}

export function clearHeadTreeCache(): void {
  cache.clear();
}
