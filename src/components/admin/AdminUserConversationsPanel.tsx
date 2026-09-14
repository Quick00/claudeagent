'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { ROUTES } from '@/lib/navigation';
import { qk } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/format-date';

interface ConvRow {
  id: string;
  title: string;
  updatedAt: string;
  claudeSessionId: string | null;
}

interface AdminUserConversationsPanelProps {
  userId: string;
}

/**
 * Renders inside the `DialogContent` that `AdminUsersPanel` opens for a row's
 * "Conversations" action — it owns no Dialog of its own, so it never opens a
 * second portal root. The parent only mounts this component while that
 * dialog is open (`{viewingConvos && <AdminUserConversationsPanel .../>}`),
 * so the query is naturally torn down — and stops fetching — the moment the
 * dialog closes; `enabled` guards the same thing defensively.
 */
export default function AdminUserConversationsPanel({ userId }: AdminUserConversationsPanelProps) {
  const {
    data: rows = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.users.conversations(userId),
    queryFn: () => apiFetch<ConvRow[]>(`/api/admin/users/${userId}/conversations`),
    enabled: Boolean(userId),
  });

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  if (isError) return <p className="text-sm text-destructive">{error.message}</p>;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No conversations"
        description="This user has no conversations yet."
      />
    );
  }

  return (
    <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
      {rows.map((c) => (
        <li key={c.id} className="py-3">
          <Link href={ROUTES.chat(c.id)} className="text-sm text-primary hover:underline">
            {c.title || '(untitled)'}
          </Link>
          <span className="ml-3 text-xs text-muted-foreground">
            {formatDateTime(c.updatedAt)}
            {!c.claudeSessionId && ' · not started'}
          </span>
        </li>
      ))}
    </ul>
  );
}
