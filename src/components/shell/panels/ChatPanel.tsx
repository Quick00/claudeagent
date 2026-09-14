'use client';

import { ConversationList } from '@/components/chat/ConversationList';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '../NotificationsProvider';
import type { PanelProps } from '../sections';

export function ChatPanel({ onNavigate }: PanelProps) {
  const { notificationConvIds } = useNotifications();

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ConversationList notificationConvIds={notificationConvIds} onNavigate={onNavigate} />
    </ScrollArea>
  );
}
