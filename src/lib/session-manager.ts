import { spawn, ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { config } from '@/lib/config';

const PROJECT_ROOT = path.resolve(process.cwd());
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join('/tmp', 'claude-sessions');

function getMcpConfig(repositoryId?: string): string {
  return JSON.stringify({
    mcpServers: {
      knowledge: {
        command: 'node',
        args: [path.join(PROJECT_ROOT, 'src/mcp/knowledge-server.mjs')],
        env: {
          KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
          KNOWLEDGE_SEARCH_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge/search`,
          KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
          REPOSITORY_ID: repositoryId || '',
        },
      },
    },
  });
}

interface QueuedRequest {
  resolve: (proc: ChildProcess) => void;
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

  startSession(requestId: string, message: string, systemPrompt: string, claudeToken: string, userId: string, repoPath: string, repositoryId?: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--max-turns', String(config.claudeMaxTurns),
      '--add-dir', repoPath,
      '--system-prompt', systemPrompt,
      '--mcp-config', getMcpConfig(repositoryId),
      '--permission-mode', 'bypassPermissions',
    ];

    return this.spawnOrQueue(requestId, args, message, claudeToken, userId);
  }

  resumeSession(requestId: string, claudeSessionId: string, message: string, claudeToken: string, userId: string, repositoryId?: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--resume', claudeSessionId,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--mcp-config', getMcpConfig(repositoryId),
      '--permission-mode', 'bypassPermissions',
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

  killAll(): void {
    for (const [, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    this.queue = [];
  }

  private spawnOrQueue(requestId: string, args: string[], message: string, claudeToken: string, userId: string): ChildProcess | Promise<ChildProcess> {
    if (this.activeProcesses.size < config.maxConcurrentSessions) {
      return this.doSpawn(requestId, args, message, claudeToken, userId);
    }

    return new Promise<ChildProcess>((resolve) => {
      this.queue.push({ resolve, args, message, claudeToken, userId });
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
      cwd: config.repoPath,
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
    const proc = this.doSpawn(requestId, next.args, next.message, next.claudeToken, next.userId);
    next.resolve(proc);
  }
}

export const sessionManager = new SessionManager();
