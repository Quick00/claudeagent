'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ConvRow {
  id: string;
  title: string;
  updatedAt: string;
  claudeSessionId: string | null;
}

interface AdminUserConversationsPanelProps {
  userId: string;
}

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

  if (loading) return <p className="text-gray-400 dark:text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">This user has no conversations yet.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map((c) => (
        <li key={c.id} className="py-3">
          <Link
            href={`/conversation/${c.id}`}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {c.title || '(untitled)'}
          </Link>
          <span className="ml-3 text-xs text-gray-400">
            {new Date(c.updatedAt).toLocaleString('en-GB')}
            {!c.claudeSessionId && ' · not started'}
          </span>
        </li>
      ))}
    </ul>
  );
}
