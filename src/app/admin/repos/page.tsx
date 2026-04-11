'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import Link from 'next/link';

interface Repository {
  id: string;
  name: string;
  description: string;
  gitlabProjectId: number;
  gitlabUrl: string;
  defaultBranch: string;
  lastPulledAt: string | null;
  active: boolean;
  createdAt: string;
}

interface GitLabProject {
  id: number;
  name: string;
  nameWithNamespace: string;
  description: string | null;
  webUrl: string;
  httpUrlToRepo: string;
  defaultBranch: string;
  lastActivityAt: string;
}

export default function AdminReposPage() {
  const { status } = useSession();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GitLabProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') redirect('/login');
    if (status === 'authenticated') fetchRepos();
  }, [status]);

  const fetchRepos = async () => {
    const res = await fetch('/api/admin/repos');
    if (res.status === 403) redirect('/');
    if (res.ok) setRepos(await res.json());
  };

  const searchGitLab = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/gitlab/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const results = await res.json();
        const addedIds = new Set(repos.map((r) => r.gitlabProjectId));
        setSearchResults(results.filter((p: GitLabProject) => !addedIds.has(p.id)));
      }
    } finally {
      setSearching(false);
    }
  };

  const addRepo = async (project: GitLabProject) => {
    const description = descriptions[project.id];
    if (!description?.trim()) {
      alert('Please write a description for this repo — it helps route questions to the right codebase.');
      return;
    }
    setAddingId(project.id);
    try {
      const res = await fetch('/api/admin/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.name,
          description,
          gitlabProjectId: project.id,
          gitlabUrl: project.httpUrlToRepo,
          defaultBranch: project.defaultBranch || 'main',
        }),
      });
      if (res.ok) {
        setSearchResults((prev) => prev.filter((p) => p.id !== project.id));
        setDescriptions((prev) => {
          const next = { ...prev };
          delete next[project.id];
          return next;
        });
        await fetchRepos();
      }
    } finally {
      setAddingId(null);
    }
  };

  const toggleActive = async (repo: Repository) => {
    const res = await fetch(`/api/admin/repos/${repo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !repo.active }),
    });
    if (res.ok) await fetchRepos();
  };

  const saveDescription = async (repoId: string) => {
    const res = await fetch(`/api/admin/repos/${repoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDescription }),
    });
    if (res.ok) {
      setEditingId(null);
      await fetchRepos();
    }
  };

  const deleteRepo = async (repo: Repository) => {
    if (!confirm(`Delete "${repo.name}"? This will remove the local clone. Conversations and knowledge entries linked to this repo will be unlinked.`)) return;
    const res = await fetch(`/api/admin/repos/${repo.id}`, { method: 'DELETE' });
    if (res.ok) await fetchRepos();
  };

  if (status === 'loading') return null;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin/users" className="text-blue-500 hover:text-blue-400 text-sm">&larr; Users</Link>
        <h1 className="text-2xl font-bold dark:text-white">Repositories</h1>
      </div>

      {/* GitLab Search */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-lg font-semibold dark:text-white mb-3">Add from GitLab</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchGitLab()}
            placeholder="Search GitLab projects..."
            className="flex-1 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          <button
            onClick={searchGitLab}
            disabled={searching}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-3">
            {searchResults.map((project) => (
              <div key={project.id} className="border dark:border-gray-600 rounded p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-medium dark:text-white">{project.nameWithNamespace}</span>
                    {project.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{project.description}</p>
                    )}
                  </div>
                </div>
                <textarea
                  value={descriptions[project.id] || ''}
                  onChange={(e) => setDescriptions((prev) => ({ ...prev, [project.id]: e.target.value }))}
                  placeholder="Describe this repo for question routing (e.g. 'Main web application handling user accounts, dashboards, and billing')"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm mb-2"
                  rows={2}
                />
                <button
                  onClick={() => addRepo(project)}
                  disabled={addingId === project.id}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {addingId === project.id ? 'Cloning...' : 'Add Repository'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Repos Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b dark:border-gray-700">
              <th className="p-3 dark:text-gray-300">Name</th>
              <th className="p-3 dark:text-gray-300">Description</th>
              <th className="p-3 dark:text-gray-300">Status</th>
              <th className="p-3 dark:text-gray-300">Last Synced</th>
              <th className="p-3 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <tr key={repo.id} className="border-b dark:border-gray-700">
                <td className="p-3 dark:text-white font-medium">{repo.name}</td>
                <td className="p-3 dark:text-gray-300 max-w-md">
                  {editingId === repo.id ? (
                    <div className="flex gap-2">
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="flex-1 px-2 py-1 rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
                        rows={2}
                      />
                      <button onClick={() => saveDescription(repo.id)} className="text-green-500 text-sm">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-500 text-sm">Cancel</button>
                    </div>
                  ) : (
                    <span
                      onClick={() => { setEditingId(repo.id); setEditDescription(repo.description); }}
                      className="cursor-pointer hover:text-blue-400 text-sm"
                    >
                      {repo.description}
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggleActive(repo)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      repo.active
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {repo.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="p-3 text-sm dark:text-gray-400">
                  {repo.lastPulledAt
                    ? new Date(repo.lastPulledAt).toLocaleString()
                    : 'Cloning...'}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => deleteRepo(repo)}
                    className="text-red-500 hover:text-red-400 text-sm"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {repos.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500 dark:text-gray-400">
                  No repositories added yet. Search GitLab above to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
