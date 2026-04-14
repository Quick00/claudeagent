'use client';

import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

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
  createdAt?: string;
  attachments?: Attachment[];
  sentByAdmin?: { id: string; name: string } | null;
  seenByOwner?: boolean;
}

interface Flag {
  id: string;
  status: string;
  adminResponse: string | null;
  respondedAt: string | null;
  admin: { name: string } | null;
}

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  toolStatus: string | null;
  isLoading: boolean;
  onSendSuggestion: (message: string) => void;
  flags: Flag[];
  isOwner?: boolean;
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
  flags,
  isOwner = true,
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
          <h2 className="mb-2 text-center text-xl font-medium text-gray-800 dark:text-gray-100">
            Codebase Q&A
          </h2>
          <p className="mb-8 text-center text-sm text-gray-400 dark:text-gray-500">
            Ask a question about how the product works
          </p>
          <div className="grid grid-cols-2 gap-3">
            {suggestions.map((q, i) => (
              <button
                key={`${i}-${q}`}
                onClick={() => onSendSuggestion(q)}
                className="rounded-xl border cursor-pointer border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600 dark:hover:bg-gray-700"
              >
                {q}
              </button>
            ))}
          </div>
          {recentQuestions.length > 0 && (
            <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
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
        {(() => {
          type TimelineItem =
            | { kind: 'message'; ts: number; message: Message }
            | { kind: 'flag'; ts: number; flag: Flag };

          const items: TimelineItem[] = [];

          for (const m of messages) {
            items.push({
              kind: 'message',
              ts: m.createdAt ? new Date(m.createdAt).getTime() : 0,
              message: m,
            });
          }
          for (const f of flags) {
            if (f.status === 'RESPONDED' && f.adminResponse && f.respondedAt) {
              items.push({
                kind: 'flag',
                ts: new Date(f.respondedAt).getTime(),
                flag: f,
              });
            }
          }
          items.sort((a, b) => a.ts - b.ts);

          return items.map((item) => {
            if (item.kind === 'message') {
              const m = item.message;
              const unseenByOwner = isOwner && m.seenByOwner === false;
              if (m.sentByAdmin) {
                return (
                  <div key={m.id} className="animate-message-in">
                    <MessageBubble
                      role="admin"
                      content={m.content}
                      adminName={m.sentByAdmin.name}
                      timestamp={m.createdAt}
                    />
                    {unseenByOwner && (
                      <div className="mt-1 text-right text-xs text-amber-600 dark:text-amber-400">new</div>
                    )}
                  </div>
                );
              }
              return (
                <div key={m.id} className="animate-message-in">
                  <MessageBubble role={m.role} content={m.content} attachments={m.attachments} />
                  {unseenByOwner && (
                    <div className="mt-1 text-right text-xs text-amber-600 dark:text-amber-400">new</div>
                  )}
                </div>
              );
            }

            return (
              <div key={`flag-${item.flag.id}`} className="animate-message-in">
                <MessageBubble
                  role="admin"
                  content={item.flag.adminResponse!}
                  adminName={item.flag.admin?.name}
                  timestamp={item.flag.respondedAt ?? undefined}
                />
              </div>
            );
          });
        })()}
        {streamingContent && (
          <div className="animate-message-in">
            <MessageBubble role="assistant" content={streamingContent} />
          </div>
        )}
        {(showThinking || (toolStatus && !streamingContent)) && (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400" />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {toolStatus || 'Thinking...'}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
