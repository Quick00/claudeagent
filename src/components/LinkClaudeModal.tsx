'use client';

import { useState } from 'react';

type DetectedOs = 'mac' | 'windows';

function detectOs(): DetectedOs {
  if (typeof navigator === 'undefined') return 'mac';
  if (/Windows/i.test(navigator.userAgent)) return 'windows';
  return 'mac';
}

interface LinkClaudeModalProps {
  onClose: () => void;
  onLinked: () => void;
}

export default function LinkClaudeModal({ onClose, onLinked }: LinkClaudeModalProps) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [os, setOs] = useState<DetectedOs>(() => detectOs());

  const downloadHref = os === 'mac' ? '/install/mac-installer.zip' : '/install/install-claude-windows.bat';
  const downloadFilename = os === 'mac' ? 'mac-installer.zip' : 'install-claude.bat';

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
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
              Step 1: Install Claude and get your token
            </h3>
            <div className="mb-3 inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-900">
              {(['mac', 'windows'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setOs(option)}
                  className={`rounded px-3 py-1 font-medium transition ${
                    os === option
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {option === 'mac' ? 'macOS' : 'Windows'}
                </button>
              ))}
            </div>

            <a
              href={downloadHref}
              download={downloadFilename}
              className="block w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700"
            >
              Download installer for {os === 'mac' ? 'macOS' : 'Windows'}
            </a>

            <div className="mt-3 space-y-2 text-xs text-gray-500 dark:text-gray-400">
              {os === 'mac' ? (
                <>
                  <p>1. Open the downloaded file. macOS should auto-extract it into <code className="font-mono">install-claude.command</code>.</p>
                  <p>2. <b>Right-click</b> <code className="font-mono">install-claude.command</code> and choose <b>Open</b>. Click <b>Open</b> again in the warning dialog. (Double-clicking on first run will show an error &mdash; that&rsquo;s macOS Gatekeeper. Right-click is the standard workaround.)</p>
                  <p>3. A Terminal window opens and installs Claude. A browser opens for you to log in. When finished, a long token is printed in the Terminal window &mdash; copy it and paste it below.</p>
                </>
              ) : (
                <>
                  <p>1. Open the downloaded <code className="font-mono">install-claude.bat</code> file.</p>
                  <p>2. If Windows shows <b>&ldquo;Windows protected your PC&rdquo;</b>, click <b>More info</b>, then <b>Run anyway</b>.</p>
                  <p>3. A command window opens and installs Claude (and Git for Windows, if missing). A browser opens for you to log in. When finished, a long token is printed in the command window &mdash; copy it and paste it below.</p>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Step 2: Paste your token</h3>
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
            disabled={saving || !token.replace(/\s+/g, '')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
          >
            {saving ? 'Saving...' : 'Link Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
