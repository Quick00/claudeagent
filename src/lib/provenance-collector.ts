import path from 'path';
import { config } from '@/lib/config';

export interface RepoRef {
  gitlabProjectId: number;
  localPath: string;
}

export interface CapturedPath {
  gitlabProjectId: number;
  relativePath: string;
}

interface RunState {
  repos: RepoRef[];
  reads: CapturedPath[];
  windowStart: number;
  startedAt: number;
}

const MAX_RUN_AGE_MS = 60 * 60 * 1000;

/** Paths that change constantly and carry no product knowledge (translations, lockfiles, vendored code). */
export function isIgnoredPath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  const basename = parts[parts.length - 1];
  if (config.knowledgeIgnoreBasenames.includes(basename)) return true;
  if (basename.toUpperCase().startsWith('CHANGELOG')) return true;
  return parts.slice(0, -1).some((segment) => config.knowledgeIgnoreSegments.includes(segment.toLowerCase()));
}

/** Map an absolute path to (gitlabProjectId, repo-relative forward-slash path), or null if outside every repo. */
export function toRepoRelative(absPath: string, repos: RepoRef[]): CapturedPath | null {
  const resolved = path.resolve(absPath);
  for (const repo of repos) {
    const root = path.resolve(repo.localPath);
    if (resolved.startsWith(root + path.sep)) {
      return {
        gitlabProjectId: repo.gitlabProjectId,
        relativePath: path.relative(root, resolved).split(path.sep).join('/'),
      };
    }
  }
  return null;
}

/**
 * Claude may pass `based_on` hints. They can only NARROW the observed set
 * (intersection by equality or path suffix); if nothing matches the hint is ignored.
 */
export function narrowByBasedOn(paths: CapturedPath[], basedOn?: string[]): CapturedPath[] {
  if (!basedOn || basedOn.length === 0) return paths;
  const hints = basedOn.map((h) => h.replace(/\\/g, '/').replace(/^\.\//, ''));
  const narrowed = paths.filter((p) =>
    hints.some((h) => p.relativePath === h || p.relativePath.endsWith('/' + h) || h.endsWith('/' + p.relativePath)),
  );
  return narrowed.length > 0 ? narrowed : paths;
}

/**
 * Records which repository files Claude read during a run so knowledge saved
 * in that run can be attributed to them. Keyed by the user Message.id.
 */
export class ProvenanceCollector {
  private runs = new Map<string, RunState>();

  start(key: string, repos: RepoRef[]): void {
    this.sweep();
    this.runs.set(key, { repos, reads: [], windowStart: 0, startedAt: Date.now() });
  }

  recordToolUse(key: string, toolName: string, input: Record<string, unknown>): void {
    const run = this.runs.get(key);
    if (!run || toolName !== 'Read') return;
    const filePath = input.file_path;
    if (typeof filePath !== 'string') return;
    const captured = toRepoRelative(filePath, run.repos);
    if (!captured || isIgnoredPath(captured.relativePath)) return;
    run.reads.push(captured);
  }

  /**
   * Reads since the last markSave, deduped, most-recent-first capped.
   *
   * There is deliberately no "fall back to the whole run" rule: before the first
   * save `windowStart` is 0, so the window already *is* the whole run, and after
   * a save an empty window honestly means "nothing was read since". Re-attaching
   * the run would give every later save the same sources — exactly the
   * over-attribution windowing exists to prevent.
   */
  snapshot(key: string): CapturedPath[] {
    const run = this.runs.get(key);
    if (!run) return [];
    const window = run.reads.slice(run.windowStart);

    const seen = new Set<string>();
    const result: CapturedPath[] = [];
    for (let i = window.length - 1; i >= 0; i--) {
      const item = window[i];
      const id = `${item.gitlabProjectId}:${item.relativePath}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.unshift(item);
      if (result.length >= config.knowledgeMaxSourcesPerSave) break;
    }
    return result;
  }

  /** Consume the window. Call only when a save actually wrote something. */
  markSave(key: string): void {
    const run = this.runs.get(key);
    if (run) run.windowStart = run.reads.length;
  }

  end(key: string): void {
    this.runs.delete(key);
  }

  has(key: string): boolean {
    return this.runs.has(key);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, run] of this.runs) {
      if (now - run.startedAt > MAX_RUN_AGE_MS) this.runs.delete(key);
    }
  }
}

// Shared across route modules the same way prisma.ts shares its client.
const globalForCollector = globalThis as unknown as { provenanceCollector?: ProvenanceCollector };
export const provenanceCollector: ProvenanceCollector =
  globalForCollector.provenanceCollector ?? (globalForCollector.provenanceCollector = new ProvenanceCollector());
