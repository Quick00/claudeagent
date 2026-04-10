'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import LinkClaudeModal from '@/components/LinkClaudeModal';
import { useTheme } from '@/components/ThemeProvider';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [claudeStatus, setClaudeStatus] = useState<{ linked: boolean; email: string | null } | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { preference, setPreference } = useTheme();

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
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md dark:bg-gray-900 dark:shadow-gray-900">
        <h1 className="mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

        <div className="space-y-4">
          <div>
            <h2 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">App Account</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{session?.user?.email}</p>
          </div>

          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Claude Account</h2>

            {claudeStatus === null ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">Loading...</p>
            ) : claudeStatus.linked ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Connected</span>
                  {claudeStatus.email && (
                    <span className="text-sm text-gray-400 dark:text-gray-500">({claudeStatus.email})</span>
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
                  <span className="text-sm text-gray-500 dark:text-gray-400">Not connected</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
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

        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Appearance</h2>
          <div className="flex gap-2">
            {([
              { value: 'system' as const, label: 'System', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
              { value: 'light' as const, label: 'Light', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
              { value: 'dark' as const, label: 'Dark', icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' },
            ]).map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => setPreference(value)}
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                  preference === value
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                </svg>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            &larr; Back to chat
          </Link>
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
