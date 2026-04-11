import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getReposRoot(): string {
  return path.resolve(process.env.REPOS_DIR || './repos');
}

function assertWithinReposRoot(dirPath: string): void {
  const reposRoot = getReposRoot();
  const resolved = path.resolve(dirPath);
  if (!resolved.startsWith(reposRoot + path.sep) && resolved !== reposRoot) {
    throw new Error(`Path "${resolved}" is outside managed repos root "${reposRoot}"`);
  }
}

interface CloneOptions {
  gitlabUrl: string;
  localPath: string;
  branch: string;
  token: string;
}

interface SyncOptions {
  localPath: string;
  branch: string;
  token: string;
  gitlabUrl: string;
}

function injectToken(gitlabUrl: string, token: string): string {
  const url = new URL(gitlabUrl);
  url.username = 'oauth2';
  url.password = token;
  return url.toString();
}

/**
 * Clone a GitLab repo via HTTPS and immediately set it read-only.
 * The token is injected into the URL for authentication.
 * SECURITY: Repos are NEVER writable after clone completes.
 */
export async function cloneRepo({ gitlabUrl, localPath, branch, token }: CloneOptions): Promise<void> {
  const authedUrl = injectToken(gitlabUrl, token);

  execFileSync('git', ['clone', '--branch', branch, '--single-branch', authedUrl, localPath], {
    timeout: 300000,
    stdio: 'pipe',
  });

  makeReadOnly(localPath);
}

/**
 * Sync a cloned repo: make temporarily writable, fetch + reset, then lock down again.
 * SECURITY: Even if the process crashes mid-sync, the repo was read-only before
 * and will be re-locked on the next sync cycle.
 */
export async function syncRepo({ localPath, branch, token, gitlabUrl }: SyncOptions): Promise<void> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Repo path does not exist: ${localPath}`);
  }

  makeWritable(localPath);

  try {
    // Fetch using the authed URL directly — avoids persisting the token in .git/config
    const authedUrl = injectToken(gitlabUrl, token);
    execFileSync('git', ['fetch', authedUrl, branch], { cwd: localPath, timeout: 120000, stdio: 'pipe' });
    execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: localPath, stdio: 'pipe' });
  } finally {
    makeReadOnly(localPath);
  }
}

export function makeReadOnly(dirPath: string): void {
  assertWithinReposRoot(dirPath);
  execFileSync('chmod', ['-R', 'a-w', dirPath], { stdio: 'pipe' });
}

export function makeWritable(dirPath: string): void {
  assertWithinReposRoot(dirPath);
  execFileSync('chmod', ['-R', 'u+w', dirPath], { stdio: 'pipe' });
}

export async function removeRepo(localPath: string): Promise<void> {
  assertWithinReposRoot(localPath);
  if (!fs.existsSync(localPath)) return;
  makeWritable(localPath);
  fs.rmSync(localPath, { recursive: true, force: true });
}
