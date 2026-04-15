import type { ChildProcess } from 'child_process';

/**
 * Handlers invoked as the Claude CLI child process emits stream-json events.
 * Each route using the shared pipeline supplies only the handlers it cares
 * about — the admin-send endpoint handles a small subset (text, tool, result),
 * while the main chat endpoint also handles auth/rate-limit/retry paths.
 */
export interface ClaudeEventHandlers {
  /** Emitted when a session ID appears (system event or result event). */
  onSessionId?: (sessionId: string) => void;
  /** Emitted for each streamed text delta chunk. */
  onTextDelta?: (delta: string) => void;
  /** Emitted whenever the assistant invokes a tool. */
  onToolUse?: (toolName: string) => void;
  /** Emitted when Claude reports an authentication failure. */
  onAuthFailed?: () => void;
  /** Emitted when Claude reports a rate-limit message with user-facing text. */
  onRateLimit?: (content: string) => void;
  /** Emitted for the `result` event (terminal success or error).
   *  Return `true` to stop processing remaining lines in this chunk
   *  (e.g. when scheduling a retry that attaches a new process). */
  onResult?: (event: { is_error?: boolean; subtype?: string; session_id?: string }) => boolean | void;
  /** Emitted when the child process closes. */
  onClose?: (code: number | null) => void;
  /** Emitted when the child process emits an `error`. */
  onProcessError?: (err: Error) => void;
  /** Prefix used when forwarding stderr to the server log. */
  logPrefix?: string;
}

/**
 * Parse the Claude CLI stream-json protocol from a child process's stdout and
 * dispatch typed events to the provided handlers. Non-JSON lines are ignored.
 * stderr is forwarded to `console.error` with `logPrefix`.
 */
export function attachClaudeProcess(
  proc: ChildProcess,
  handlers: ClaudeEventHandlers,
): void {
  const prefix = handlers.logPrefix ?? '[claude-stream]';

  // Buffer for incomplete lines split across data events.
  let stdoutBuffer = '';

  function processLine(line: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return false; // not valid JSON, skip
    }

    if (event.type === 'system' && typeof event.session_id === 'string') {
      handlers.onSessionId?.(event.session_id);
    }

    if (event.type === 'stream_event') {
      const inner = event.event as {
        type?: string;
        delta?: { type?: string; text?: string };
        content_block?: { type?: string; name?: string };
      } | undefined;
      if (inner?.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
        handlers.onToolUse?.(inner.content_block.name ?? 'unknown');
      }
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
        handlers.onTextDelta?.(inner.delta.text);
      }
    }

    if (event.type === 'assistant' && event.error === 'authentication_failed') {
      handlers.onAuthFailed?.();
    }

    const assistantMsg = event.message as { content?: Array<{ type?: string; name?: string; text?: string }> } | undefined;

    if (event.type === 'assistant' && event.error === 'rate_limit' && assistantMsg?.content?.[0]?.text) {
      handlers.onRateLimit?.(assistantMsg.content[0].text);
    }

    if (event.type === 'assistant' && assistantMsg?.content) {
      for (const block of assistantMsg.content) {
        if (block.type === 'tool_use') {
          handlers.onToolUse?.(block.name ?? 'unknown');
        }
      }
    }

    if (event.type === 'result') {
      if (typeof event.session_id === 'string') {
        handlers.onSessionId?.(event.session_id);
      }
      const stop = handlers.onResult?.(event as { is_error?: boolean; subtype?: string; session_id?: string });
      if (stop) return true; // signal caller to stop processing this chunk
    }

    return false;
  }

  proc.stdout!.on('data', (chunk: Buffer) => {
    const raw = stdoutBuffer + chunk.toString();
    const parts = raw.split('\n');
    // Last element is either '' (chunk ended with \n) or an incomplete line
    stdoutBuffer = parts.pop()!;

    for (const line of parts) {
      if (!line) continue;
      const stop = processLine(line);
      if (stop) return;
    }
  });

  proc.stdout!.on('end', () => {
    // Process any trailing data left in the buffer
    if (stdoutBuffer.trim()) {
      processLine(stdoutBuffer);
      stdoutBuffer = '';
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    console.error(`${prefix} stderr:`, chunk.toString());
  });

  proc.on('close', (code) => handlers.onClose?.(code));
  proc.on('error', (err) => handlers.onProcessError?.(err));
}

/**
 * SSE sink passed to the `onStart` callback of `createSseResponse`. `send` and
 * `close` are idempotent after the stream closes.
 */
export interface SseSink {
  send(data: string): void;
  close(): void;
}

/**
 * Build an SSE `Response` and invoke `onStart` with a sink that writes
 * `data: ...\n\n` frames. The sink is safe to call after close (no-op).
 */
export function createSseResponse(onStart: (sink: SseSink) => void): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const sink: SseSink = {
        send(data: string) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            closed = true;
          }
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
      };
      onStart(sink);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
