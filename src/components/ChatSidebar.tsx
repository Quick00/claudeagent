'use client';

import {useEffect, useMemo, useState} from 'react';
import { useSession, signOut } from 'next-auth/react';
import FeedbackWidget from './FeedbackWidget';

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  refreshTrigger: number;
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatSidebar({
  activeConversationId,
  onSelectConversation,
  onNewChat,
  refreshTrigger,
  isOpen,
  onClose,
}: ChatSidebarProps) {
  const { data: session } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [rawNotificationConvIds, setRawNotificationConvIds] = useState<Set<string>>(new Set());
  const [pendingFlagCount, setPendingFlagCount] = useState(0);
  const isAdmin = (session?.user as Record<string, unknown>)?.role === 'admin';

  useEffect(() => {
    fetch('/api/conversations')
      .then((res) => res.json())
      .then(setConversations)
      .catch(console.error);
  }, [refreshTrigger]);

  useEffect(() => {
    const fetchNotifications = () => {
      fetch('/api/flags/notifications')
        .then((res) => res.json())
        .then((data) => {
          setRawNotificationConvIds(new Set(data.conversationIds || []));
        })
        .catch(() => {});
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchPendingFlags = () => {
      fetch('/api/flags/admin-notifications')
        .then((res) => res.json())
        .then((data) => setPendingFlagCount(data.count ?? 0))
        .catch(() => {});
    };

    fetchPendingFlags();
    const interval = setInterval(fetchPendingFlags, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, refreshTrigger]);

  const notificationConvIds = useMemo(() => {
    if (!activeConversationId) return rawNotificationConvIds;
    if (!rawNotificationConvIds.has(activeConversationId)) return rawNotificationConvIds;
    const next = new Set(rawNotificationConvIds);
    next.delete(activeConversationId);
    return next;
  }, [rawNotificationConvIds, activeConversationId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      onNewChat();
    }
  };

  return (
    <>
      {/* Backdrop — visible on mobile when open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar container: mobile=overlay, desktop=in-place collapse */}
      <div
        className={`
          flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-all duration-200 ease-in-out dark:border-gray-700 dark:bg-gray-900
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50
          ${isOpen ? 'translate-x-0' : 'max-lg:-translate-x-full lg:ml-[-256px] lg:overflow-hidden lg:border-r-0'}
        `}
      >
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Conversations</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="Collapse sidebar"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <button
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="w-full rounded-lg cursor-pointer border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => {
              onSelectConversation(conv.id);
              onClose();
            }}
            className={`group flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
              activeConversationId === conv.id ? 'bg-gray-200 dark:bg-gray-800' : ''
            }`}
          >
            <span className="flex items-center gap-1.5 truncate">
              {conv.title}
              {notificationConvIds.has(conv.id) && (
                <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
              )}
            </span>
            <button
              onClick={(e) => handleDelete(e, conv.id)}
              className="hidden text-gray-400 hover:text-red-500 group-hover:block dark:text-gray-500 dark:hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-3 space-y-2 dark:border-gray-700">
        <a
          href="/dashboard"
          onClick={onClose}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Dashboard
        </a>
        <a
          href="/knowledge"
          onClick={onClose}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Knowledge Map
        </a>
        {isAdmin && (
          <a
            href="/admin/users"
            onClick={onClose}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" />
            </svg>
            Users
          </a>
        )}
        {isAdmin && (
          <a
            href="/admin/flags"
            onClick={onClose}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
            Flags
            {pendingFlagCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">
                {pendingFlagCount}
              </span>
            )}
          </a>
        )}
        <a
          href="/settings"
          onClick={onClose}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </a>
        <FeedbackWidget />
      </div>
      <div className="border-t border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {session?.user?.image && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={session.user.image}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          )}
          <div className="flex-1 truncate text-sm dark:text-gray-200">
            {session?.user?.name}
          </div>
          <button
            onClick={() => signOut()}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Sign out
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
