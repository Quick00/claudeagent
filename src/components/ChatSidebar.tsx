'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';

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
}

export default function ChatSidebar({
  activeConversationId,
  onSelectConversation,
  onNewChat,
  refreshTrigger,
}: ChatSidebarProps) {
  const { data: session } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    fetch('/api/conversations')
      .then((res) => res.json())
      .then(setConversations)
      .catch(console.error);
  }, [refreshTrigger]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      onNewChat();
    }
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      <div className="p-4">
        <button
          onClick={onNewChat}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelectConversation(conv.id)}
            className={`group flex cursor-pointer items-center justify-between px-4 py-3 text-sm hover:bg-gray-100 ${
              activeConversationId === conv.id ? 'bg-gray-200' : ''
            }`}
          >
            <span className="truncate">{conv.title}</span>
            <button
              onClick={(e) => handleDelete(e, conv.id)}
              className="hidden text-gray-400 hover:text-red-500 group-hover:block"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-3 space-y-2">
        <a
          href="/dashboard"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Dashboard
        </a>
        <a
          href="/knowledge"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Knowledge Map
        </a>
      </div>
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center gap-3">
          {session?.user?.image && (
            <img
              src={session.user.image}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          )}
          <div className="flex-1 truncate text-sm">
            {session?.user?.name}
          </div>
          <button
            onClick={() => signOut()}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
