'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, MoreHorizontal, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { useConfirm } from '@/hooks/use-confirm';
import {
  RECENCY_BUCKETS,
  RECENCY_BUCKET_LABELS,
  recencyBucket,
  type RecencyBucket,
} from '@/lib/format-date';
import { ROUTES, isActiveHref } from '@/lib/navigation';
import { useConversations, type Conversation } from './ConversationsProvider';

/**
 * Placeholder row widths. Fixed rather than random: `SidebarMenuSkeleton`
 * picks its own width with `Math.random()`, which makes the server HTML and
 * the first client render disagree and logs a hydration error on every cold
 * load. These keep the ragged look without the mismatch.
 */
const SKELETON_WIDTHS = ['72%', '54%', '84%', '61%', '77%'];

/**
 * Splits the list into Today / Yesterday / … in order, dropping buckets that
 * caught nothing so no heading stands over an empty group. The rows arrive
 * newest-first from the API, so each bucket keeps that order for free.
 */
function groupByRecency(conversations: Conversation[]) {
  const byBucket = new Map<RecencyBucket, Conversation[]>();
  for (const conversation of conversations) {
    const bucket = recencyBucket(conversation.updatedAt);
    const existing = byBucket.get(bucket);
    if (existing) existing.push(conversation);
    else byBucket.set(bucket, [conversation]);
  }
  return RECENCY_BUCKETS.flatMap((bucket) => {
    const items = byBucket.get(bucket);
    return items ? [{ bucket, label: RECENCY_BUCKET_LABELS[bucket], items }] : [];
  });
}

/**
 * The rename editor, in place of the row it replaces.
 *
 * Rendering it *instead of* the `<Link>` rather than on top of it is what
 * makes this safe: while you are typing there is no anchor in the row at all,
 * so no keystroke or stray click can navigate away mid-edit.
 */
function RenameRow({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  onSubmit: (next: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  /**
   * Set once the edit is finished or a save is in flight. Both endings can
   * arrive twice: Enter submits and then the input blurs while the request is
   * still open, and Escape closes the editor which also blurs it. Without
   * this, the first sends a second identical PATCH and the second saves the
   * edit Escape just abandoned.
   */
  const settled = useRef(false);

  const save = async () => {
    if (settled.current) return;
    const next = value.trim();
    if (!next || next === title) {
      settled.current = true;
      onClose();
      return;
    }
    settled.current = true;
    setSaving(true);
    const ok = await onSubmit(next);
    setSaving(false);
    // On failure the editor stays open with the text intact so the rename can
    // be retried without typing it again; `rename` has already toasted.
    if (ok) onClose();
    else settled.current = false;
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <SidebarInput
        autoFocus
        aria-label={`Rename ${title}`}
        value={value}
        disabled={saving}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            settled.current = true;
            onClose();
          }
        }}
      />
    </form>
  );
}

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
  const { conversations, loading, loadFailed, remove, rename, beginNavigation } =
    useConversations();
  const confirm = useConfirm();
  const pathname = usePathname();
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const unread = useMemo(() => new Set(notificationConvIds), [notificationConvIds]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(needle));
  }, [conversations, filter]);

  // Filtering narrows the same list, so the groups stay. With titles this
  // similar — several are near-duplicates of each other — the date heading is
  // often the only thing telling two matches apart, which is exactly when a
  // flat "Results" list would be least helpful.
  const groups = useMemo(() => groupByRecency(visible), [visible]);

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

  // A failed list load must not read as "you have no conversations".
  if (loadFailed && conversations.length === 0) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load conversations"
        description="Something went wrong reaching the server. Try again in a moment."
      />
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
    // `w-0 min-w-full` is what lets a title ellipsise at all. The shell puts
    // this list inside a Radix ScrollArea, whose viewport child is
    // `display: table; min-width: 100%` — a shrink-to-fit box. A `truncate`d
    // title is `white-space: nowrap`, so its min-content width is the whole
    // string; the table grew to fit the longest one (685px in a 287px panel),
    // every `w-full` underneath resolved against *that*, and the viewport's
    // overflow-x simply chopped the text mid-character. Declaring width 0
    // stops this subtree from inflating the table, and min-width:100% then
    // stretches it back to the panel — so the row is finally narrower than
    // its text and the ellipsis appears.
    //
    // No `overflow-y-auto` here: `ChatPanel` already wraps this in a
    // ScrollArea. A second scroller nested in the first steals the wheel and
    // — because a sticky element sticks to its nearest scrolling ancestor —
    // would pin the group headings inside a box that never scrolls.
    <SidebarGroup className="w-0 min-w-full gap-2">
      <SidebarInput
        type="search"
        aria-label="Filter conversations"
        placeholder="Filter conversations"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {visible.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing matches "${filter.trim()}".`} />
      ) : (
        groups.map((group) => (
          <SidebarGroupContent key={group.bucket}>
            {/* Sticky so you can always see which stretch of time you are
                scrolling through in a list this long. */}
            <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar">
              {group.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((conv) => {
                const isActive = isActiveHref(ROUTES.chat(conv.id), pathname);
                if (editingId === conv.id) {
                  return (
                    <SidebarMenuItem key={conv.id}>
                      <RenameRow
                        title={conv.title}
                        onSubmit={(next) => rename(conv.id, next)}
                        onClose={() => setEditingId(null)}
                      />
                    </SidebarMenuItem>
                  );
                }
                return (
                  <SidebarMenuItem key={conv.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      // pr-8 reserves the delete action's column permanently.
                      // The action only fades in on hover, but claiming the
                      // space up front stops every title re-truncating as the
                      // pointer moves down the list.
                      //
                      // The ::before bar is the only thing separating the open
                      // row from the one under the pointer: both otherwise
                      // land on bg-sidebar-accent.
                      className="pr-8 data-[active=true]:before:absolute data-[active=true]:before:inset-y-1 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary"
                    >
                      <Link
                        href={ROUTES.chat(conv.id)}
                        onClick={() => {
                          // Skip on the open row: the pathname would not
                          // change, so the pending state would never resolve.
                          if (!isActive) beginNavigation(conv.id);
                          onNavigate?.();
                        }}
                      >
                        {/* min-w-0 is what makes the ellipsis appear: a flex
                            item defaults to min-width:auto and overflows its
                            row instead of shrinking, so text-overflow never
                            has a constrained box to clip against. */}
                        <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                        {unread.has(conv.id) && (
                          <>
                            <span
                              aria-hidden
                              className="size-2 shrink-0 rounded-full bg-destructive"
                            />
                            <span className="sr-only">Unread replies</span>
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>
                    {/* A sibling of the Link, not a child of it, so
                        activating the trigger cannot navigate the row. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">{`Actions for ${conv.title}`}</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start" className="w-40">
                        <DropdownMenuItem onSelect={() => setEditingId(conv.id)}>
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          // Deferred past the menu's close: Radix returns
                          // focus to the trigger as it unmounts, which would
                          // otherwise land on top of the confirm dialog.
                          onSelect={() =>
                            setTimeout(() => void handleDelete(conv.id, conv.title), 0)
                          }
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        ))
      )}
    </SidebarGroup>
  );
}
