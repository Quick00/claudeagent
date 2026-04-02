import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { config } from '@/lib/config';

interface QueuedRequest {
  resolve: (proc: ChildProcess) => void;
  args: string[];
  message: string;
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

  startSession(requestId: string, message: string, systemPrompt: string): ChildProcess | Promise<ChildProcess> {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        knowledge: {
          command: 'node',
          args: [path.join(process.cwd(), 'src/mcp/knowledge-server.mjs')],
          env: {
            KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
            KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
          },
        },
      },
    });

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--max-turns', String(config.claudeMaxTurns),
      '--add-dir', config.eventinsightRepoPath,
      '--system-prompt', systemPrompt,
      '--mcp-config', mcpConfig,
      '--permission-mode', 'bypassPermissions',
    ];

    return this.spawnOrQueue(requestId, args, message);
  }

  resumeSession(requestId: string, claudeSessionId: string, message: string): ChildProcess | Promise<ChildProcess> {
    const args = [
      '--resume', claudeSessionId,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    return this.spawnOrQueue(requestId, args, message);
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
    for (const [id, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    this.queue = [];
  }

  private spawnOrQueue(requestId: string, args: string[], message: string): ChildProcess | Promise<ChildProcess> {
    if (this.activeProcesses.size < config.maxConcurrentSessions) {
      return this.doSpawn(requestId, args, message);
    }

    return new Promise<ChildProcess>((resolve) => {
      this.queue.push({ resolve, args, message });
    });
  }

  private doSpawn(requestId: string, args: string[], message: string): ChildProcess {
    console.log(`[session-manager] Spawning claude process (requestId=${requestId}, active=${this.activeProcesses.size}, queued=${this.queue.length})`);
    console.log(`[session-manager] Args: claude ${args.join(' ')}`);
    console.log(`[session-manager] Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.eventinsightRepoPath,
      env: { ...process.env },
    });

    console.log(`[session-manager] Process spawned (pid=${proc.pid})`);

    this.activeProcesses.set(requestId, proc);

    // Write message to stdin for the CLI to process
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
    const proc = this.doSpawn(requestId, next.args, next.message);
    next.resolve(proc);
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
