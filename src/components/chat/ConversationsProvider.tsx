'use client';

import { createContext, use, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { ROUTES, isActiveHref } from '@/lib/navigation';

export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ConversationsContextValue = {
  conversations: Conversation[];
  /** True while the first (or a forced) list fetch is in flight. */
  loading: boolean;
  /**
   * True when the list could not be loaded. `apiFetch` throws on a non-2xx, so
   * this is real information: without it a 500 would render as "No
   * conversations yet", which is a lie the old silent `catch` used to tell.
   */
  loadFailed: boolean;
  /** Refetches and resolves with the rows, so a caller can act on the count. */
  refresh: () => Promise<Conversation[]>;
  remove: (id: string) => Promise<void>;
  setTitle: (id: string, title: string) => void;
  /**
   * The conversation the user has just clicked, while the router is still
   * fetching it. Null as soon as the navigation commits. `ChatThread` reads it
   * to swap to its skeleton immediately instead of leaving the outgoing
   * thread — or the new-chat empty state — on screen for the round trip.
   */
  pendingConversationId: string | null;
  beginNavigation: (id: string) => void;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

export function useConversations(): ConversationsContextValue {
  const value = use(ConversationsContext);
  if (!value) {
    throw new Error('useConversations must be used within a ConversationsProvider');
  }
  return value;
}

const EMPTY: Conversation[] = [];

/**
 * Shell-scoped owner of the conversation list. The list lives in the sidebar
 * DOM while the thread lives in the inset, so they are siblings and cannot
 * share component state — this context is the only thing between them.
 *
 * The rows themselves are Query's, under `qk.conversations.list()`: the
 * provider no longer owns fetch state, an `AbortController` or a mirror ref.
 * What it still owns is the pending-navigation intent below, which is not
 * server state and has no key.
 */
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: qk.conversations.list(),
    queryFn: ({ signal }) => apiFetch<Conversation[]>('/api/conversations', { signal }),
  });

  const conversations = Array.isArray(listQuery.data) ? listQuery.data : EMPTY;

  /**
   * `refetch()` rather than `invalidateQueries()` because callers want the
   * rows back: the milestone confetti in `useConversation.send` counts them.
   * A failed refetch keeps the last good rows, so this resolves with what is
   * on screen rather than with an empty list.
   */
  const { refetch } = listQuery;
  const refresh = useCallback(async () => {
    const result = await refetch();
    return Array.isArray(result.data) ? result.data : EMPTY;
  }, [refetch]);

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/conversations/${id}`, jsonBody('DELETE')),
    onSuccess: (_data, id) => {
      // Drop the row before the refetch lands so the list never shows a
      // conversation that is already gone, then let the server confirm.
      queryClient.setQueryData<Conversation[]>(qk.conversations.list(), (prev) =>
        (prev ?? []).filter((c) => c.id !== id),
      );
      queryClient.removeQueries({ queryKey: qk.conversations.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.conversations.list() });
      if (isActiveHref(ROUTES.chat(id), pathname)) {
        router.push(ROUTES.chat());
      }
    },
    onError: () => toast.error('Could not delete that conversation.'),
  });

  const { mutateAsync: removeConversation } = removeMutation;
  const remove = useCallback(
    async (id: string) => {
      // The toast in `onError` is the whole error surface; a rejected promise
      // here would only become an unhandled rejection at the call site.
      await removeConversation(id).catch(() => undefined);
    },
    [removeConversation],
  );

  /**
   * A local rename, written straight into the cache.
   *
   * There is no `PATCH /api/conversations/:id` route to call — titles are
   * assigned server-side from the first message — so this stays a cache write
   * rather than becoming a mutation. See the report for the cross-track note.
   */
  const setTitle = useCallback(
    (id: string, title: string) => {
      queryClient.setQueryData<Conversation[]>(qk.conversations.list(), (prev) =>
        (prev ?? []).map((c) => (c.id === id ? { ...c, title } : c)),
      );
    },
    [queryClient],
  );

  /**
   * The conversation the user clicked, held only until the router commits.
   *
   * Cleared by React's documented "adjust state while rendering" pattern
   * rather than by an effect: any change of pathname ends the pending
   * navigation, in the same render that observes it, so a thread can never be
   * stranded on its skeleton and nothing has to stay in sync.
   *
   * Comparing against the pathname it *started* from is not enough, and that
   * was a real bug: after `/chat` → `/chat/<id>` → New chat, the pathname is
   * `/chat` again, the old record matches once more, and `/chat` renders the
   * skeleton forever. Remembering the last pathname seen makes the record
   * strictly one-shot.
   */
  const [pending, setPending] = useState<string | null>(null);
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setPending(null);
  }
  const pendingConversationId = pathname === seenPathname ? pending : null;

  const beginNavigation = useCallback((id: string) => setPending(id), []);

  const loading = listQuery.isPending;
  const loadFailed = listQuery.isError;

  const value = useMemo<ConversationsContextValue>(
    () => ({
      conversations,
      loading,
      loadFailed,
      refresh,
      remove,
      setTitle,
      pendingConversationId,
      beginNavigation,
    }),
    [
      conversations,
      loading,
      loadFailed,
      refresh,
      remove,
      setTitle,
      pendingConversationId,
      beginNavigation,
    ],
  );

  return <ConversationsContext value={value}>{children}</ConversationsContext>;
}
