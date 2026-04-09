'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import Link from "next/link";

interface FlagRow {
  id: string;
  reason: string;
  status: string;
  adminResponse: string | null;
  createdAt: string;
  respondedAt: string | null;
  conversation: { id: string; title: string };
  user: { id: string; name: string; email: string };
  admin: { id: string; name: string } | null;
}

export default function AdminFlagsPage() {
  const { data: session, status } = useSession();
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<'PENDING' | 'RESPONDED' | 'ALL'>('PENDING');

  useEffect(() => {
    fetch('/api/flags')
      .then((res) => {
        if (res.status === 403) {
          setError('Forbidden');
          return [];
        }
        if (!res.ok) throw new Error('Failed to fetch flags');
        return res.json();
      })
      .then(setFlags)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleRespond = async (flagId: string) => {
    if (!responseText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/flags/${flagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminResponse: responseText }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setFlags((prev) =>
        prev.map((f) =>
          f.id === flagId
            ? {
                ...f,
                status: updated.status,
                adminResponse: updated.adminResponse,
                respondedAt: updated.respondedAt,
                admin: { id: (session?.user as Record<string, string>)?.id, name: session?.user?.name || 'Admin' },
              }
            : f
        )
      );
      setRespondingTo(null);
      setResponseText('');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  if (error === 'Forbidden') {
    redirect('/');
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-5xl rounded-lg bg-white p-8 shadow-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Flagged Conversations</h1>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {(['PENDING', 'RESPONDED', 'ALL'] as const).map((value) => {
              const count = value === 'ALL' ? flags.length : flags.filter((f) => f.status === value).length;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {value === 'ALL' ? 'All' : value === 'PENDING' ? 'Pending' : 'Responded'}
                  <span className="ml-1.5 text-gray-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {flags.length === 0 ? (
          <p className="text-gray-500">No flagged conversations yet.</p>
        ) : (
          <div className="space-y-4">
            {flags.filter((f) => filter === 'ALL' || f.status === filter).map((flag) => (
              <div
                key={flag.id}
                className={`rounded-lg border p-4 ${
                  flag.status === 'PENDING' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          flag.status === 'PENDING'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {flag.status}
                      </span>
                      <Link
                        href={`/conversation/${flag.conversation.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {flag.conversation.title}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Flagged by <span className="font-medium">{flag.user.name}</span> ({flag.user.email})
                      {' — '}
                      {new Date(flag.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {flag.reason && (
                      <p className="mt-2 text-sm text-gray-700">
                        <span className="font-medium">Reason:</span> {flag.reason}
                      </p>
                    )}
                    {flag.adminResponse && (
                      <div className="mt-3 rounded-md border border-green-200 bg-white p-3">
                        <div className="text-xs font-medium text-green-700">
                          Response by {flag.admin?.name || 'Admin'}
                          {flag.respondedAt && (
                            <span className="ml-2 font-normal text-gray-400">
                              {new Date(flag.respondedAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{flag.adminResponse}</p>
                      </div>
                    )}
                  </div>
                  <div className="ml-4">
                    {flag.status === 'PENDING' && (
                      <button
                        onClick={() => {
                          setRespondingTo(respondingTo === flag.id ? null : flag.id);
                          setResponseText('');
                        }}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Respond
                      </button>
                    )}
                  </div>
                </div>
                {respondingTo === flag.id && (
                  <div className="mt-3 border-t border-red-200 pt-3">
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Write your response to the user..."
                      className="w-full resize-none rounded-md border border-gray-200 p-2 text-sm focus:border-blue-300 focus:outline-none"
                      rows={3}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => { setRespondingTo(null); setResponseText(''); }}
                        className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRespond(flag.id)}
                        disabled={!responseText.trim() || submitting}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {submitting ? 'Sending...' : 'Send Response'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {flags.length > 0 && flags.filter((f) => filter === 'ALL' || f.status === filter).length === 0 && (
              <p className="text-gray-500">No {filter.toLowerCase()} flags.</p>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-gray-200 pt-4">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}
