'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cable } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useConfirm } from '@/hooks/use-confirm';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';

interface McpServer {
  id: string;
  name: string;
  serverUrl: string;
  enabled: boolean;
  registrationMode: 'DYNAMIC' | 'MANUAL';
  clientId: string | null;
  callbackUrl: string;
}

function ManualClientForm({ server, onSaved }: { server: McpServer; onSaved: () => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/mcp-servers/${server.id}`, jsonBody('PATCH', { clientId, clientSecret: clientSecret || undefined })),
    onSuccess: () => {
      toast.success(`Client saved for ${server.name}`);
      onSaved();
    },
    onError: () => toast.error('Failed to save client credentials'),
  });

  return (
    <div className="mt-2 space-y-2 rounded border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {server.name} needs a client id — it does not support automatic registration. Register this app with the
        server first, using this redirect URI, then paste the credentials it gives you below.
      </p>
      <p className="font-mono text-xs">{server.callbackUrl}</p>
      <Field>
        <FieldLabel htmlFor={`manual-client-${server.id}`}>Client ID</FieldLabel>
        <Input id={`manual-client-${server.id}`} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`manual-secret-${server.id}`}>Client Secret (optional)</FieldLabel>
        <Input
          id={`manual-secret-${server.id}`}
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </Field>
      <Button size="sm" disabled={!clientId.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? 'Saving…' : 'Save Client'}
      </Button>
    </div>
  );
}

export default function AdminMcpServers() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [transport, setTransport] = useState<'HTTP' | 'SSE'>('HTTP');

  const { data: servers = [], isPending, isError, error } = useQuery({
    queryKey: qk.mcpServers.adminList(),
    queryFn: ({ signal }) => apiFetch<McpServer[]>('/api/admin/mcp-servers', { signal }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.mcpServers.adminList() });

  const addMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/mcp-servers', jsonBody('POST', { name, serverUrl, transport })),
    onSuccess: () => {
      invalidate();
      setName('');
      setServerUrl('');
      setTransport('HTTP');
      toast.success('Server registered');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to register server'),
  });

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
      <PageHeader title="MCP Servers" description="Remote MCP servers users can connect their own account to." />

      {isPending ? null : isError ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : servers.length === 0 ? (
        <EmptyState icon={Cable} title="No MCP servers yet" description="Register one below." />
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
              <Fragment key={server.id}>
                <TableRow>
                  <TableCell className="font-medium">{server.name}</TableCell>
                  <TableCell className="font-mono text-xs">{server.serverUrl}</TableCell>
                  <TableCell>{server.registrationMode}</TableCell>
                  <TableCell>
                    <Switch
                      checked={server.enabled}
                      aria-label={`Enable ${server.name}`}
                      disabled={server.registrationMode === 'MANUAL' && !server.clientId}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: server.id, enabled: checked })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" aria-label={`Delete ${server.name}`} onClick={() => handleDelete(server)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
                {server.registrationMode === 'MANUAL' && !server.clientId && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <ManualClientForm server={server} onSaved={invalidate} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Register a server</h2>
        <Field>
          <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
          <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="sentry" />
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-url">Server URL</FieldLabel>
          <Input
            id="mcp-url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-transport">Transport</FieldLabel>
          <ToggleGroup
            id="mcp-transport"
            type="single"
            variant="outline"
            value={transport}
            onValueChange={(value) => { if (value) setTransport(value as 'HTTP' | 'SSE'); }}
          >
            <ToggleGroupItem value="HTTP">HTTP</ToggleGroupItem>
            <ToggleGroupItem value="SSE">SSE</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Button disabled={!name.trim() || !serverUrl.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? 'Registering…' : 'Add Server'}
        </Button>
      </div>
    </PageContainer>
  );
}
