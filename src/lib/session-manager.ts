import { spawn, ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, unlink, readdirSync, statSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { config } from '@/lib/config';
import { getUsableConnectionsForSession } from '@/lib/mcp-connections';

const PROJECT_ROOT = path.resolve(process.cwd());
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join('/tmp', 'claude-sessions');

interface DroppedServer {
  name: string;
  reason: string;
}

function cleanupConfigFile(configPath: string): void {
  unlink(configPath, () => {});
}

/**
 * How old an MCP config file must be before a sweep removes it. Comfortably
 * past the longest a session can live: a verification run is bounded at
 * twice `verificationTimeoutMs` (queue wait plus the run itself, 30 minutes
 * by default) and a chat turn at `claudeMaxTurns`. A file this old belongs
 * to no process on any instance.
 */
const STALE_MCP_CONFIG_MS = 60 * 60 * 1000;

/**
 * Removes config files older than `STALE_MCP_CONFIG_MS` from one user's
 * `mcp-config` directory. The files hold bearer tokens in plaintext and are
 * unlinked when their process ends — but a SIGKILL or a container restart
 * never runs that handler, and `SESSIONS_DIR` is a persistent volume in
 * production, so leftovers would otherwise stay on disk indefinitely.
 *
 * Age-gated rather than "everything": `SESSIONS_DIR` is a *shared* volume
 * (`claude-sessions` in docker-compose.yml), so a second replica or an
 * overlapping rolling restart would otherwise wipe files another instance
 * had just written for a request still waiting in its queue — fatal for
 * that spawn under `--strict-mcp-config`. A fresh file is left alone
 * whoever wrote it; files are written once and never modified, so mtime is
 * their age.
 */
function sweepStaleConfigFiles(configDir: string): void {
  let names: string[];
  try {
    names = readdirSync(configDir);
  } catch {
    // Nothing written for this user yet — or a stray file where the user
    // directory belongs (ENOTDIR). Either way there is nothing to sweep.
    return;
  }
  const cutoff = Date.now() - STALE_MCP_CONFIG_MS;
  for (const name of names) {
    const file = path.join(configDir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    } catch (err) {
      // Another instance may have just removed it; the rest still gets swept.
      console.warn(`[session-manager] Could not sweep MCP config file ${file}:`, (err as Error).message);
    }
  }
}

/**
 * Runs once at import, across every user directory, to catch what a
 * previous instance left behind. Not the only sweep: a file left by a crash
 * is younger than the threshold at the restart that follows, so
 * `buildMcpConfigFile` sweeps the user's own directory again each time it
 * writes there, and the leftover goes the next time that user starts a
 * session rather than surviving until some later restart.
 */
function sweepOrphanedConfigDirs(): void {
  try {
    for (const userDir of readdirSync(SESSIONS_DIR)) {
      sweepStaleConfigFiles(path.join(SESSIONS_DIR, userDir, 'mcp-config'));
    }
  } catch {
    // No SESSIONS_DIR yet — nothing has ever been written there.
  }
}

sweepOrphanedConfigDirs();

/**
 * Builds the per-user MCP config and writes it to a private file: the CLI's
 * argv is logged, and an inline `--mcp-config` JSON string would put every
 * connected server's bearer token into process logs and Sentry breadcrumbs.
 */
async function buildMcpConfigFile(
  userId: string,
  provenanceKey: string,
  verificationRunId?: string,
): Promise<{ configPath: string; droppedServers: DroppedServer[] }> {
  const { entries, dropped } = await getUsableConnectionsForSession(userId);

  const mcpServers: Record<string, unknown> = {
    knowledge: {
      command: 'node',
      args: [path.join(PROJECT_ROOT, 'src/mcp/knowledge-server.mjs')],
      env: {
        KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
        KNOWLEDGE_SEARCH_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge/search`,
        KNOWLEDGE_VERIFY_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge/verify-result`,
        KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
        PROVENANCE_KEY: provenanceKey,
        VERIFICATION_RUN_ID: verificationRunId || '',
      },
    },
  };
  for (const entry of entries) {
    mcpServers[entry.name] = {
      type: entry.transport.toLowerCase(),
      url: entry.url,
      headers: { Authorization: `Bearer ${entry.accessToken}` },
    };
  }

  const configDir = path.join(SESSIONS_DIR, userId, 'mcp-config');
  mkdirSync(configDir, { recursive: true });
  sweepStaleConfigFiles(configDir);
  const configPath = path.join(configDir, `${randomUUID()}.json`);
  writeFileSync(configPath, JSON.stringify({ mcpServers }), { mode: 0o600 });

  return { configPath, droppedServers: dropped };
}

interface QueuedRequest {
  resolve: (proc: ChildProcess) => void;
  reject: (err: Error) => void;
  args: string[];
  message: string;
  claudeToken: string;
  userId: string;
  configPath: string;
}

export class SessionManager {
  private activeProcesses = new Map<string, ChildProcess>();
  private queue: QueuedRequest[] = [];
  private droppedServers = new Map<string, DroppedServer[]>();

  get activeCount(): number {
    return this.activeProcesses.size;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  /** Read-once: returns and clears the servers dropped from this request's session. */
  takeDroppedServers(requestId: string): DroppedServer[] {
    const dropped = this.droppedServers.get(requestId) ?? [];
    this.droppedServers.delete(requestId);
    return dropped;
  }

  async startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPaths: string[], provenanceKey: string, verificationRunId?: string): Promise<ChildProcess> {
    const { configPath, droppedServers } = await buildMcpConfigFile(userId, provenanceKey, verificationRunId);
    this.droppedServers.set(requestId, droppedServers);

    const addDirArgs: string[] = [];
    for (const p of repoPaths) {
      addDirArgs.push('--add-dir', p);
    }

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--max-turns', String(config.claudeMaxTurns),
      ...addDirArgs,
      '--system-prompt', systemPrompt,
      '--mcp-config', configPath,
      '--strict-mcp-config',
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', ...config.claudeDisallowedTools,
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId, configPath);
  }

  async resumeSession(requestId: string, claudeSessionId: string, message: string, claudeToken: string, userId: string, provenanceKey: string): Promise<ChildProcess> {
    const { configPath, droppedServers } = await buildMcpConfigFile(userId, provenanceKey);
    this.droppedServers.set(requestId, droppedServers);

    const args = [
      '--resume', claudeSessionId,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--mcp-config', configPath,
      '--strict-mcp-config',
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', ...config.claudeDisallowedTools,
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId, configPath);
  }

  killSession(requestId: string): void {
    const proc = this.activeProcesses.get(requestId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(requestId);
      this.processQueue();
    }
  }

  /**
   * Queued requests are rejected rather than dropped: a caller awaiting a
   * queued promise that is silently discarded hangs forever, and for a
   * verification run that also leaves its VerificationRun row pending.
   */
  killAll(): void {
    for (const [, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    const dropped = this.queue;
    this.queue = [];
    for (const q of dropped) {
      cleanupConfigFile(q.configPath);
      q.reject(new Error('session queue was cleared before this request could start'));
    }
  }

  private spawnOrQueue(requestId: string, args: string[], message: string, claudeToken: string, userId: string, configPath: string): Promise<ChildProcess> {
    if (this.activeProcesses.size < config.maxConcurrentSessions) {
      try {
        return Promise.resolve(this.doSpawn(requestId, args, message, claudeToken, userId, configPath));
      } catch (err) {
        cleanupConfigFile(configPath);
        throw err;
      }
    }

    return new Promise<ChildProcess>((resolve, reject) => {
      this.queue.push({ resolve, reject, args, message, claudeToken, userId, configPath });
    });
  }

  private doSpawn(requestId: string, args: string[], message: string, claudeToken: string, userId: string, configPath: string): ChildProcess {
    console.log(`[session-manager] Spawning claude process (requestId=${requestId}, active=${this.activeProcesses.size}, queued=${this.queue.length})`);
    console.log(`[session-manager] Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

    const userHome = path.join(SESSIONS_DIR, userId);
    mkdirSync(userHome, { recursive: true });

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: userHome,
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
      },
    });

    console.log(`[session-manager] Process spawned (pid=${proc.pid})`);

    this.activeProcesses.set(requestId, proc);

    proc.stdin!.write(message);
    proc.stdin!.end();

    proc.on('close', (code, signal) => {
      console.log(`[session-manager] Process closed (pid=${proc.pid}, code=${code}, signal=${signal}, requestId=${requestId})`);
      this.activeProcesses.delete(requestId);
      cleanupConfigFile(configPath);
      this.processQueue();
    });

    proc.on('error', (err) => {
      console.error(`[session-manager] Process error (pid=${proc.pid}, requestId=${requestId}):`, err.message);
      this.activeProcesses.delete(requestId);
      cleanupConfigFile(configPath);
      this.processQueue();
    });

    return proc;
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.activeProcesses.size >= config.maxConcurrentSessions) return;

    const next = this.queue.shift()!;
    const requestId = `queued-${Date.now()}`;
    try {
      next.resolve(this.doSpawn(requestId, next.args, next.message, next.claudeToken, next.userId, next.configPath));
    } catch (err) {
      // A spawn that throws must reach the caller; otherwise it waits forever.
      cleanupConfigFile(next.configPath);
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export const sessionManager = new SessionManager();
