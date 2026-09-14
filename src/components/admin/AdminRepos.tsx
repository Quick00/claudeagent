'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { AdminTableSkeleton } from '@/components/admin/AdminTableSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/hooks/use-confirm';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
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

export default function AdminRepos() {
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();
  const [modalProject, setModalProject] = useState<GitLabProject | null>(null);
  const [modalDescription, setModalDescription] = useState('');
  const [modalBranch, setModalBranch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editBranch, setEditBranch] = useState('');
  const [branchError, setBranchError] = useState<string | null>(null);

  const {
    data: repos = [],
    isPending: loadingRepos,
    isError: reposErrored,
    error: reposError,
  } = useQuery({
    queryKey: qk.repos.list(),
    queryFn: () => apiFetch<Repository[]>('/api/admin/repos'),
  });

  // No search input exists in this panel yet — every load asks for the same
  // (unfiltered) project list, so the query key's `q` is always ''.
  // `placeholderData` still earns its keep: it's what stops the "Add from
  // GitLab" list from blanking out during a background refetch.
  const {
    data: gitlabProjects = [],
    isPending: loadingProjects,
    isError: projectsErrored,
    error: projectsError,
  } = useQuery({
    queryKey: qk.repos.gitlabSearch(''),
    queryFn: () => apiFetch<GitLabProject[]>('/api/admin/gitlab/search'),
    placeholderData: keepPreviousData,
  });

  const invalidateRepos = () => queryClient.invalidateQueries({ queryKey: qk.repos.list() });

  const addRepoMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      description: string;
      gitlabProjectId: number;
      gitlabUrl: string;
      defaultBranch: string;
    }) => apiFetch('/api/admin/repos', jsonBody('POST', payload)),
    onSuccess: () => {
      invalidateRepos();
      setModalProject(null);
      setModalDescription('');
      toast.success('Repository added');
    },
    onError: () => toast.error('Failed to add repository'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiFetch(`/api/admin/repos/${id}`, jsonBody('PATCH', { active })),
    onSuccess: invalidateRepos,
    onError: () => toast.error('Failed to update repository'),
  });

  const saveBranchMutation = useMutation({
    mutationFn: ({ id, defaultBranch }: { id: string; defaultBranch: string }) =>
      apiFetch(`/api/admin/repos/${id}`, jsonBody('PATCH', { defaultBranch })),
    onSuccess: () => {
      invalidateRepos();
      setEditingBranchId(null);
      setBranchError(null);
      toast.success('Branch updated');
    },
    onError: (err) => setBranchError(err instanceof Error ? err.message : 'Failed to update branch'),
  });

  const saveDescriptionMutation = useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      apiFetch(`/api/admin/repos/${id}`, jsonBody('PATCH', { description })),
    onSuccess: () => {
      invalidateRepos();
      setEditingId(null);
      toast.success('Description updated');
    },
    onError: () => toast.error('Failed to update description'),
  });

  const deleteRepoMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/repos/${id}`, jsonBody('DELETE')),
    onSuccess: () => {
      invalidateRepos();
      toast.success('Repository deleted');
    },
    onError: () => toast.error('Failed to delete repository'),
  });

  const addedIds = new Set(repos.map((r) => r.gitlabProjectId));
  const availableProjects = gitlabProjects.filter((p) => !addedIds.has(p.id));
  const showReposSkeleton = useDeferredSkeleton(loadingRepos);
  const showProjectsSkeleton = useDeferredSkeleton(loadingProjects);

  const addRepo = () => {
    if (!modalProject || !modalDescription.trim() || !modalBranch.trim()) return;
    addRepoMutation.mutate({
      name: modalProject.name,
      description: modalDescription,
      gitlabProjectId: modalProject.id,
      gitlabUrl: modalProject.httpUrlToRepo,
      defaultBranch: modalBranch.trim(),
    });
  };

  const toggleActive = (repo: Repository) =>
    toggleActiveMutation.mutate({ id: repo.id, active: !repo.active });

  const saveBranch = (repoId: string) => {
    setBranchError(null);
    saveBranchMutation.mutate({ id: repoId, defaultBranch: editBranch });
  };

  const saveDescription = (repoId: string) =>
    saveDescriptionMutation.mutate({ id: repoId, description: editDescription });

  const deleteRepo = async (repo: Repository) => {
    const ok = await confirmDialog({
      title: `Delete "${repo.name}"?`,
      description: 'This will remove the local clone. Conversations and knowledge entries linked to this repo will be unlinked.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteRepoMutation.mutate(repo.id);
  };

  const addingId = addRepoMutation.isPending ? modalProject?.id ?? null : null;
  const branchSaving = saveBranchMutation.isPending;

  return (
    <PageContainer className="space-y-8">
      <RiseIn delay={0}>
        <PageHeader title="Repositories" description="Repositories Claude can read from when answering questions." />
      </RiseIn>

      <RiseIn delay={0.06}>
      <div>
        {loadingRepos ? (
          showReposSkeleton && <AdminTableSkeleton columns={6} container={false} />
        ) : (
        /* Nested RiseIn: mounts fresh the moment loading flips to false, so
           the loaded content arrives with the same rise/fade the rest of
           the page uses instead of popping in place. */
        <RiseIn delay={0}>
        {reposErrored ? (
          <p className="text-sm text-destructive">{reposError.message}</p>
        ) : repos.length === 0 ? (
          <EmptyState icon={FolderGit2} title="No repositories yet" description="Add one from GitLab below." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Synced</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id}>
                  <TableCell className="font-medium">{repo.name}</TableCell>
                  <TableCell className="max-w-md">
                    {editingId === repo.id ? (
                      <div className="flex items-start gap-2">
                        <Textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="text-sm"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" onClick={() => saveDescription(repo.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingId(repo.id); setEditDescription(repo.description); }}
                        className="h-auto justify-start whitespace-normal p-0 text-left text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
                      >
                        {repo.description}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {editingBranchId === repo.id ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={editBranch}
                            onChange={(e) => setEditBranch(e.target.value)}
                            className="w-36 font-mono text-sm"
                            disabled={branchSaving}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" disabled={branchSaving} onClick={() => saveBranch(repo.id)}>
                            {branchSaving ? 'Syncing…' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={branchSaving}
                            onClick={() => { setEditingBranchId(null); setBranchError(null); }}
                          >
                            Cancel
                          </Button>
                        </div>
                        {branchError && <p className="mt-1 text-xs text-destructive">{branchError}</p>}
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingBranchId(repo.id); setEditBranch(repo.defaultBranch); setBranchError(null); }}
                        className="h-auto p-0 font-mono text-muted-foreground hover:bg-transparent hover:text-foreground"
                      >
                        {repo.defaultBranch}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={repo.active} onCheckedChange={() => toggleActive(repo)} />
                      <span className="text-xs text-muted-foreground">{repo.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {repo.lastPulledAt ? formatDateTime(repo.lastPulledAt) : 'Cloning…'}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${repo.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onSelect={() => deleteRepo(repo)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </RiseIn>
        )}
      </div>
      </RiseIn>

      <RiseIn delay={0.12} className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">
          Add from GitLab
          {!loadingProjects && availableProjects.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">({availableProjects.length} available)</span>
          )}
        </h2>

        {loadingProjects ? (
          showProjectsSkeleton && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )
        ) : (
        /* Nested RiseIn: mounts fresh the moment loading flips to false, so
           the loaded content arrives with the same rise/fade the rest of
           the page uses instead of popping in place. */
        <RiseIn delay={0}>
        {projectsErrored ? (
          <p className="text-sm text-destructive">{projectsError.message}</p>
        ) : availableProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {gitlabProjects.length === 0
              ? 'No GitLab projects found. Check that GITLAB_TOKEN is configured with read_api scope.'
              : 'All GitLab projects have been added.'}
          </p>
        ) : (
          <div className="space-y-2">
            {availableProjects.map((project) => (
              <div key={project.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{project.nameWithNamespace}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {project.defaultBranch} &middot; {formatDateTime(project.lastActivityAt)}
                  </span>
                  {project.description && (
                    <p className="truncate text-xs text-muted-foreground">{project.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="ml-3 shrink-0"
                  onClick={() => { setModalProject(project); setModalDescription(''); setModalBranch(project.defaultBranch || 'main'); }}
                >
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
        </RiseIn>
        )}
      </RiseIn>

      <Dialog open={modalProject !== null} onOpenChange={(open) => !open && setModalProject(null)}>
        <DialogContent>
          {modalProject && (
            <>
              <DialogHeader>
                <DialogTitle>Add {modalProject.nameWithNamespace}</DialogTitle>
                <DialogDescription>
                  Write a description that helps route questions to this repo. Be specific about what the codebase does.
                </DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="repo-description">Description</FieldLabel>
                <Textarea
                  id="repo-description"
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                  placeholder="e.g. 'Main web application handling user accounts, event management, dashboards, and billing'"
                  rows={3}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="repo-branch">Branch</FieldLabel>
                <Input
                  id="repo-branch"
                  value={modalBranch}
                  onChange={(e) => setModalBranch(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setModalProject(null)}>Cancel</Button>
                <Button
                  onClick={addRepo}
                  disabled={!modalDescription.trim() || !modalBranch.trim() || addingId === modalProject.id}
                >
                  {addingId === modalProject.id ? 'Cloning...' : 'Add Repository'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
