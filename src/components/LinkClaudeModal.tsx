'use client';

import { useState, useCallback } from 'react';

interface LinkClaudeModalProps {
  onClose: () => void;
  onLinked: () => void;
}

export default function LinkClaudeModal({ onClose, onLinked }: LinkClaudeModalProps) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleSubmit = async () => {
    const cleaned = token.replace(/\s+/g, '');
    if (!cleaned) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/claude/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleaned }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save token');
      }

      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Link your Claude account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">&times;</button>
        </div>

        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          To use this app, you need a Claude subscription (Max, Pro, or Team) and a setup token.
          Follow the steps below to generate one.
        </p>

        <div className="mb-5 space-y-4">
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Step 1: Install Claude Code</h3>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              Open a terminal on your computer and run:
            </p>
            <div className="flex items-center justify-between rounded-md bg-gray-900 px-3 py-2">
              <code className="text-sm text-green-400">curl -fsSL https://claude.ai/install.sh | bash</code>
              <button
                onClick={() => copyToClipboard('curl -fsSL https://claude.ai/install.sh | bash', 'install')}
                className="ml-2 shrink-0 text-xs text-gray-400 hover:text-white"
              >
                {copied === 'install' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Step 2: Generate a token</h3>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              Run this command and follow the instructions in your browser:
            </p>
            <div className="flex items-center justify-between rounded-md bg-gray-900 px-3 py-2">
              <code className="text-sm text-green-400">claude setup-token</code>
              <button
                onClick={() => copyToClipboard('claude setup-token', 'token')}
                className="ml-2 shrink-0 text-xs text-gray-400 hover:text-white"
              >
                {copied === 'token' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              This will open a browser window where you log in with your Claude account.
              After authorizing, a long token string will be displayed in your terminal.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Step 3: Paste your token</h3>
            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              Copy the token from your terminal and paste it below:
            </p>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Claude token here..."
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !token.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Link Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
