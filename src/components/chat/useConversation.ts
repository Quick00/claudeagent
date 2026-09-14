'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
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

/**
 * How often to re-read a thread whose last message is still the user's — the
 * answer is being generated somewhere else (another tab, or a reload mid-run).
 */
const ANSWER_POLL_MS = 500;

/**
 * How long a thread whose last message is the user's is treated as "an answer
 * is on its way". Past this, the run is assumed dead (a crashed CLI session, a
 * closed tab) — otherwise such a thread would poll every half second forever
 * and keep its composer disabled, with no way for the user to try again.
 */
const ANSWER_WAIT_WINDOW_MS = 5 * 60_000;

/**
 * True while the answer to the last message is expected to arrive on its own —
 * it is being generated in another tab, or by a run that outlived a reload.
 *
 * Never for an admin reading someone else's thread: an admin's own send does
 * not stream a `done`, so the last message stays theirs and this would never
 * clear.
 */
function isAwaitingAnswer(data: ApiConversation | undefined): boolean {
  if (!data || data.isOwner === false) return false;
  const last = data.messages[data.messages.length - 1];
  if (!last || last.role !== 'user') return false;
  const sentAt = last.createdAt ? new Date(last.createdAt).getTime() : NaN;
  return !Number.isNaN(sentAt) && Date.now() - sentAt < ANSWER_WAIT_WINDOW_MS;
}

const NO_MESSAGES: Message[] = [];
const NO_FLAGS: Flag[] = [];

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
 * The thread itself is Query's, under `qk.conversations.detail(id)` — which is
 * what makes coming back to a conversation you just read render instantly from
 * cache instead of flashing a skeleton. The cache is also the *only* store for
 * messages: an optimistic bubble and a finished answer are written into it
 * with `setQueryData`, never into a parallel `useState`, so the invalidation
 * after a stream completes cannot produce duplicates.
 *
 * The one exception is a brand-new chat, which has no id and therefore no key
 * until the server sends one. Those messages live in `draft` until the
 * `conversation_created` frame, which seeds the real key with them.
 *
 * Page-scoped on purpose — the conversation list is shell-scoped and lives in
 * `ConversationsProvider`.
 */
