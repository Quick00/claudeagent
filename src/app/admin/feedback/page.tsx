'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface FeedbackRow {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  image: { id: string; filename: string } | null;
}

export default function AdminFeedbackPage() {
  const { status } = useSession();
  const router = useRouter();
  const [posts, setPosts] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'TODO' | 'DONE' | 'ALL'>('TODO');

  useEffect(() => {
    fetch('/api/admin/feedback')
      .then((res) => {
        if (res.status === 403) {
          setError('Forbidden');
          return [];
        }
        if (!res.ok) throw new Error('Failed to fetch feedback');
        return res.json();
      })
      .then(setPosts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleMarkDone = async (id: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DONE' }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReopen = async (id: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'TODO' }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (error === 'Forbidden') router.replace('/');
  }, [status, error, router]);

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') return null;
  if (error === 'Forbidden') return null;

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  const filtered = posts.filter((p) => filter === 'ALL' || p.status === filter);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-5xl rounded-lg bg-white p-8 shadow-md dark:bg-gray-900 dark:shadow-gray-900">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Feedback</h1>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {(['TODO', 'DONE', 'ALL'] as const).map((value) => {
              const count = value === 'ALL' ? posts.length : posts.filter((p) => p.status === value).length;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === value
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {value === 'ALL' ? 'All' : value === 'TODO' ? 'To Do' : 'Done'}
                  <span className="ml-1.5 text-gray-400 dark:text-gray-500">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {posts.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No feedback submissions yet.</p>
        ) : (
          <div className="space-y-4">
            {filtered.map((post) => (
              <div
                key={post.id}
                className={`rounded-lg border p-4 ${
                  post.status === 'TODO'
                    ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950'
                    : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === post.id ? null : post.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base">{post.type === 'FEATURE_REQUEST' ? '\u{1F4A1}' : '\u{1F41B}'}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          post.status === 'TODO'
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                            : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        }`}
                      >
                        {post.status === 'TODO' ? 'To Do' : 'Done'}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{post.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      by <span className="font-medium">{post.user.name}</span> ({post.user.email})
                      {' — '}
                      {new Date(post.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="ml-4">
                    {post.status === 'TODO' ? (
                      <button
                        onClick={() => handleMarkDone(post.id)}
                        disabled={updatingId === post.id}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {updatingId === post.id ? 'Updating...' : 'Mark as Done'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReopen(post.id)}
                        disabled={updatingId === post.id}
                        className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                      >
                        {updatingId === post.id ? 'Updating...' : 'Reopen'}
                      </button>
                    )}
                  </div>
                </div>
                {expandedId === post.id && (
                  <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                    <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{post.description}</p>
                    {post.image && (
                      <div className="mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/upload/${post.image.id}`}
                          alt={post.image.filename}
                          className="max-h-64 rounded-md border border-gray-200 dark:border-gray-700"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No {filter === 'TODO' ? 'to-do' : filter === 'DONE' ? 'done' : ''} feedback.</p>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            &larr; Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}
