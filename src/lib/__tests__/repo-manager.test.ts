import { cloneRepo, makeReadOnly, makeWritable, syncRepo } from '@/lib/repo-manager';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

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
      mockExecSync.mockReturnValue(Buffer.from(''));

      await cloneRepo({
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
        localPath: path.join(tmpDir, 'myrepo'),
        branch: 'main',
        token: 'glpat-abc123',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git clone --branch main --single-branch'),
        expect.objectContaining({ timeout: 300000 }),
      );
      const cloneCall = mockExecSync.mock.calls[0][0] as string;
      expect(cloneCall).toContain('oauth2:glpat-abc123@gitlab.com');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('chmod -R a-w'),
        expect.anything(),
      );
    });
  });

  describe('syncRepo', () => {
    it('makes writable, pulls, then makes read-only again', async () => {
      const repoPath = path.join(tmpDir, 'myrepo');
      fs.mkdirSync(repoPath, { recursive: true });
      mockExecSync.mockReturnValue(Buffer.from('Already up to date.'));

      await syncRepo({
        localPath: repoPath,
        branch: 'main',
        token: 'glpat-abc123',
        gitlabUrl: 'https://gitlab.com/mygroup/myrepo.git',
      });

      const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
      expect(calls[0]).toContain('chmod -R u+w');
      expect(calls[1]).toContain('git remote set-url');
      expect(calls[2]).toContain('git fetch');
      expect(calls[3]).toContain('git reset --hard origin/main');
      expect(calls[4]).toContain('chmod -R a-w');
    });
  });
});
