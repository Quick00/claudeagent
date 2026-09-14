'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageBubble } from './MessageBubble';
import { useConversations } from './ConversationsProvider';
import type { Flag, Message } from './useConversation';

export type ChatMessagesProps = {
  messages: Message[];
  streamingContent: string;
  toolStatus: string | null;
  isLoading: boolean;
  onSendSuggestion: (message: string) => void;
  flags: Flag[];
  isOwner?: boolean;
};

const DEFAULT_SUGGESTIONS = [
  'How does user registration work?',
  'What badge types are available?',
  'How does the HubSpot integration work?',
  'What happens when someone checks in at an event?',
];

// Always-shown chips — surface the easter eggs regardless of recent questions.
const PINNED_SUGGESTIONS = ["Who's the nicest consultant?", 'How good is the Sales team?'];

type TimelineItem =
  | { kind: 'message'; ts: number; message: Message }
  | { kind: 'flag'; ts: number; flag: Flag };

/** Messages and answered flags, interleaved in the order they happened. */
function buildTimeline(messages: Message[], flags: Flag[]): TimelineItem[] {
  const items: TimelineItem[] = messages.map((message) => ({
    kind: 'message',
    ts: message.createdAt ? new Date(message.createdAt).getTime() : 0,
    message,
  }));
  for (const flag of flags) {
    if (flag.status === 'RESPONDED' && flag.adminResponse && flag.respondedAt) {
      items.push({ kind: 'flag', ts: new Date(flag.respondedAt).getTime(), flag });
    }
  }
  return items.sort((a, b) => a.ts - b.ts);
}

export function ChatMessages({
  messages,
  streamingContent,
  toolStatus,
  isLoading,
  onSendSuggestion,
  flags,
  isOwner = true,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { conversations } = useConversations();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolStatus, isLoading]);

  // Recent conversation titles make better starter chips than the canned list.
  const recentQuestions = useMemo(
    () =>
      conversations
        .slice(0, 4)
        .map((c) => c.title)
        .filter((t) => t.length > 10 && t.length < 100),
    [conversations],
  );

  const timeline = useMemo(() => buildTimeline(messages, flags), [messages, flags]);

  if (messages.length === 0 && !streamingContent && !toolStatus && !isLoading) {
    const rest = [...new Set(recentQuestions.length > 0 ? recentQuestions : DEFAULT_SUGGESTIONS)]
      .filter((q) => !PINNED_SUGGESTIONS.includes(q))
      .slice(0, Math.max(0, 4 - PINNED_SUGGESTIONS.length));
    const suggestions = [...PINNED_SUGGESTIONS, ...rest];

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <EmptyState
          className="w-full max-w-2xl"
          icon={MessagesSquare}
          title="Codebase Q&A"
          description="Ask a question about how the product works"
          action={
            <div className="w-full">
              <div className="grid gap-3 sm:grid-cols-2">
                {suggestions.map((q, i) => (
                  <Button
                    key={`${i}-${q}`}
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-4 py-3 text-left"
                    onClick={() => onSendSuggestion(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
              {recentQuestions.length > 0 && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Based on recent questions
                </p>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const showThinking = isLoading && !streamingContent && !toolStatus;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {timeline.map((item) => {
          if (item.kind === 'flag') {
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
          }

          const m = item.message;
          const unseenByOwner = isOwner && m.seenByOwner === false;
          return (
            <div key={m.id} className="animate-message-in">
              {m.sentByAdmin ? (
                <MessageBubble
                  role="admin"
                  content={m.content}
                  adminName={m.sentByAdmin.name}
                  timestamp={m.createdAt}
                />
              ) : (
                <MessageBubble role={m.role} content={m.content} attachments={m.attachments} />
              )}
              {unseenByOwner && <p className="mt-1 text-right text-xs text-warning">new</p>}
            </div>
          );
        })}

        {streamingContent && (
          <div className="animate-message-in">
            <MessageBubble role="assistant" content={streamingContent} />
          </div>
        )}

        {(showThinking || toolStatus) && (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex gap-1" aria-hidden>
              <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="size-2 animate-bounce rounded-full bg-primary" />
            </div>
            <span className="text-sm text-muted-foreground" role="status">
              {toolStatus || 'Thinking...'}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
