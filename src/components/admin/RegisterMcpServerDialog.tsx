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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { apiFetch, jsonBody } from '@/lib/api';

// Mounted fresh each time the dialog opens, so a cancelled draft never lingers.
function RegisterForm({ onRegistered, onClose }: { onRegistered: () => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [transport, setTransport] = useState<'HTTP' | 'SSE'>('HTTP');

  const addMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/mcp-servers', jsonBody('POST', { name, serverUrl, transport })),
    onSuccess: () => {
      onRegistered();
      onClose();
      toast.success('Server registered');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to register server'),
  });

  const canSubmit = name.trim() !== '' && serverUrl.trim() !== '' && !addMutation.isPending;

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) addMutation.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Register a server</DialogTitle>
        <DialogDescription>Users connect their own account to it from their Settings once it is enabled.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
        <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="sentry" autoFocus />
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit}>
          {addMutation.isPending ? 'Registering…' : 'Register server'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RegisterMcpServerDialog({
  open,
  onOpenChange,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <RegisterForm onRegistered={onRegistered} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