export function useConversation(initialConversationId: string | null) {
  const { data: session } = useSession();
  const { refresh: refreshConversations } = useConversations();
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const knowledgeConfettiFired = useRef(false);

  /**
   * The only `AbortController` left. Query cancels its own requests through
   * the `signal` every `queryFn` below forwards to `apiFetch`; this one exists
   * solely for the raw `/api/chat` stream, which Query must never own.
   *
   * It is created per send rather than per effect, so the StrictMode hazard
   * that used to break this hook — effects re-running with no intervening
   * render and reusing an already-aborted controller — cannot recur. The
   * cleanup reads the ref at unmount time, so whichever controller is current
   * is the one aborted.
   */
  const streamAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => streamAbortRef.current?.abort(), []);

  // Optimistic messages for a chat that has no id yet, mirrored into a ref so
  // the async send loop can seed the cache with them without a stale closure.
  const draftRef = useRef<Message[]>(NO_MESSAGES);
  const [draft, setDraft] = useState<Message[]>(NO_MESSAGES);
  const updateDraft = useCallback((fn: (prev: Message[]) => Message[]) => {
    draftRef.current = fn(draftRef.current);
    setDraft(draftRef.current);
  }, []);

  // ───────────────────────────── Claude link ─────────────────────────────

  const claudeQuery = useQuery({
    queryKey: qk.claude.status(),
    queryFn: ({ signal }) =>
      apiFetch<{ linked?: boolean }>('/api/auth/claude/status', { signal }),
  });

  // Tri-state on purpose: null means "not known yet", and `ChatThread` must
  // not offer the link screen until the probe has actually answered.
  const claudeLinked: boolean | null = claudeQuery.data
    ? !!claudeQuery.data.linked
    : claudeQuery.isError
      ? false
      : null;

  const refreshClaudeStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.claude.status() });
  }, [queryClient]);

  const setClaudeUnlinked = useCallback(() => {
    queryClient.setQueryData(qk.claude.status(), { linked: false });
  }, [queryClient]);

  // ────────────────────────────── The thread ──────────────────────────────

  const convQuery = useQuery({
    queryKey: qk.conversations.detail(conversationId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<ApiConversation>(`/api/conversations/${conversationId}`, { signal }),
    // Disabled while streaming: a refetch landing mid-answer would replace the
    // optimistic bubble with a half-written server copy. The `done` frame
    // invalidates, and the refetch runs the moment this flips back on.
    enabled: !!conversationId && !isStreaming,
    // Replaces the old `visibilitychange` listener. Overridden per query
    // because the app-wide default is off.
    refetchOnWindowFocus: true,
    // Replaces the old 500ms `setTimeout` chain. Query pauses this while the
    // tab is hidden, which the hand-rolled version could not do.
    refetchInterval: (query) => (isAwaitingAnswer(query.state.data) ? ANSWER_POLL_MS : false),
  });

  // `apiFetch` throws now, so a failed load is real information rather than a
  // silently empty thread. Surfaced once per failure, not once per render.
  const loadError = convQuery.error;
  const reportedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (!loadError || reportedErrorRef.current === loadError) return;
    reportedErrorRef.current = loadError;
    toast.error('Could not load this conversation.');
  }, [loadError]);

  const serverData = convQuery.data;

  const messages = useMemo<Message[]>(
    () => (serverData ? serverData.messages.map(toMessage) : draft),
    [serverData, draft],
  );

  const ownership = useMemo<Ownership | null>(
    () =>
      serverData
        ? {
            isOwner: !!serverData.isOwner,
            isAdmin: !!serverData.isAdmin,
            ownerHasClaudeToken: !!serverData.ownerHasClaudeToken,
            ownerName: serverData.user?.name ?? 'user',
            hasSession: !!serverData.claudeSessionId,
          }
        : null,
    [serverData],
  );

  const flags = serverData?.flags ?? NO_FLAGS;
  const hasPendingFlag = flags.some((f) => f.status === 'PENDING');

  // A conversation the route named, whose first read has not answered yet.
  // Never deferred: the fallback while loading is the destination's own
  // skeleton, and delaying it would put the new-chat empty state on screen.
  const initialLoading = !!initialConversationId && convQuery.isPending;

  // The thinking indicator, and what disables the composer. Derived rather
  // than stored: the old hook set a flag from inside its poll callback, which
  // is the same information arrived at twice.
  const isLoading = isStreaming || isAwaitingAnswer(serverData);

  // ───────────────────────── Cache-backed message edits ─────────────────────

  // The live conversation id for the async send loop, which cannot see a
  // `setConversationId` it performed itself.
  const convIdRef = useRef<string | null>(initialConversationId);

  const appendMessage = useCallback(
    (message: Message) => {
      const id = convIdRef.current;
      const key = id ? qk.conversations.detail(id) : null;
      if (key && queryClient.getQueryData<ApiConversation>(key)) {
        queryClient.setQueryData<ApiConversation>(key, (old) =>
          old ? { ...old, messages: [...old.messages, message] } : old,
        );
        return;
      }
      // No server payload to append to (new chat, or a load that failed):
      // the draft is what `messages` reads in that case.
      updateDraft((prev) => [...prev, message]);
    },
    [queryClient, updateDraft],
  );

  const dropMessage = useCallback(
    (messageId: string) => {
      const id = convIdRef.current;
      const key = id ? qk.conversations.detail(id) : null;
      if (key && queryClient.getQueryData<ApiConversation>(key)) {
        queryClient.setQueryData<ApiConversation>(key, (old) =>
          old ? { ...old, messages: old.messages.filter((m) => m.id !== messageId) } : old,
        );
        return;
      }
      updateDraft((prev) => prev.filter((m) => m.id !== messageId));
    },
    [queryClient, updateDraft],
  );

  // ─────────────────────────────── Flags ───────────────────────────────

  const { mutate: markFlagSeen } = useMutation({
    mutationFn: (flagId: string) =>
      apiFetch<void>(`/api/flags/${flagId}/seen`, jsonBody('PATCH')),
    onSuccess: () => {
      // The shell's unread dot reads the same endpoint; clearing it here means
      // the badge goes away on read rather than on the next 30s tick.
      void queryClient.invalidateQueries({ queryKey: qk.flags.notifications() });
    },
  });

  // One PATCH per flag per mount: the thread is refetched on focus and on a
  // poll, and re-marking an already-seen flag on every one of those is waste.
  const markedSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const f of flags) {
      if (f.status === 'RESPONDED' && !f.seenByUser && !markedSeenRef.current.has(f.id)) {
        markedSeenRef.current.add(f.id);
        markFlagSeen(f.id);
      }
    }
  }, [flags, markFlagSeen]);

  const { mutateAsync: createFlag, isPending: flagSubmitting } = useMutation({
    mutationFn: (vars: { conversationId: string; reason: string }) =>
      apiFetch<Flag>(
        '/api/flags',
        jsonBody('POST', { conversationId: vars.conversationId, reason: vars.reason }),
      ),
    onSuccess: (created, vars) => {
      const key = qk.conversations.detail(vars.conversationId);
      queryClient.setQueryData<ApiConversation>(key, (old) =>
        old ? { ...old, flags: [...(old.flags ?? []), created] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: qk.flags.all });
    },
  });

  const flag = useCallback(
    async (reason: string) => {
      if (!conversationId || flagSubmitting || hasPendingFlag) return false;
      try {
        await createFlag({ conversationId, reason });
        return true;
      } catch {
        // `FlagPopover` raises the toast for a false return.
        return false;
      }
    },
    [conversationId, createFlag, flagSubmitting, hasPendingFlag],
  );

  // ──────────────────────────────── Send ────────────────────────────────

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
      setIsStreaming(true);
      setStreamingContent('');
      setToolStatus(null);

      // ───────────────────────── SSE streaming block ─────────────────────────
      // Everything down to the matching end marker is today's fetch + reader
      // protocol against `/api/chat`. `feature/resumable-chat-streams` replaces
      // this block wholesale with `useConversationStream`; nothing outside the
      // markers knows how the bytes arrive, so that rebase is local.
      //
      // This is deliberately a raw `fetch`, not `apiFetch` and not a Query
      // mutation: the body is an SSE `ReadableStream` read frame by frame, and
      // Query has no place in the middle of that.
      const controller = new AbortController();
      streamAbortRef.current = controller;
      const signal = controller.signal;
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
            setClaudeUnlinked();
            dropMessage(tempId);
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
              const newId = event.conversationId;
              // Seed the cache for the new id from the draft, so switching to
              // the real key finds data already there: no refetch of what we
              // have, and no empty frame between the two keys.
              queryClient.setQueryData<ApiConversation>(
                qk.conversations.detail(newId),
                (old) =>
                  old ?? {
                    messages: draftRef.current,
                    isOwner: true,
                    isAdmin: false,
                    ownerHasClaudeToken: true,
                    claudeSessionId: null,
                    user: { name: session?.user?.name ?? 'user' },
                    flags: [],
                  },
              );
              convIdRef.current = newId;
              // Swap the URL in place. `router.push` would remount the thread
              // and throw away the optimistic bubble mid-answer.
              setConversationId(newId);
              window.history.replaceState(null, '', ROUTES.chat(newId));
              void refreshConversations();
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
              // The cache, not this hook, is the record of what was said. The
              // bubble above keeps the answer on screen; this replaces it with
              // the server's copy (real ids, real timestamps) as soon as the
              // query is re-enabled in the `finally` below.
              const settledId = convIdRef.current;
              if (settledId) {
                void queryClient.invalidateQueries({
                  queryKey: qk.conversations.detail(settledId),
                });
              }
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
                setClaudeUnlinked();
                setIsStreaming(false);
                dropMessage(tempId);
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
        if (!signal.aborted) setIsStreaming(false);
      }
      // ─────────────────────── end SSE streaming block ───────────────────────
    },
    [
      appendMessage,
      conversationId,
      dropMessage,
      ownership,
      queryClient,
      refreshConversations,
      session,
      setClaudeUnlinked,
    ],
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
