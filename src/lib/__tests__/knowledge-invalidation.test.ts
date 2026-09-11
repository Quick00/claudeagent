import { execFileSync } from 'child_process';
import { parseNameStatus, diffCommits, recordRepoSync } from '@/lib/knowledge-invalidation';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const mockExec = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('parseNameStatus', () => {
  it('parses -z output including renames with two paths', () => {
    const out = 'M\0app/a.php\0A\0app/new.php\0D\0app/old.php\0R100\0app/from.php\0app/to.php\0';
    expect(parseNameStatus(out)).toEqual([
      { status: 'M', path: 'app/a.php' },
      { status: 'A', path: 'app/new.php' },
      { status: 'D', path: 'app/old.php' },
      { status: 'R', path: 'app/to.php', oldPath: 'app/from.php' },
    ]);
  });
  it('returns [] for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('diffCommits', () => {
  beforeEach(() => jest.clearAllMocks());
  it('short-circuits when shas are equal', () => {
    expect(diffCommits('/r', 'a', 'a')).toEqual([]);
    expect(mockExec).not.toHaveBeenCalled();
  });
  it('runs git diff --name-status -M -z', () => {
    mockExec.mockReturnValue(Buffer.from('M\0x.php\0'));
    expect(diffCommits('/r', 'a', 'b')).toEqual([{ status: 'M', path: 'x.php' }]);
    expect(mockExec).toHaveBeenCalledWith('git', ['diff', '--name-status', '-M', '-z', 'a', 'b'], expect.objectContaining({ cwd: '/r' }));
  });
});

describe('recordRepoSync', () => {
  function db() {
    return {
      knowledgeSource: { updateMany: jest.fn(), findMany: jest.fn() },
      repoSync: { create: jest.fn() },
    };
  }

  it('rewrites renamed source paths, counts affected entries, and writes the RepoSync row', async () => {
    const d = db();
    d.knowledgeSource.findMany.mockResolvedValue([{ entryId: 'e1' }, { entryId: 'e2' }]);
    const changed = [
      { status: 'M' as const, path: 'app/a.php' },
      { status: 'R' as const, path: 'app/to.php', oldPath: 'app/from.php' },
      { status: 'D' as const, path: 'app/gone.php' },
    ];

    const result = await recordRepoSync(d as never, { id: 'repo-1', gitlabProjectId: 42 }, 'aaa', 'bbb', changed);

    expect(d.knowledgeSource.updateMany).toHaveBeenCalledWith({
      where: { gitlabProjectId: 42, path: 'app/from.php' },
      data: { path: 'app/to.php' },
    });
    expect(d.knowledgeSource.findMany).toHaveBeenCalledWith({
      where: { gitlabProjectId: 42, path: { in: ['app/a.php', 'app/gone.php'] } },
      select: { entryId: true },
      distinct: ['entryId'],
    });
    expect(d.repoSync.create).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repo-1',
        gitlabProjectId: 42,
        fromSha: 'aaa',
        toSha: 'bbb',
        changedFiles: ['app/a.php', 'app/from.php -> app/to.php', 'app/gone.php'],
        reason: 'sync',
        wouldStaleCount: 2,
      },
    });
    expect(result).toEqual({ wouldStaleCount: 2 });
  });

  it('skips the source query when nothing changed at all', async () => {
    const d = db();
    await recordRepoSync(d as never, { id: null, gitlabProjectId: 1 }, 'a', 'b', [], 'removed');
    expect(d.knowledgeSource.findMany).not.toHaveBeenCalled();
    expect(d.repoSync.create).toHaveBeenCalledWith({ data: expect.objectContaining({ repositoryId: null, reason: 'removed', wouldStaleCount: 0 }) });
  });

  it('excludes renames from wouldStaleCount — the file moved, its content did not', async () => {
    const d = db();
    const changed = [{ status: 'R' as const, path: 'app/to.php', oldPath: 'app/from.php' }];

    const result = await recordRepoSync(d as never, { id: 'repo-1', gitlabProjectId: 42 }, 'aaa', 'bbb', changed);

    expect(d.knowledgeSource.updateMany).toHaveBeenCalledTimes(1);
    expect(d.knowledgeSource.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ wouldStaleCount: 0 });
    expect(d.repoSync.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedFiles: ['app/from.php -> app/to.php'],
        wouldStaleCount: 0,
      }),
    });
  });
});
