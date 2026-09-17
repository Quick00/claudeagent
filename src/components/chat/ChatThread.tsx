'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import LinkClaudeModal from '@/components/LinkClaudeModal';
import { AdminSendBlockedNotice, AdminViewBanner } from './AdminViewBanner';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatThreadSkeleton } from './ChatThreadSkeleton';
import { useConversations } from './ConversationsProvider';
import { useConversation } from './useConversation';

/**
 * One conversation. The route keys this on the conversation id, so switching
 * threads remounts it; `/chat` renders it unkeyed so the first answer can swap
 * the URL underneath without losing the optimistic bubble.
 */
export function ChatThread({ initialConversationId }: { initialConversationId: string | null }) {
  const {
    conversationId,
    messages,
    streamingSegments,
    toolStatus,
    mcpNotices,
    isLoading,
    initialLoading,
    claudeLinked,
    ownership,
    flags,
    hasPendingFlag,
    flagSubmitting,
    send,
    flag,
    refreshClaudeStatus,
  } = useConversation(initialConversationId);
  const { pendingConversationId } = useConversations();
  const [showLinkModal, setShowLinkModal] = useState(false);

  // The router keeps the outgoing route rendered for the whole client
  // navigation, and `chat/[id]/loading.tsx` cannot cover the gap: the shell
  // layout reads cookies, so its fallback is never prefetched (see the
  // loading.js caveat in the Next docs). Without this, clicking a
  // conversation leaves the new-chat empty state on screen for the round
  // trip. The skeleton shown here is the one `loading.tsx` renders, so the
  // user sees a single continuous skeleton rather than three states.
  const navigatingAway =
    pendingConversationId !== null && pendingConversationId !== conversationId;

  if (initialLoading || navigatingAway) return <ChatThreadSkeleton />;

  const isOwner = !ownership || ownership.isOwner;

  if (claudeLinked === false && isOwner) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-8">
        <EmptyState
          icon={Link2}
          title="Link your Claude account"
          description="To start asking questions, link your Claude account. This requires a Claude Max, Pro, or Team subscription."
          action={<Button onClick={() => setShowLinkModal(true)}>Link Claude Account</Button>}
        />
        <LinkClaudeModal
          open={showLinkModal}
          onOpenChange={setShowLinkModal}
          onLinked={() => {
            setShowLinkModal(false);
            refreshClaudeStatus();
          }}
        />
      </div>
    );
  }

  const isAdminSend = !!(ownership && !ownership.isOwner && ownership.isAdmin);
  const blockedReason = !ownership?.ownerHasClaudeToken
    ? ('no-token' as const)
    : !ownership.hasSession
      ? ('not-started' as const)
      : null;
  const adminBlocked = isAdminSend && blockedReason !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conversationId && (
        <ChatHeader
          conversationId={conversationId}
          canFlag={isOwner}
          hasPendingFlag={hasPendingFlag}
          flagSubmitting={flagSubmitting}
          onFlag={flag}
        />
      )}
      {isAdminSend && <AdminViewBanner ownerName={ownership.ownerName} />}
      <ChatMessages
        messages={messages}
        streamingSegments={streamingSegments}
        toolStatus={toolStatus}
        mcpNotices={mcpNotices}
        isLoading={isLoading}
        onSendSuggestion={send}
        flags={flags}
        isOwner={isOwner}
      />
      {adminBlocked && <AdminSendBlockedNotice reason={blockedReason} />}
      <ChatComposer onSend={send} disabled={isLoading || adminBlocked} />
    </div>
  );
}
