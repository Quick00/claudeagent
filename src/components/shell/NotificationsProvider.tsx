'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * The one poller for everything the shell badges. It replaces the three
 * 30-second `setInterval`s the old `ChatSidebar` ran side by side, so a page
 * with the rail, a panel and a thread mounted still makes one round of
 * requests rather than three.
 */
export type Notifications = {
  /** Conversations with an unread flag response. */
  notificationConvIds: string[];
  /** Flags awaiting an admin reply. Always 0 for a non-admin. */
  pendingFlags: number;
  /** Feedback posts still in TODO. Always 0 for a non-admin. */
  pendingFeedback: number;
};

const POLL_INTERVAL_MS = 30_000;

const NO_IDS: string[] = [];

const ALL_QUIET: Notifications = {
  notificationConvIds: NO_IDS,
  pendingFlags: 0,
  pendingFeedback: 0,
};

/**
 * Defaulted rather than null: a rail or panel rendered outside the provider
 * (tests, storybook-style harnesses) should badge nothing, not throw.
 */
const NotificationsContext = createContext<Notifications>(ALL_QUIET);

export function useNotifications(): Notifications {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: ReactNode;
}) {
  // Three queries rather than one hand-rolled tick. `refetchInterval` is the
  // 30s poll; Query pauses it while the tab is hidden, which the old
  // `setInterval` never did. A failed poll keeps the last counts and the next
  // tick retries — the same "not worth a toast" rule as before, except the
  // failure is now visible in the cache rather than swallowed by a `catch`.
  const notificationsQuery = useQuery({
    queryKey: qk.flags.notifications(),
    queryFn: ({ signal }) =>
      apiFetch<{ conversationIds?: string[] }>('/api/flags/notifications', { signal }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  // `enabled` is what keeps a plain user off the admin endpoints: they are
  // never requested at all, not requested and discarded.
  const adminFlagsQuery = useQuery({
    queryKey: qk.flags.adminNotifications(),
    queryFn: ({ signal }) =>
      apiFetch<{ count?: number }>('/api/flags/admin-notifications', { signal }),
    enabled: isAdmin,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const feedbackQuery = useQuery({
    queryKey: qk.feedback.adminList('TODO'),
    queryFn: ({ signal }) =>
      apiFetch<{ id: string }[]>('/api/admin/feedback?status=TODO', { signal }),
    enabled: isAdmin,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const conversationIds = notificationsQuery.data?.conversationIds;
  const pendingFlagsCount = adminFlagsQuery.data?.count;
  const feedbackRows = feedbackQuery.data;

  const value = useMemo<Notifications>(
    () => ({
      notificationConvIds: Array.isArray(conversationIds) ? conversationIds : NO_IDS,
      pendingFlags: isAdmin ? (pendingFlagsCount ?? 0) : 0,
      pendingFeedback: isAdmin && Array.isArray(feedbackRows) ? feedbackRows.length : 0,
    }),
    [conversationIds, pendingFlagsCount, feedbackRows, isAdmin],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
