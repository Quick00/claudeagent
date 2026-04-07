import { exec } from 'child_process';

let pullInProgress = false;

export type PullResult =
  | { success: true; output: string }
  | { success: false; error: string };

export function isPullInProgress(): boolean {
  return pullInProgress;
}

export function execGitPull(repoPath: string): Promise<PullResult> {
  if (pullInProgress) {
    return Promise.resolve({ success: false, error: 'Pull already in progress' });
  }

  pullInProgress = true;

  return new Promise((resolve) => {
    exec('git pull', { cwd: repoPath }, (error, stdout, _stderr) => {
      pullInProgress = false;
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
}
