'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, X } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { EmptyState } from '@/components/shared/EmptyState';
import { useConfirm } from '@/hooks/use-confirm';
import { ROUTES, isActiveHref } from '@/lib/navigation';
import { useConversations } from './ConversationsProvider';

/**
 * The conversation list as it appears inside the shell sidebar.
 *
 * Rows are real `<Link>`s so the browser, prefetching and middle-click all
 * behave; selecting a conversation is a navigation, not a state change.
 *
 * `notificationConvIds` comes from the shell's single notification poller —
 * this component never polls.
 */
export function ConversationList({
  notificationConvIds = [],
}: {
  notificationConvIds?: string[];
}) {
  const { conversations, loading, remove } = useConversations();
  const confirm = useConfirm();
  const pathname = usePathname();
  const [filter, setFilter] = useState('');

  const unread = useMemo(() => new Set(notificationConvIds), [notificationConvIds]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(needle));
  }, [conversations, filter]);

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: 'Delete this conversation?',
      description: `"${title}" and its messages will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (ok) await remove(id);
  };

  if (loading && conversations.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {[0, 1, 2, 3, 4].map((i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No conversations yet"
        description="Ask your first question to start one."
      />
    );
  }

  return (
    <SidebarGroup className="min-h-0 flex-1 gap-2 overflow-y-auto">
      <SidebarInput
        type="search"
        aria-label="Filter conversations"
        placeholder="Filter conversations"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <SidebarGroupContent>
        {visible.length === 0 ? (
          <EmptyState title="No matches" description={`Nothing matches "${filter.trim()}".`} />
        ) : (
          <SidebarMenu>
            {visible.map((conv) => (
              <SidebarMenuItem key={conv.id}>
                <SidebarMenuButton
                  asChild
                  isActive={isActiveHref(ROUTES.chat(conv.id), pathname)}
                  className="pr-8"
                >
                  <Link href={ROUTES.chat(conv.id)}>
                    <span className="truncate">{conv.title}</span>
                    {unread.has(conv.id) && (
                      <>
                        <span
                          aria-hidden
                          className="ml-auto size-2 shrink-0 rounded-full bg-destructive"
                        />
                        <span className="sr-only">Unread replies</span>
                      </>
                    )}
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuAction
                  showOnHover
                  onClick={() => handleDelete(conv.id, conv.title)}
                >
                  <X />
                  <span className="sr-only">{`Delete conversation: ${conv.title}`}</span>
                </SidebarMenuAction>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
