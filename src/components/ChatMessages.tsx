'use client';

import { useEffect, useRef } from 'react';
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
}

export default function ChatMessages({
  messages,
  streamingContent,
  toolStatus,
  isLoading,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolStatus, isLoading]);

  if (messages.length === 0 && !streamingContent && !toolStatus && !isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-medium">Codebase Q&A</h2>
          <p className="text-sm">
            Ask a question about how the product works
          </p>
        </div>
      </div>
    );
  }

  // Show thinking indicator when loading but no content or tool status yet
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
