'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/navigation';
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
 * second portal root.
 */
export default function AdminUserConversationsPanel({ userId }: AdminUserConversationsPanelProps) {
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}/conversations`)
      .then((res) => {
        if (res.status === 403) { setError('Forbidden'); return []; }
        if (!res.ok) throw new Error('Failed to load conversations');
        return res.json();
      })
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;

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
