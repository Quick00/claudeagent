'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
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

export default function ChatPage({ initialConversationId }: { initialConversationId?: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [claudeLinked, setClaudeLinked] = useState<boolean | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

  const fetchClaudeStatus = () => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then((data) => setClaudeLinked(data.linked))
      .catch(() => setClaudeLinked(false));
  };

  useEffect(() => {
    fetchClaudeStatus();
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    setStreamingContent('');
    setToolStatus(null);
    setIsLoading(false);
    router.replace(`/conversation/${id}`);

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
  }, [router]);

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
    router.replace('/');
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
              };
              setToolStatus(labels[event.tool] || 'Analyzing the codebase...');
            }

            if (event.type === 'done') {
              setToolStatus(null);
              setConversationId(event.conversationId);
              router.replace(`/conversation/${event.conversationId}`);
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
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              toolStatus={toolStatus}
              isLoading={isLoading}
              onSendSuggestion={handleSend}
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
