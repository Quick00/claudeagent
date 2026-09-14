'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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

const ALL_QUIET: Notifications = {
  notificationConvIds: [],
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

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export function NotificationsProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: ReactNode;
}) {
  const [value, setValue] = useState<Notifications>(ALL_QUIET);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const next: Notifications = { ...ALL_QUIET };

      try {
        const data = (await getJson('/api/flags/notifications')) as {
          conversationIds?: string[];
        } | null;
        if (Array.isArray(data?.conversationIds)) next.notificationConvIds = data.conversationIds;
      } catch {
        // A failed poll is not worth a toast: the next tick retries.
      }

      // A plain user has no access to either admin endpoint, so never ask.
      if (isAdmin) {
        try {
          const data = (await getJson('/api/flags/admin-notifications')) as {
            count?: number;
          } | null;
          next.pendingFlags = data?.count ?? 0;
        } catch {
          // ignored, see above
        }

        try {
          const data = await getJson('/api/admin/feedback?status=TODO');
          if (Array.isArray(data)) next.pendingFeedback = data.length;
        } catch {
          // ignored, see above
        }
      }

      if (!cancelled) setValue(next);
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
