'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import ChatSidebar from '@/components/ChatSidebar';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  const loadConversation = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConversationId(id);
    setMessages(
      data.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }))
    );
    setStreamingContent('');
  };

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
  };

  const handleSend = async (message: string) => {
    // Optimistically add user message
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
              };
              setToolStatus(labels[event.tool] || 'Analyzing the codebase...');
            }

            if (event.type === 'done') {
              setToolStatus(null);
              setConversationId(event.conversationId);
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
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: 'assistant',
                  content: `Error: ${event.content}`,
                },
              ]);
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
        <ChatMessages
          messages={messages}
          streamingContent={streamingContent}
          toolStatus={toolStatus}
        />
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  );
}
