'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cable, Plus } from 'lucide-react';
import { AdminTableSkeleton } from '@/components/admin/AdminTableSkeleton';
import { McpServerEditDialog, needsManualClient, type McpServer } from '@/components/admin/McpServerEditDialog';
import { RegisterMcpServerDialog } from '@/components/admin/RegisterMcpServerDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';

const REGISTRATION_LABEL: Record<McpServer['registrationMode'], string> = { DYNAMIC: 'Dynamic', MANUAL: 'Manual' };

export default function AdminMcpServers() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: servers = [], isPending, isError, error } = useQuery({
    queryKey: qk.mcpServers.adminList(),
    queryFn: ({ signal }) => apiFetch<McpServer[]>('/api/admin/mcp-servers', { signal }),
  });

  const showSkeleton = useDeferredSkeleton(isPending);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.mcpServers.adminList() });

  // Looked up from the live list rather than held as a snapshot, so the dialog
  // reflects a refetch — e.g. the manual-client section goes once it is saved.
  const editingServer = servers.find((s) => s.id === editingId) ?? null;

  const addButton = (
    <Button onClick={() => setRegisterOpen(true)}>
      <Plus className="size-4" />
      Add server
    </Button>
  );

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/admin/mcp-servers/${id}`, jsonBody('PATCH', { enabled })),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to update server'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/mcp-servers/${id}`, jsonBody('DELETE')),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to delete server'),
  });

  // Same gate as the repos and users panels. Deleting a server cascades to
  // every user's McpServerConnection — their access and refresh tokens go
  // with it, and nothing revokes those upstream first — so a stray click
  // here is not something a user can undo from their own Settings.
  const handleDelete = async (server: McpServer) => {
    const ok = await confirmDialog({
      title: `Delete "${server.name}"?`,
      description:
        'Every user who connected their account to this server will be disconnected and will have to connect again. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (ok) deleteMutation.mutate(server.id);
  };

  return (
    <PageContainer className="space-y-8">
      <RiseIn delay={0}>
        <PageHeader
          title="MCP Servers"
          description="Remote MCP servers users can connect their own account to."
          actions={servers.length > 0 && addButton}
        />
      </RiseIn>

      <RiseIn delay={0.06}>
      {isPending ? (
        showSkeleton && <AdminTableSkeleton columns={5} container={false} />
      ) : (
      /* Nested RiseIn: this subtree mounts fresh the moment loading flips to
         false, so the loaded content arrives with the same rise/fade the rest
         of the page uses instead of popping in place. */
      <RiseIn delay={0}>
      {isError ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No MCP servers yet"
          description="Register one so users can connect their account to it."
          action={addButton}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Server URL</TableHead>
              <TableHead>Registration</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id} className="cursor-pointer" onClick={() => setEditingId(server.id)}>
                {/* max-w-0 + w-full lets this column take the spare width and truncate within it. */}
                <TableCell className="w-full max-w-0">
                  <p className="font-medium">{server.name}</p>
                  {server.description ? (
                    <p className="truncate text-xs text-muted-foreground" title={server.description}>
                      {server.description}
                    </p>
                  ) : (
                    <p className="truncate text-xs text-warning">
                      No description — Claude won&apos;t know when to look here
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <p className="max-w-64 truncate font-mono text-xs" title={server.serverUrl}>
                    {server.serverUrl}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline">{REGISTRATION_LABEL[server.registrationMode]}</Badge>
                    {needsManualClient(server) && <Badge variant="warning">Needs setup</Badge>}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={server.enabled}
                    aria-label={`Enable ${server.name}`}
                    disabled={needsManualClient(server)}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: server.id, enabled: checked })}
                  />
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" aria-label={`Edit ${server.name}`} onClick={() => setEditingId(server.id)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${server.name}`} onClick={() => handleDelete(server)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </RiseIn>
      )}
      </RiseIn>

      <McpServerEditDialog
        server={editingServer}
        onOpenChange={(open) => { if (!open) setEditingId(null); }}
        onSaved={invalidate}
      />
      <RegisterMcpServerDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={invalidate} />
    </PageContainer>
  );
}
