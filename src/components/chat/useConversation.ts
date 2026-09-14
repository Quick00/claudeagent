'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useSession } from 'next-auth/react';
import { ROUTES } from '@/lib/navigation';
import { useConversations } from './ConversationsProvider';

export type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  attachments?: Attachment[];
  sentByAdmin?: { id: string; name: string } | null;
  seenByOwner?: boolean;
};

export type Flag = {
  id: string;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  admin: { name: string } | null;
  seenByUser?: boolean;
};

export type Ownership = {
  isOwner: boolean;
  isAdmin: boolean;
  ownerHasClaudeToken: boolean;
  ownerName: string;
  hasSession: boolean;
};

type ApiMessage = {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
  attachments?: Attachment[];
  sentByAdmin?: { id: string; name: string } | null;
  seenByOwner?: boolean;
};

type ApiConversation = {
  messages: ApiMessage[];
  isOwner?: boolean;
  isAdmin?: boolean;
  ownerHasClaudeToken?: boolean;
  claudeSessionId?: string | null;
  user?: { name?: string };
  flags?: Flag[];
};

const TOOL_LABELS: Record<string, string> = {
  Glob: 'Searching for files...',
  Grep: 'Searching code...',
  Read: 'Reading files...',
  Bash: 'Running a command...',
  WebSearch: 'Searching the web...',
  WebFetch: 'Fetching a page...',
  mcp__knowledge__save_knowledge: 'Saving to knowledge base...',
  mcp__knowledge__search_knowledge: 'Searching knowledge base...',
};

/** Conversation counts worth celebrating. Above 100 every hundredth. */
const MILESTONES = [1, 10, 25, 50];

/** Confetti is decoration; a canvas it cannot draw on must never break a send. */
function fireConfetti(options: confetti.Options) {
  try {
    confetti(options);
  } catch {
    // Ignored on purpose.
  }
}

const toMessage = (m: ApiMessage): Message => ({
  id: m.id,
  role: m.role as 'user' | 'assistant',
  content: m.content,
  createdAt: m.createdAt,
  attachments: m.attachments,
  sentByAdmin: m.sentByAdmin ?? null,
  seenByOwner: m.seenByOwner,
});

/**
 * Everything one chat thread needs: its messages, who owns it, its flags, the
 * Claude-link state, and the two actions (`send`, `flag`).
 *
 * Page-scoped on purpose — the conversation list is shell-scoped and lives in
 * `ConversationsProvider`. This hook only asks it to `refresh()`.
 */
