'use client';

import type { MouseEvent } from 'react';
import { ConversationList } from '@/components/chat/ConversationList';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '../NotificationsProvider';
import type { PanelProps } from '../sections';

export function ChatPanel({ onNavigate }: PanelProps) {
  const { notificationConvIds } = useNotifications();

  // `ConversationList` owns its own rows (and its filter box), so the sheet is
  // closed by watching for a link click on the way out rather than by threading
  // an `onNavigate` prop through someone else's component.
  const closeOnLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    if ((event.target as HTMLElement).closest('a')) onNavigate();
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div onClickCapture={closeOnLinkClick}>
        <ConversationList notificationConvIds={notificationConvIds} />
      </div>
    </ScrollArea>
  );
}
