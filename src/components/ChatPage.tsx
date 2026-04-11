'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import ChatSidebar from '@/components/ChatSidebar';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import LinkClaudeModal from '@/components/LinkClaudeModal';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
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
  const { status } = useSession();

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
  const [copiedId, setCopiedId] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });
  const knowledgeConfettiFired = useRef(false);

  const fetchClaudeStatus = () => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then((data) => setClaudeLinked(data.linked))
      .catch(() => setClaudeLinked(false));
  };

  const processFlags = useCallback((flagsData: Flag[]) => {
    setFlags(flagsData);
    for (const flag of flagsData) {
      if (flag.status === 'RESPONDED' && !flag.seenByUser) {
        fetch(`/api/flags/${flag.id}/seen`, { method: 'PATCH' }).catch(() => {});
      }
    }
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
    setShowFlagForm(false);
    setFlagReason('');
    setFlags([]);
    window.history.replaceState(null, '', `/conversation/${id}`);
    knowledgeConfettiFired.current = false;

    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(
      data.messages.map((m: { id: string; role: string; content: string; attachments?: Attachment[] }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }))
    );
    if (data.flags) {
      processFlags(data.flags);
    }
  }, [processFlags]);

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
      const msgs: Message[] = data.messages.map((m: { id: string; role: string; content: string; attachments?: Attachment[] }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));
      setMessages(msgs);
      if (data.flags) {
        processFlags(data.flags);
      }

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
  }, [conversationId, isLoading, processFlags]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
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
    setFlagReason('');
    window.history.replaceState(null, '', '/');
    knowledgeConfettiFired.current = false;
  };

  const handleSend = async (message: string, attachments: Attachment[] = []) => {
    if (message === '/confetti') {
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
      return;
    }
    const attachmentIds = attachments.map((a) => a.id);
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: message, attachments },
    ]);
    setIsLoading(true);
    setStreamingContent('');
    setToolStatus(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message, attachmentIds }),
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
              if (event.tool === 'mcp__knowledge__save_knowledge' && !knowledgeConfettiFired.current) {
                knowledgeConfettiFired.current = true;
                confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 }, colors: ['#fbbf24', '#f59e0b', '#d97706'] });
              }
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

              // Confetti on conversation milestones (1, 10, 25, 50, 100, 200, ...)
              const convRes = await fetch('/api/conversations');
              const convs = await convRes.json();
              const count = convs.length;
              const milestones = [1, 10, 25, 50];
              if (milestones.includes(count) || (count >= 100 && count % 100 === 0)) {
                confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
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
    } catch {
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

  const hasPendingFlag = flags.some((f) => f.status === 'PENDING');

  const handleFlag = async () => {
    if (!conversationId || flagSubmitting || hasPendingFlag) return;
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
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex flex-1 flex-col">
        {!sidebarOpen && (
          <div className="flex items-center border-b border-gray-200 px-4 py-2 dark:border-gray-700">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              aria-label="Open sidebar"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
        {claudeLinked === false ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:p-8">
            <div className="text-center">
              <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                Link your Claude account
              </h2>
              <p className="mb-4 max-w-sm text-sm text-gray-500 dark:text-gray-400">
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
              <div className="flex items-center justify-between border-b border-gray-200 px-2 lg:px-4 py-2 dark:border-gray-700">
                <div />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(conversationId);
                      setCopiedId(true);
                      setTimeout(() => setCopiedId(false), 2000);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    title="Copy conversation ID"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {copiedId ? 'Copied!' : 'ID'}
                  </button>
                <div className="relative">
                  <button
                    onClick={() => { if (!hasPendingFlag && !flagSubmitting) setShowFlagForm(!showFlagForm); }}
                    disabled={hasPendingFlag || flagSubmitting}
                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      hasPendingFlag
                        ? 'bg-red-50 text-red-600'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    title={hasPendingFlag ? 'Already flagged' : 'Flag this conversation'}
                  >
                    <svg className="h-3.5 w-3.5" fill={hasPendingFlag ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    {hasPendingFlag ? 'Flagged' : 'Flag'}
                  </button>
                  {showFlagForm && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-64 lg:w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <textarea
                        value={flagReason}
                        onChange={(e) => setFlagReason(e.target.value)}
                        placeholder="What was wrong? (optional)"
                        className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm focus:border-blue-300 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        rows={2}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          onClick={() => { setShowFlagForm(false); setFlagReason(''); }}
                          className="rounded-md px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
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
