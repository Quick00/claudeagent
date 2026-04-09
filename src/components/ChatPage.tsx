'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import ChatSidebar from '@/components/ChatSidebar';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import LinkClaudeModal from '@/components/LinkClaudeModal';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Flag {
  id: string;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  admin: { name: string } | null;
  seenByUser: boolean;
}

export default function ChatPage({ initialConversationId }: { initialConversationId?: string }) {
  const { data: session, status } = useSession();

  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [claudeLinked, setClaudeLinked] = useState<boolean | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  const fetchClaudeStatus = () => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then((data) => setClaudeLinked(data.linked))
      .catch(() => setClaudeLinked(false));
  };

  const fetchFlags = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.flags) {
        setFlags(data.flags);
        for (const flag of data.flags) {
          if (flag.status === 'RESPONDED' && !flag.seenByUser) {
            fetch(`/api/flags/${flag.id}/seen`, { method: 'PATCH' }).catch(() => {});
          }
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchClaudeStatus();
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    setStreamingContent('');
    setToolStatus(null);
    setIsLoading(false);
    setFlags([]);
    window.history.replaceState(null, '', `/conversation/${id}`);

    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(
      data.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }))
    );
    fetchFlags(id);
  }, [fetchFlags]);

  // Load initial conversation on mount
  useEffect(() => {
    if (initialConversationId) {
      loadConversation(initialConversationId);
    }
  }, [initialConversationId, loadConversation]);

  // Re-fetch conversation messages when returning to the page.
  // If the last message is from the user (response still generating), poll until
  // the assistant reply appears in the DB.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const pollForResponse = async (convId: string) => {
      if (cancelled) return;
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const msgs: Message[] = data.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }));
      setMessages(msgs);

      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'user' && !cancelled) {
        // Response not saved yet — keep polling
        setIsLoading(true);
        pollTimer = setTimeout(() => pollForResponse(convId), 500);
      } else {
        setIsLoading(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && conversationId && !isLoading) {
        pollForResponse(conversationId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [conversationId, isLoading]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    setToolStatus(null);
    setIsLoading(false);
    setFlags([]);
    setShowFlagForm(false);
    window.history.replaceState(null, '', '/');
  };

  const handleSend = async (message: string) => {
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: message },
    ]);
    setIsLoading(true);
    setStreamingContent('');
    setToolStatus(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message }),
      });

      if (res.status === 403) {
        const data = await res.json();
        if (data.error === 'claude_account_not_linked' || data.error === 'claude_token_expired') {
          setClaudeLinked(false);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'conversation_created') {
              setConversationId(event.conversationId);
              window.history.replaceState(null, '', `/conversation/${event.conversationId}`);
              setRefreshTrigger((prev) => prev + 1);
            }

            if (event.type === 'text') {
              accumulated += event.content;
              setStreamingContent(accumulated);
              setToolStatus(null);
            }

            if (event.type === 'tool_use') {
              const labels: Record<string, string> = {
                Glob: 'Searching for files...',
                Grep: 'Searching code...',
                Read: 'Reading files...',
                Bash: 'Running a command...',
                WebSearch: 'Searching the web...',
                WebFetch: 'Fetching a page...',
                mcp__knowledge__save_knowledge: 'Saving to knowledge base...',
                mcp__knowledge__search_knowledge: 'Searching knowledge base...',
              };
              setToolStatus(labels[event.tool] || 'Analyzing the codebase...');
            }

            if (event.type === 'done') {
              setToolStatus(null);
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: accumulated,
                },
              ]);
              setStreamingContent('');
              setRefreshTrigger((prev) => prev + 1);
            }

            if (event.type === 'error') {
              setStreamingContent('');
              setToolStatus(null);
              if (event.errorType === 'claude_token_expired') {
                setClaudeLinked(false);
                setIsLoading(false);
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                return;
              } else {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: `Error: ${event.content}`,
                  },
                ]);
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to connect. Please try again.',
        },
      ]);
      setStreamingContent('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFlag = async () => {
    if (!conversationId || flagSubmitting) return;
    setFlagSubmitting(true);
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, reason: flagReason }),
      });
      if (res.ok) {
        const flag = await res.json();
        setFlags((prev) => [...prev, flag]);
        setShowFlagForm(false);
        setFlagReason('');
      }
    } finally {
      setFlagSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen">
      <ChatSidebar
        activeConversationId={conversationId}
        onSelectConversation={loadConversation}
        onNewChat={handleNewChat}
        refreshTrigger={refreshTrigger}
      />
      <div className="flex flex-1 flex-col">
        {claudeLinked === false ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <div className="text-center">
              <h2 className="mb-2 text-lg font-semibold text-gray-900">
                Link your Claude account
              </h2>
              <p className="mb-4 max-w-sm text-sm text-gray-500">
                To start asking questions, you need to link your Claude account.
                This requires a Claude Max, Pro, or Team subscription.
              </p>
              <button
                onClick={() => setShowLinkModal(true)}
                className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
              >
                Link Claude Account
              </button>
            </div>
          </div>
        ) : (
          <>
            {conversationId && (
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
                <div />
                <div className="relative">
                  <button
                    onClick={() => setShowFlagForm(!showFlagForm)}
                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      flags.some((f) => f.status === 'PENDING')
                        ? 'bg-red-50 text-red-600'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    title="Flag this conversation"
                  >
                    <svg className="h-3.5 w-3.5" fill={flags.some((f) => f.status === 'PENDING') ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    {flags.some((f) => f.status === 'PENDING') ? 'Flagged' : 'Flag'}
                  </button>
                  {showFlagForm && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                      <textarea
                        value={flagReason}
                        onChange={(e) => setFlagReason(e.target.value)}
                        placeholder="What was wrong? (optional)"
                        className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm focus:border-blue-300 focus:outline-none"
                        rows={2}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => { setShowFlagForm(false); setFlagReason(''); }}
                          className="rounded-md px-3 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleFlag}
                          disabled={flagSubmitting}
                          className="rounded-md bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {flagSubmitting ? 'Flagging...' : 'Submit Flag'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              toolStatus={toolStatus}
              isLoading={isLoading}
              onSendSuggestion={handleSend}
              flags={flags}
            />
            <ChatInput onSend={handleSend} disabled={isLoading} />
          </>
        )}
      </div>

      {showLinkModal && (
        <LinkClaudeModal
          onClose={() => setShowLinkModal(false)}
          onLinked={() => {
            setShowLinkModal(false);
            fetchClaudeStatus();
          }}
        />
      )}
    </div>
  );
}
