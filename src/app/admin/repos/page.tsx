'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format-date';

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
  const router = useRouter();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [gitlabProjects, setGitlabProjects] = useState<GitLabProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [modalProject, setModalProject] = useState<GitLabProject | null>(null);
  const [modalDescription, setModalDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editBranch, setEditBranch] = useState('');
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated') {
      fetchRepos();
      fetchGitLabProjects();
    }
  }, [status]);

  const fetchRepos = async () => {
    const res = await fetch('/api/admin/repos');
    if (res.status === 403) router.replace('/');
    if (res.ok) setRepos(await res.json());
  };

  const fetchGitLabProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/admin/gitlab/search');
      if (res.ok) setGitlabProjects(await res.json());
    } finally {
      setLoadingProjects(false);
    }
  };

  const addedIds = new Set(repos.map((r) => r.gitlabProjectId));
  const availableProjects = gitlabProjects.filter((p) => !addedIds.has(p.id));

  const addRepo = async () => {
    if (!modalProject || !modalDescription.trim()) return;
    setAddingId(modalProject.id);
    try {
      const res = await fetch('/api/admin/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: modalProject.name,
          description: modalDescription,
          gitlabProjectId: modalProject.id,
          gitlabUrl: modalProject.httpUrlToRepo,
          defaultBranch: modalProject.defaultBranch || 'main',
        }),
      });
      if (res.ok) {
        setModalProject(null);
        setModalDescription('');
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

  const saveBranch = async (repoId: string) => {
    setBranchSaving(true);
    setBranchError(null);
    try {
      const res = await fetch(`/api/admin/repos/${repoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultBranch: editBranch }),
      });
      if (res.ok) {
        setEditingBranchId(null);
        await fetchRepos();
      } else {
        let message = 'Failed to update branch';
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body — keep default message
        }
        setBranchError(message);
      }
    } finally {
      setBranchSaving(false);
    }
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
        <Link href="/" className="text-blue-500 hover:text-blue-400 text-sm">&larr; Back to chat</Link>
        <h1 className="text-2xl font-bold dark:text-white">Repositories</h1>
      </div>

      {/* Added Repos */}
      {repos.length > 0 && (
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b dark:border-gray-700">
                <th className="p-3 dark:text-gray-300">Name</th>
                <th className="p-3 dark:text-gray-300">Description</th>
                <th className="p-3 dark:text-gray-300">Branch</th>
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
                  <td className="p-3 dark:text-gray-300 text-sm">
                    {editingBranchId === repo.id ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <input
                            value={editBranch}
                            onChange={(e) => setEditBranch(e.target.value)}
                            className="w-36 px-2 py-1 rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm font-mono"
                            disabled={branchSaving}
                            autoFocus
                          />
                          <button onClick={() => saveBranch(repo.id)} disabled={branchSaving} className="text-green-500 text-sm disabled:opacity-50">
                            {branchSaving ? 'Syncing…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingBranchId(null); setBranchError(null); }}
                            disabled={branchSaving}
                            className="text-gray-500 text-sm disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                        {branchError && <p className="text-xs text-red-500 mt-1">{branchError}</p>}
                      </div>
                    ) : (
                      <span
                        onClick={() => { setEditingBranchId(repo.id); setEditBranch(repo.defaultBranch); setBranchError(null); }}
                        className="cursor-pointer hover:text-blue-400 font-mono"
                      >
                        {repo.defaultBranch}
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
                      ? formatDateTime(repo.lastPulledAt)
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
            </tbody>
          </table>
        </div>
      )}

      {/* Available GitLab Projects */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="text-lg font-semibold dark:text-white mb-3">
          Add from GitLab
          {!loadingProjects && availableProjects.length > 0 && (
            <span className="text-sm font-normal text-gray-400 ml-2">({availableProjects.length} available)</span>
          )}
        </h2>

        {loadingProjects ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading GitLab projects...</p>
        ) : availableProjects.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {gitlabProjects.length === 0
              ? 'No GitLab projects found. Check that GITLAB_TOKEN is configured with read_api scope.'
              : 'All GitLab projects have been added.'}
          </p>
        ) : (
          <div className="space-y-2">
            {availableProjects.map((project) => (
              <div key={project.id} className="flex items-center justify-between border dark:border-gray-600 rounded px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="font-medium dark:text-white text-sm">{project.nameWithNamespace}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {project.defaultBranch} &middot; {formatDateTime(project.lastActivityAt)}
                  </span>
                  {project.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{project.description}</p>
                  )}
                </div>
                <button
                  onClick={() => { setModalProject(project); setModalDescription(''); }}
                  className="ml-3 shrink-0 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Repo Modal */}
      {modalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalProject(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold dark:text-white mb-1">Add {modalProject.nameWithNamespace}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Write a description that helps route questions to this repo. Be specific about what the codebase does.
            </p>
            <textarea
              value={modalDescription}
              onChange={(e) => setModalDescription(e.target.value)}
              placeholder="e.g. 'Main web application handling user accounts, event management, dashboards, and billing'"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm mb-4"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModalProject(null)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                onClick={addRepo}
                disabled={!modalDescription.trim() || addingId === modalProject.id}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
              >
                {addingId === modalProject.id ? 'Cloning...' : 'Add Repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
