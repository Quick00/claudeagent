import { spawn, ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { config } from '@/lib/config';

const PROJECT_ROOT = path.resolve(process.cwd());
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join('/tmp', 'claude-sessions');

/**
 * `verificationRunId` is set only for a tier 2 verification run. The MCP
 * server offers `resolve_verification` when — and only when — it is present,
 * and accepts no other run id, so an ordinary chat session cannot reach a
 * pending run even if it learns its id. It also drops `save_knowledge` for
 * that run, which has no business writing knowledge.
 */
function getMcpConfig(provenanceKey: string, verificationRunId?: string): string {
  return JSON.stringify({
    mcpServers: {
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
    },
  });
}

interface QueuedRequest {
  resolve: (proc: ChildProcess) => void;
  reject: (err: Error) => void;
  args: string[];
  message: string;
  claudeToken: string;
  userId: string;
}

export class SessionManager {
  private activeProcesses = new Map<string, ChildProcess>();
  private queue: QueuedRequest[] = [];

  get activeCount(): number {
    return this.activeProcesses.size;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPaths: string[], provenanceKey: string, verificationRunId?: string): ChildProcess | Promise<ChildProcess> {
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
      '--mcp-config', getMcpConfig(provenanceKey, verificationRunId),
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', ...config.claudeDisallowedTools,
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId);
  }

  resumeSession(requestId: string, claudeSessionId: string, message: string, claudeToken: string, userId: string, provenanceKey: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--resume', claudeSessionId,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--mcp-config', getMcpConfig(provenanceKey),
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', ...config.claudeDisallowedTools,
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId);
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
      q.reject(new Error('session queue was cleared before this request could start'));
    }
  }

  private spawnOrQueue(requestId: string, args: string[], message: string, claudeToken: string, userId: string): ChildProcess | Promise<ChildProcess> {
    if (this.activeProcesses.size < config.maxConcurrentSessions) {
      return this.doSpawn(requestId, args, message, claudeToken, userId);
    }

    return new Promise<ChildProcess>((resolve, reject) => {
      this.queue.push({ resolve, reject, args, message, claudeToken, userId });
    });
  }

  private doSpawn(requestId: string, args: string[], message: string, claudeToken: string, userId: string): ChildProcess {
    console.log(`[session-manager] Spawning claude process (requestId=${requestId}, active=${this.activeProcesses.size}, queued=${this.queue.length})`);
    console.log(`[session-manager] Args: claude ${args.join(' ')}`);
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
      this.processQueue();
    });

    proc.on('error', (err) => {
      console.error(`[session-manager] Process error (pid=${proc.pid}, requestId=${requestId}):`, err.message);
      this.activeProcesses.delete(requestId);
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
      next.resolve(this.doSpawn(requestId, next.args, next.message, next.claudeToken, next.userId));
    } catch (err) {
      // A spawn that throws must reach the caller; otherwise it waits forever.
      next.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export const sessionManager = new SessionManager();
