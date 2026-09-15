'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronDown, MessagesSquare, Search } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { AdminTableSkeleton } from '@/components/admin/AdminTableSkeleton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format-date';
import { ROUTES } from '@/lib/navigation';
import { qk } from '@/lib/query-keys';

interface ConversationRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  user: { id: string; name: string; email: string };
}

const ALL_OWNERS = 'all';

/**
 * Every conversation in the system, across all users. Rows link into
 * `/chat/[id]`, which already lets an admin read a conversation and reply
 * into it — so this page is a way in, not a second viewer.
 *
 * Search and the owner filter run over the fetched list rather than the
 * server, matching the flags and feedback panels: the rows are small and
 * filtering locally keeps typing instant.
 */
export default function AdminConversationsPanel() {
  const [search, setSearch] = useState('');
  const [ownerId, setOwnerId] = useState<string>(ALL_OWNERS);

  const {
    data: conversations = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.conversations.adminList(),
    queryFn: ({ signal }) => apiFetch<ConversationRow[]>('/api/admin/conversations', { signal }),
  });

  // Owners come from the rows themselves rather than a second request: a user
  // with no conversations has nothing to filter to anyway.
  const owners = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const c of conversations) byId.set(c.user.id, { id: c.user.id, name: c.user.name });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (ownerId !== ALL_OWNERS && c.user.id !== ownerId) return false;
      if (!needle) return true;
      return (
        c.title.toLowerCase().includes(needle) ||
        c.user.name.toLowerCase().includes(needle) ||
        c.user.email.toLowerCase().includes(needle)
      );
    });
  }, [conversations, ownerId, search]);

  const showSkeleton = useDeferredSkeleton(isPending);

  if (isPending) return showSkeleton ? <AdminTableSkeleton columns={4} /> : null;

  const selectedOwner = owners.find((o) => o.id === ownerId);

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader
          title="Conversations"
          description="Every conversation across all users. Open one to read it or reply."
        />
      </RiseIn>

      <RiseIn delay={0.06}>
        {isError ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No conversations yet"
            description="Conversations appear here as soon as someone starts one."
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <InputGroup className="min-w-0 flex-1">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title or person..."
                  aria-label="Search conversations"
                />
              </InputGroup>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    {selectedOwner ? selectedOwner.name : 'All users'}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setOwnerId(ALL_OWNERS)}>
                    All users
                  </DropdownMenuItem>
                  {owners.map((owner) => (
                    <DropdownMenuItem key={owner.id} onSelect={() => setOwnerId(owner.id)}>
                      {owner.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No conversations match"
                description="Try a different search or clear the owner filter."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((conversation) => (
                    <TableRow key={conversation.id}>
                      <TableCell className="font-medium">
                        <Link href={ROUTES.chat(conversation.id)} className="hover:underline">
                          {conversation.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div>{conversation.user.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {conversation.user.email}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {conversation.messageCount}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(conversation.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </RiseIn>
    </PageContainer>
  );
}
