import { execSync } from 'child_process';
import fs from 'fs';

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

/**
 * Clone a GitLab repo via HTTPS and immediately set it read-only.
 * The token is injected into the URL for authentication.
 * SECURITY: Repos are NEVER writable after clone completes.
 */
export async function cloneRepo({ gitlabUrl, localPath, branch, token }: CloneOptions): Promise<void> {
  const authedUrl = gitlabUrl.replace('https://gitlab.com/', `https://oauth2:${token}@gitlab.com/`);

  execSync(
    `git clone --branch ${branch} --single-branch ${authedUrl} ${localPath}`,
    { timeout: 300000, stdio: 'pipe' },
  );

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
    const authedUrl = gitlabUrl.replace('https://gitlab.com/', `https://oauth2:${token}@gitlab.com/`);
    execSync(`git remote set-url origin ${authedUrl}`, { cwd: localPath, stdio: 'pipe' });
    execSync(`git fetch origin ${branch}`, { cwd: localPath, timeout: 120000, stdio: 'pipe' });
    execSync(`git reset --hard origin/${branch}`, { cwd: localPath, stdio: 'pipe' });
  } finally {
    makeReadOnly(localPath);
  }
}

export function makeReadOnly(dirPath: string): void {
  execSync(`chmod -R a-w ${dirPath}`, { stdio: 'pipe' });
}

export function makeWritable(dirPath: string): void {
  execSync(`chmod -R u+w ${dirPath}`, { stdio: 'pipe' });
}

export async function removeRepo(localPath: string): Promise<void> {
  if (!fs.existsSync(localPath)) return;
  makeWritable(localPath);
  fs.rmSync(localPath, { recursive: true, force: true });
}
