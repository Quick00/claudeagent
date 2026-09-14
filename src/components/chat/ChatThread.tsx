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
    streamingContent,
    toolStatus,
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
  const [showLinkModal, setShowLinkModal] = useState(false);

  if (initialLoading) return <ChatThreadSkeleton />;

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
        streamingContent={streamingContent}
        toolStatus={toolStatus}
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
