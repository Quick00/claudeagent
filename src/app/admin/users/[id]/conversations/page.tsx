'use client';

import { useEffect, useState, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ConvRow {
  id: string;
  title: string;
  updatedAt: string;
  claudeSessionId: string | null;
}

export default function AdminUserConversationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${id}/conversations`)
      .then((res) => {
        if (res.status === 403) { setError('Forbidden'); return []; }
        if (!res.ok) throw new Error('Failed to load conversations');
        return res.json();
      })
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (status === 'loading' || loading) {
    return <div className="flex h-screen items-center justify-center text-gray-400">Loading...</div>;
  }
  if (status === 'unauthenticated') { router.replace('/login'); return null; }
  if (error === 'Forbidden') { router.replace('/'); return null; }
  if (error) {
    return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-3xl rounded-lg bg-white p-8 shadow-md dark:bg-gray-900">
        <h1 className="mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">User Conversations</h1>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">This user has no conversations yet.</p>
        ) : (
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
        )}
        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link href="/admin/users" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            &larr; Back to users
          </Link>
        </div>
      </div>
    </div>
  );
}
