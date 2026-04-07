import { execGitPull, isPullInProgress } from '@/lib/git-pull';
import { exec } from 'child_process';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

describe('execGitPull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs git pull on the given repo path', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, 'Already up to date.\n', '');
    });

    const result = await execGitPull('/repo');

    expect(mockExec).toHaveBeenCalledWith(
      'git pull',
      { cwd: '/repo' },
      expect.any(Function)
    );
    expect(result).toEqual({ success: true, output: 'Already up to date.\n' });
  });

  it('returns error when git pull fails', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('merge conflict'), '', 'error output');
    });

    const result = await execGitPull('/repo');

    expect(result).toEqual({ success: false, error: 'merge conflict' });
  });

  it('rejects concurrent pulls', async () => {
    let resolveFirst: Function;
    mockExec.mockImplementationOnce((_cmd: string, _opts: unknown, cb: Function) => {
      resolveFirst = () => cb(null, 'done', '');
    });

    const first = execGitPull('/repo');
    expect(isPullInProgress()).toBe(true);

    const second = await execGitPull('/repo');
    expect(second).toEqual({ success: false, error: 'Pull already in progress' });

    resolveFirst!();
    await first;
    expect(isPullInProgress()).toBe(false);
  });
});
