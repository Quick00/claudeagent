import { execFile } from 'child_process';

export interface HeadTree {
  commitSha: string;
  blobs: Map<string, string>;
}

const cache = new Map<string, HeadTree>();
/** In-flight `ls-tree` reads, keyed by repo+commit, so a cache miss spawns one git per repo. */
const inFlight = new Map<string, Promise<HeadTree>>();

/**
 * Run git with an argument array (never a shell string, never an interpolated
 * path) and resolve its stdout. Async on purpose: these run on the chat request
 * path, and `execFileSync` would block the event loop for every other user.
 */
function runGit(args: string[], cwd: string, maxBuffer: number = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer, encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

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

export function getHeadSha(localPath: string): Promise<string> {
  return runGit(['rev-parse', 'HEAD'], localPath).then((out) => out.trim());
}

/**
 * Return the blob hash of every file at HEAD. Cached per repo path and
 * refreshed only when `rev-parse HEAD` returns a different commit, so the
 * (comparatively expensive) `ls-tree` runs once per sync per repo.
 */
export async function getHeadTree(localPath: string): Promise<HeadTree> {
  const commitSha = await getHeadSha(localPath);
  const cached = cache.get(localPath);
  if (cached && cached.commitSha === commitSha) return cached;

  const key = `${localPath}\0${commitSha}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const load = runGit(['ls-tree', '-r', '-z', 'HEAD'], localPath, 64 * 1024 * 1024)
    .then((output) => {
      const tree: HeadTree = { commitSha, blobs: parseLsTree(output) };
      cache.set(localPath, tree);
      return tree;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, load);
  return load;
}

/** Test seam: drops the memoised trees so a test can re-stub git. */
export function clearHeadTreeCache(): void {
  cache.clear();
  inFlight.clear();
}
