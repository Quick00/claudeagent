'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import LinkClaudeModal from '@/components/LinkClaudeModal';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [claudeStatus, setClaudeStatus] = useState<{ linked: boolean; email: string | null } | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const fetchStatus = () => {
    fetch('/api/auth/claude/status')
      .then((res) => res.json())
      .then(setClaudeStatus)
      .catch(console.error);
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      await fetch('/api/auth/claude/unlink', { method: 'POST' });
      setClaudeStatus({ linked: false, email: null });
    } catch (err) {
      console.error('Failed to unlink:', err);
    } finally {
      setUnlinking(false);
    }
  };

  const handleLinked = () => {
    setShowModal(false);
    fetchStatus();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Settings</h1>

        <div className="space-y-4">
          <div>
            <h2 className="mb-1 text-sm font-medium text-gray-700">App Account</h2>
            <p className="text-sm text-gray-500">{session?.user?.email}</p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h2 className="mb-3 text-sm font-medium text-gray-700">Claude Account</h2>

            {claudeStatus === null ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : claudeStatus.linked ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700">Connected</span>
                  {claudeStatus.email && (
                    <span className="text-sm text-gray-400">({claudeStatus.email})</span>
                  )}
                </div>
                <button
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {unlinking ? 'Unlinking...' : 'Unlink Claude Account'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                  <span className="text-sm text-gray-500">Not connected</span>
                </div>
                <p className="text-xs text-gray-400">
                  Link your Claude account to start asking questions. Requires a Claude Max, Pro, or Team subscription.
                </p>
                <button
                  onClick={() => setShowModal(true)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Link Claude Account
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </a>
        </div>
      </div>

      {showModal && (
        <LinkClaudeModal
          onClose={() => setShowModal(false)}
          onLinked={handleLinked}
        />
      )}
    </div>
  );
}
