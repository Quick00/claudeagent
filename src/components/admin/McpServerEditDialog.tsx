'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, jsonBody } from '@/lib/api';

// Kept in step with `config.mcpServerDescriptionMaxLength`, which the API enforces.
const DESCRIPTION_MAX_LENGTH = 300;

export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  serverUrl: string;
  enabled: boolean;
  registrationMode: 'DYNAMIC' | 'MANUAL';
  clientId: string | null;
  callbackUrl: string;
}

export function needsManualClient(server: McpServer) {
  return server.registrationMode === 'MANUAL' && !server.clientId;
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
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="text-xs text-muted-foreground">
        {server.name} needs a client id — it does not support automatic registration. Register this app with the
        server first, using this redirect URI, then paste the credentials it gives you below.
      </p>
      <p className="font-mono text-xs break-all">{server.callbackUrl}</p>
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

// Mounted fresh each time the dialog opens (Radix unmounts closed content), so
// the draft always starts from what is saved rather than from an abandoned edit.
function EditForm({ server, onSaved, onClose }: { server: McpServer; onSaved: () => void; onClose: () => void }) {
  const [description, setDescription] = useState(server.description ?? '');
  const unchanged = description.trim() === (server.description ?? '');

  const saveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/mcp-servers/${server.id}`, jsonBody('PATCH', { description: description.trim() })),
    onSuccess: () => {
      toast.success(`Saved what ${server.name} is for`);
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to save the description'),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{server.name}</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">{server.serverUrl}</DialogDescription>
      </DialogHeader>

      {needsManualClient(server) && <ManualClientForm server={server} onSaved={onSaved} />}

      <Field>
        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel htmlFor={`mcp-description-${server.id}`}>When to use {server.name}</FieldLabel>
          <span className="text-xs tabular-nums text-muted-foreground">
            {description.length}/{DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id={`mcp-description-${server.id}`}
          rows={4}
          maxLength={DESCRIPTION_MAX_LENGTH}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Customer tickets, their status and history."
          autoFocus={!needsManualClient(server)}
        />
        <p className="text-xs text-muted-foreground">
          One or two sentences, in the words support staff use. Claude reads this to decide when to look here instead of
          in the code.
        </p>
      </Field>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={unchanged || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function McpServerEditDialog({
  server,
  onOpenChange,
  onSaved,
}: {
  server: McpServer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={server !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {server && <EditForm key={server.id} server={server} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
