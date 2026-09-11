import { computeFreshness } from '@/lib/knowledge-freshness';
import type { HeadTree } from '@/lib/repo-tree';

function tree(commitSha: string, entries: Record<string, string>): HeadTree {
  return { commitSha, blobs: new Map(Object.entries(entries)) };
}

const trees = new Map<number, HeadTree>([
  [1, tree('c1', { 'a.php': 'blobA', 'b.php': 'blobB' })],
]);

describe('computeFreshness', () => {
  it('pinned entries are always fresh, even with no sources', () => {
    expect(computeFreshness({ kind: 'pinned' }, [], trees)).toEqual({ state: 'fresh' });
  });

  it('derived entries with no sources are unverified', () => {
    expect(computeFreshness({ kind: 'derived' }, [], trees)).toEqual({ state: 'unverified' });
  });

  it('is fresh when every source blob matches HEAD', () => {
    const sources = [
      { gitlabProjectId: 1, path: 'a.php', blobSha: 'blobA' },
      { gitlabProjectId: 1, path: 'b.php', blobSha: 'blobB' },
    ];
    expect(computeFreshness({ kind: 'derived' }, sources, trees)).toEqual({ state: 'fresh' });
  });

  it('is stale and lists only the changed paths', () => {
    const sources = [
      { gitlabProjectId: 1, path: 'a.php', blobSha: 'old' },
      { gitlabProjectId: 1, path: 'b.php', blobSha: 'blobB' },
    ];
    expect(computeFreshness({ kind: 'derived' }, sources, trees)).toEqual({
      state: 'stale',
      changedPaths: ['a.php'],
    });
  });

  it('treats a path missing from HEAD as changed', () => {
    const sources = [{ gitlabProjectId: 1, path: 'deleted.php', blobSha: 'x' }];
    expect(computeFreshness({ kind: 'derived' }, sources, trees)).toEqual({
      state: 'stale',
      changedPaths: ['deleted.php'],
    });
  });

  it('treats a project with no tree (repo removed) as changed', () => {
    const sources = [{ gitlabProjectId: 99, path: 'a.php', blobSha: 'blobA' }];
    expect(computeFreshness({ kind: 'derived' }, sources, trees)).toEqual({
      state: 'stale',
      changedPaths: ['a.php'],
    });
  });
});