export function useConversation(initialConversationId: string | null) {
  const { data: session } = useSession();
  const { refresh: refreshConversations } = useConversations();

  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(initialConversationId !== null);
  const [claudeLinked, setClaudeLinked] = useState<boolean | null>(null);
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  const knowledgeConfettiFired = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The abort signal for everything this hook has in flight, resolved at the
   * point of use rather than during render.
   *
   * That distinction matters: StrictMode re-runs effects *without* an
   * intervening render, so a controller the previous cleanup aborted is still
   * in the ref when the effects run again. Replacing it during render is too
   * late — every refetch inherits the aborted signal and rejects immediately.
   */
  const nextSignal = useCallback(() => {
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController();
    }
    return abortRef.current.signal;
  }, []);

  // Read the ref at cleanup time, not setup time, so a controller created
  // after this effect ran is still the one that gets aborted on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshClaudeStatus = useCallback(async () => {
    const signal = nextSignal();
    try {
      const res = await fetch('/api/auth/claude/status', { signal });
      const data = await res.json();
      setClaudeLinked(!!data.linked);
    } catch {
      if (!signal.aborted) setClaudeLinked(false);
    }
  }, [nextSignal]);

  useEffect(() => {
    refreshClaudeStatus();
  }, [refreshClaudeStatus]);

  /** Mark responded flags seen, so the sidebar dot clears. */
  const processFlags = useCallback((incoming: Flag[]) => {
    setFlags(incoming);
    for (const flag of incoming) {
      if (flag.status === 'RESPONDED' && !flag.seenByUser) {
        fetch(`/api/flags/${flag.id}/seen`, { method: 'PATCH' }).catch(() => {});
      }
    }
  }, []);

  const applyConversation = useCallback(
    (data: ApiConversation) => {
      const msgs = data.messages.map(toMessage);
      setMessages(msgs);
      setOwnership({
        isOwner: !!data.isOwner,
        isAdmin: !!data.isAdmin,
        ownerHasClaudeToken: !!data.ownerHasClaudeToken,
        ownerName: data.user?.name ?? 'user',
        hasSession: !!data.claudeSessionId,
      });
      if (data.flags) processFlags(data.flags);
      return msgs;
    },
    [processFlags],
  );

  // Load the thread named by the route. `ChatThread` is keyed on the id, so
  // this runs once per conversation rather than swapping state in place.
  useEffect(() => {
    // `initialLoading` already starts false for a brand-new thread.
    if (!initialConversationId) return;
    let cancelled = false;
    const signal = nextSignal();
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${initialConversationId}`, { signal });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ApiConversation;
        if (cancelled) return;
        applyConversation(data);
      } catch {
        // Leave the thread empty; the visibility poll retries on focus.
      } finally {
        // An aborted load has not finished, it was thrown away. Clearing the
        // flag here would drop the skeleton and show the "no messages yet"
        // empty state on a conversation that does have messages.
        if (!cancelled && !signal.aborted) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialConversationId, applyConversation, nextSignal]);

  // Coming back to the tab: re-read the thread. If the last message is still
  // the user's, the answer is being generated elsewhere — poll until it lands.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const poll = async (convId: string) => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/conversations/${convId}`, { signal: nextSignal() });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ApiConversation;
        if (cancelled) return;
        const msgs = applyConversation(data);
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'user') {
          setIsLoading(true);
          pollTimer = setTimeout(() => poll(convId), 500);
        } else {
          setIsLoading(false);
        }
      } catch {
        // Network blip; the next visibility change tries again.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && conversationId && !isLoading) {
        poll(conversationId);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [conversationId, isLoading, applyConversation, nextSignal]);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const send = useCallback(
    async (message: string, attachments: Attachment[] = []) => {
      if (message === '/confetti') {
        fireConfetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
        return;
      }

      const tempId = `temp-${Date.now()}`;
      const isAdminSend = !!(ownership && !ownership.isOwner && ownership.isAdmin);
      const adminAttribution =
        isAdminSend && session?.user
          ? {
              id: (session.user as { id?: string }).id ?? '',
              name: session.user.name ?? 'Admin',
            }
          : null;

      appendMessage({
        id: tempId,
        role: 'user',
        content: message,
        attachments,
        createdAt: new Date().toISOString(),
        sentByAdmin: adminAttribution,
      });
      setIsLoading(true);
      setStreamingContent('');
      setToolStatus(null);

      // ───────────────────────── SSE streaming block ─────────────────────────
      // Everything down to the matching end marker is today's fetch + reader
      // protocol against `/api/chat`. `feature/resumable-chat-streams` replaces
      // this block wholesale with `useConversationStream`; nothing outside the
      // markers knows how the bytes arrive, so that rebase is local.
      const signal = nextSignal();
      try {
        const res = isAdminSend
          ? await fetch(`/api/admin/conversations/${conversationId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: message }),
              signal,
            })
          : await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                conversationId,
                message,
                attachmentIds: attachments.map((a) => a.id),
              }),
              signal,
            });

        if (res.status === 403) {
          const data = await res.json();
          if (data.error === 'claude_account_not_linked' || data.error === 'claude_token_expired') {
            setClaudeLinked(false);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            return;
          }
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          for (const line of decoder.decode(value).split('\n')) {
            if (!line.startsWith('data: ')) continue;

            let event: {
              type?: string;
              content?: string;
              conversationId?: string;
              title?: string;
              tool?: string;
              errorType?: string;
            };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue; // Partial or malformed frame.
            }

            if (event.type === 'conversation_created' && event.conversationId) {
              // Swap the URL in place. `router.push` would remount the thread
              // and throw away the optimistic bubble mid-answer.
              setConversationId(event.conversationId);
              window.history.replaceState(null, '', ROUTES.chat(event.conversationId));
              refreshConversations();
            }

            if (event.type === 'text') {
              accumulated += event.content ?? '';
              setStreamingContent(accumulated);
              setToolStatus(null);
            }

            if (event.type === 'tool_use') {
              if (
                event.tool === 'mcp__knowledge__save_knowledge' &&
                !knowledgeConfettiFired.current
              ) {
                knowledgeConfettiFired.current = true;
                fireConfetti({
                  particleCount: 50,
                  spread: 60,
                  origin: { y: 0.7 },
                  colors: ['#fbbf24', '#f59e0b', '#d97706'],
                });
              }
              setToolStatus(TOOL_LABELS[event.tool ?? ''] || 'Analyzing the codebase...');
            }

            if (event.type === 'done') {
              setToolStatus(null);
              appendMessage({
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: accumulated,
                createdAt: new Date().toISOString(),
              });
              setStreamingContent('');
              const rows = await refreshConversations();
              const count = rows.length;
              if (MILESTONES.includes(count) || (count >= 100 && count % 100 === 0)) {
                fireConfetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
              }
            }

            if (event.type === 'error') {
              setStreamingContent('');
              setToolStatus(null);
              if (event.errorType === 'claude_token_expired') {
                setClaudeLinked(false);
                setIsLoading(false);
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                return;
              }
              appendMessage({
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${event.content}`,
                createdAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        appendMessage({
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to connect. Please try again.',
          createdAt: new Date().toISOString(),
        });
        setStreamingContent('');
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
      // ─────────────────────── end SSE streaming block ───────────────────────
    },
    [appendMessage, conversationId, nextSignal, ownership, refreshConversations, session],
  );

  const hasPendingFlag = flags.some((f) => f.status === 'PENDING');

  const flag = useCallback(
    async (reason: string) => {
      if (!conversationId || flagSubmitting || hasPendingFlag) return false;
      setFlagSubmitting(true);
      try {
        const res = await fetch('/api/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, reason }),
          signal: nextSignal(),
        });
        if (!res.ok) return false;
        const created = (await res.json()) as Flag;
        setFlags((prev) => [...prev, created]);
        return true;
      } catch {
        return false;
      } finally {
        setFlagSubmitting(false);
      }
    },
    [conversationId, flagSubmitting, hasPendingFlag, nextSignal],
  );

  return {
    conversationId,
    messages,
    streamingContent,
    toolStatus,
    isLoading,
    initialLoading,
    claudeLinked,
    ownership,
    flags,
    hasPendingFlag,
    flagSubmitting,
    send,
    flag,
    refreshClaudeStatus,
  };
}
