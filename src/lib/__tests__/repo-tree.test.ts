import { execFile } from 'child_process';
import { parseLsTree, getHeadTree, getHeadSha, clearHeadTreeCache } from '@/lib/repo-tree';

jest.mock('child_process', () => ({ execFile: jest.fn() }));

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;
const mockExec = execFile as unknown as jest.Mock;

/** Stub a single `git` invocation: resolve stdout for args, or reject. */
function onGit(handler: (args: string[]) => string) {
  mockExec.mockImplementation((_cmd: string, args: string[], _opts: object, cb: ExecCallback) => {
    try {
      cb(null, handler(args), '');
    } catch (err) {
      cb(err as Error, '', '');
    }
  });
}

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
    onGit((a) => {
      if (a[0] === 'rev-parse') return `${sha}\n`;
      if (a[0] === 'ls-tree') return lsTree;
      throw new Error(`unexpected git args ${a.join(' ')}`);
    });
  }

  it('runs rev-parse and ls-tree once and caches by localPath', async () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    const first = await getHeadTree('/repos/1');
    const second = await getHeadTree('/repos/1');
    expect(first.commitSha).toBe('sha1');
    expect(first.blobs.get('a.txt')).toBe('aaaa');
    expect(second).toBe(first);
    const lsTreeCalls = mockExec.mock.calls.filter((c) => (c[1] as string[])[0] === 'ls-tree');
    expect(lsTreeCalls).toHaveLength(1);
  });

  it('re-reads the tree when HEAD changes', async () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    await getHeadTree('/repos/1');
    stubGit('sha2', '100644 blob bbbb\ta.txt\0');
    const tree = await getHeadTree('/repos/1');
    expect(tree.commitSha).toBe('sha2');
    expect(tree.blobs.get('a.txt')).toBe('bbbb');
  });

  it('getHeadSha trims the trailing newline', async () => {
    stubGit('abc123', '');
    await expect(getHeadSha('/repos/1')).resolves.toBe('abc123');
  });

  it('never spawns git through a shell and always passes an argument array', async () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    await getHeadTree('/repos/1');
    for (const call of mockExec.mock.calls) {
      expect(call[0]).toBe('git');
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).not.toHaveProperty('shell');
    }
  });

  it('collapses concurrent cache misses into a single ls-tree', async () => {
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    const [a, b, c] = await Promise.all([
      getHeadTree('/repos/1'),
      getHeadTree('/repos/1'),
      getHeadTree('/repos/1'),
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    const lsTreeCalls = mockExec.mock.calls.filter((call) => (call[1] as string[])[0] === 'ls-tree');
    expect(lsTreeCalls).toHaveLength(1);
  });

  it('propagates a git failure and does not cache it', async () => {
    onGit(() => {
      throw new Error('not a git repository');
    });
    await expect(getHeadTree('/repos/gone')).rejects.toThrow('not a git repository');
    stubGit('sha1', '100644 blob aaaa\ta.txt\0');
    await expect(getHeadTree('/repos/gone')).resolves.toMatchObject({ commitSha: 'sha1' });
  });
});
