import { execFileSync } from 'child_process';
import { parseLsTree, getHeadTree, getHeadSha, clearHeadTreeCache } from '@/lib/repo-tree';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const mockExec = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('parseLsTree', () => {
  it('maps NUL-separated ls-tree -z output to path → blob sha', () => {
    const out =
      '100644 blob aaaa\tapp/Models/Event.php\0' +
      '100755 blob bbbb\tbin/run with space.sh\0' +
      '040000 tree cccc\tsome/dir\0';
    const blobs = parseLsTree(out);
    expect(blobs.get('app/Models/Event.php')).toBe('aaaa');
    expect(blobs.get('bin/run with space.sh')).toBe('bbbb');
    expect(blobs.has('some/dir')).toBe(false);
    expect(blobs.size).toBe(2);
  });

  it('returns an empty map for empty output', () => {
    expect(parseLsTree('').size).toBe(0);
  });
});

describe('getHeadTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHeadTreeCache();
  });

  function stubGit(sha: string, lsTree: string) {
    mockExec.mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'rev-parse') return Buffer.from(`${sha}\n`);
      if (a[0] === 'ls-tree') return Buffer.from(lsTree);
      throw new Error(`unexpected git args ${a.join(' ')}`);
    });
  }

  it('runs rev-parse and ls-tree once and caches by localPath', () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    const first = getHeadTree('/repos/1');
    const second = getHeadTree('/repos/1');
    expect(first.commitSha).toBe('sha1');
    expect(first.blobs.get('a.txt')).toBe('aaaa');
    expect(second).toBe(first);
    const lsTreeCalls = mockExec.mock.calls.filter((c) => (c[1] as string[])[0] === 'ls-tree');
    expect(lsTreeCalls).toHaveLength(1);
  });

  it('re-reads the tree when HEAD changes', () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    getHeadTree('/repos/1');
    stubGit('sha2', '100644 blob bbbb\ta.txt\0');
    const tree = getHeadTree('/repos/1');
    expect(tree.commitSha).toBe('sha2');
    expect(tree.blobs.get('a.txt')).toBe('bbbb');
  });

  it('getHeadSha trims the trailing newline', () => {
    stubGit('abc123', '');
    expect(getHeadSha('/repos/1')).toBe('abc123');
  });
});
