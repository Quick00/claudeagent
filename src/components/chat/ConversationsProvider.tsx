'use client';

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
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

/**
 * Shell-scoped owner of the conversation list. The list lives in the sidebar
 * DOM while the thread lives in the inset, so they are siblings and cannot
 * share component state — this context is the only thing between them.
 *
 * It replaces the old `refreshTrigger` counter: callers ask for `refresh()`
 * explicitly instead of bumping a number to make an effect re-run.
 */
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  // Mirror of `conversations` so `refresh()` can resolve with the rows even
  // when the fetch fails, without making callers wait for a re-render.
  const rowsRef = useRef<Conversation[]>([]);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch('/api/conversations', { signal: controller.signal });
      if (!res.ok || controller.signal.aborted) return rowsRef.current;
      const data = (await res.json()) as Conversation[];
      if (controller.signal.aborted) return rowsRef.current;
      const rows = Array.isArray(data) ? data : [];
      rowsRef.current = rows;
      setConversations(rows);
      return rows;
    } catch {
      // A failed list fetch leaves the previous rows on screen; the next
      // refresh (send, delete, remount) tries again.
      return rowsRef.current;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        toast.error('Could not delete that conversation.');
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (isActiveHref(ROUTES.chat(id), pathname)) {
        router.push(ROUTES.chat());
      }
    },
    [pathname, router],
  );

  const setTitle = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  useEffect(() => {
    rowsRef.current = conversations;
  }, [conversations]);

  // Recorded with the pathname it was started from, then *derived* rather than
  // cleared: the moment the router commits the new URL, `pathname` changes and
  // this reads back as null on its own. No effect to keep in sync, and no way
  // for an abandoned navigation to leave a thread stuck on its skeleton.
  const [pending, setPending] = useState<{ id: string; from: string } | null>(null);
  const pendingConversationId = pending && pending.from === pathname ? pending.id : null;

  const beginNavigation = useCallback(
    (id: string) => setPending({ id, from: pathname }),
    [pathname],
  );

  const value = useMemo<ConversationsContextValue>(
    () => ({
      conversations,
      loading,
      refresh,
      remove,
      setTitle,
      pendingConversationId,
      beginNavigation,
    }),
    [conversations, loading, refresh, remove, setTitle, pendingConversationId, beginNavigation],
  );

  return <ConversationsContext value={value}>{children}</ConversationsContext>;
}
