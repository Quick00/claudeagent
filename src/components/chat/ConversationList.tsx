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
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { useConfirm } from '@/hooks/use-confirm';
import { ROUTES, isActiveHref } from '@/lib/navigation';
import { useConversations } from './ConversationsProvider';

/**
 * Placeholder row widths. Fixed rather than random: `SidebarMenuSkeleton`
 * picks its own width with `Math.random()`, which makes the server HTML and
 * the first client render disagree and logs a hydration error on every cold
 * load. These keep the ragged look without the mismatch.
 */
const SKELETON_WIDTHS = ['72%', '54%', '84%', '61%', '77%'];

/**
 * The conversation list as it appears inside the shell sidebar.
 *
 * Rows are real `<Link>`s so the browser, prefetching and middle-click all
 * behave; selecting a conversation is a navigation, not a state change.
 *
 * `notificationConvIds` comes from the shell's single notification poller —
 * this component never polls.
 *
 * `onNavigate` fires when a conversation is picked, so the mobile shell can
 * close its offcanvas sheet.
 */
export function ConversationList({
  notificationConvIds = [],
  onNavigate,
}: {
  notificationConvIds?: string[];
  onNavigate?: () => void;
}) {
  const { conversations, loading, remove, beginNavigation } = useConversations();
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
            {SKELETON_WIDTHS.map((width) => (
              <SidebarMenuItem key={width}>
                <div className="flex h-8 items-center px-2">
                  <Skeleton className="h-4" style={{ width }} />
                </div>
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
            {visible.map((conv) => {
              const isActive = isActiveHref(ROUTES.chat(conv.id), pathname);
              return (
              <SidebarMenuItem key={conv.id}>
                <SidebarMenuButton asChild isActive={isActive} className="pr-8">
                  <Link
                    href={ROUTES.chat(conv.id)}
                    onClick={() => {
                      // Skip on the open row: the pathname would not change,
                      // so the pending state would never resolve.
                      if (!isActive) beginNavigation(conv.id);
                      onNavigate?.();
                    }}
                  >
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
              );
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
