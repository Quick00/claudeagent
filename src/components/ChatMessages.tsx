'use client';

import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  toolStatus: string | null;
  isLoading: boolean;
  onSendSuggestion: (message: string) => void;
}

const DEFAULT_SUGGESTIONS = [
  'How does user registration work?',
  'What badge types are available?',
  'How does the HubSpot integration work?',
  'What happens when someone checks in at an event?',
];

export default function ChatMessages({
  messages,
  streamingContent,
  toolStatus,
  isLoading,
  onSendSuggestion,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolStatus, isLoading]);

  // Load recent conversation titles as suggestions
  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((conversations: { title: string }[]) => {
        const titles = conversations
          .slice(0, 4)
          .map((c) => c.title)
          .filter((t) => t.length > 10 && t.length < 100);
        setRecentQuestions(titles);
      })
      .catch(() => {});
  }, []);

  if (messages.length === 0 && !streamingContent && !toolStatus && !isLoading) {
    const suggestions = [...new Set(recentQuestions.length > 0 ? recentQuestions : DEFAULT_SUGGESTIONS)].slice(0, 4);

    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-2xl px-6">
          <h2 className="mb-2 text-center text-xl font-medium text-gray-800">
            Codebase Q&A
          </h2>
          <p className="mb-8 text-center text-sm text-gray-400">
            Ask a question about how the product works
          </p>
          <div className="grid grid-cols-2 gap-3">
            {suggestions.map((q, i) => (
              <button
                key={`${i}-${q}`}
                onClick={() => onSendSuggestion(q)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50"
              >
                {q}
              </button>
            ))}
          </div>
          {recentQuestions.length > 0 && (
            <p className="mt-4 text-center text-xs text-gray-400">
              Based on recent questions
            </p>
          )}
        </div>
      </div>
    );
  }

  const showThinking = isLoading && !streamingContent && !toolStatus;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        {(showThinking || (toolStatus && !streamingContent)) && (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400" />
            </div>
            <span className="text-sm text-gray-500">
              {toolStatus || 'Thinking...'}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
