import { cloneRepo, syncRepo } from '@/lib/repo-manager';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe('repo-manager', () => {
  const tmpDir = path.join(os.tmpdir(), 'repo-manager-test');

  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('cloneRepo', () => {
    it('clones via HTTPS with token and sets read-only', async () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      await cloneRepo({
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
        localPath: path.join(tmpDir, 'myrepo'),
        branch: 'main',
        token: 'glpat-abc123',
      });

      // First call: git clone (uses execFileSync array form — no shell injection)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['clone', '--branch', 'main', '--single-branch']),
        expect.objectContaining({ timeout: 300000 }),
      );
      const cloneArgs = mockExecFileSync.mock.calls[0][1] as string[];
      const authedUrl = cloneArgs.find((a) => a.includes('oauth2:'));
      expect(authedUrl).toContain('oauth2:glpat-abc123@gitlab.com');

      // Last call: chmod read-only
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'chmod',
        ['-R', 'a-w', expect.stringContaining('myrepo')],
        expect.anything(),
      );
    });
  });

  describe('syncRepo', () => {
    it('makes writable, pulls, then makes read-only again', async () => {
      const repoPath = path.join(tmpDir, 'myrepo');
      fs.mkdirSync(repoPath, { recursive: true });
      mockExecFileSync.mockReturnValue(Buffer.from('Already up to date.'));

      await syncRepo({
        localPath: repoPath,
        branch: 'main',
        token: 'glpat-abc123',
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
      });

      const calls = mockExecFileSync.mock.calls;
      // chmod u+w (make writable)
      expect(calls[0][0]).toBe('chmod');
      expect(calls[0][1]).toEqual(['-R', 'u+w', repoPath]);
      // git fetch with authed URL (no set-url — avoids persisting token in .git/config)
      expect(calls[1][0]).toBe('git');
      expect(calls[1][1]).toEqual(expect.arrayContaining(['fetch']));
      const fetchArgs = calls[1][1] as string[];
      expect(fetchArgs.some((a: string) => a.includes('oauth2:'))).toBe(true);
      expect(fetchArgs).toContain('main');
      // git reset --hard FETCH_HEAD
      expect(calls[2][0]).toBe('git');
      expect(calls[2][1]).toEqual(expect.arrayContaining(['reset', '--hard', 'FETCH_HEAD']));
      // chmod a-w (make read-only)
      expect(calls[3][0]).toBe('chmod');
      expect(calls[3][1]).toEqual(['-R', 'a-w', repoPath]);
    });
  });
});
