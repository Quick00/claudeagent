'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { MoreHorizontal, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { RiseIn } from '@/components/shared/RiseIn';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { AdminTableSkeleton } from '@/components/admin/AdminTableSkeleton';
import AdminUserConversationsPanel from '@/components/admin/AdminUserConversationsPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { apiFetch, jsonBody } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format-date';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  claudeLinked: boolean;
  createdAt: string;
}

export default function AdminUsersPanel() {
  const { data: session } = useSession();
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();
  const [viewingConvos, setViewingConvos] = useState<{ userId: string; name: string } | null>(null);

  const {
    data: users = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.users.list(),
    queryFn: () => apiFetch<UserRow[]>('/api/admin/users'),
  });

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: qk.users.list() });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiFetch('/api/admin/users', jsonBody('PATCH', { userId, role })),
    onSuccess: () => {
      invalidateUsers();
      toast.success('Role updated');
    },
    onError: () => toast.error('Failed to change role'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'APPROVED' | 'REJECTED' }) =>
      apiFetch('/api/admin/users', jsonBody('PATCH', { userId, status })),
    onSuccess: (_data, variables) => {
      invalidateUsers();
      toast.success(variables.status === 'APPROVED' ? 'User approved' : 'User rejected');
    },
    onError: () => toast.error('Failed to update user'),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiFetch('/api/admin/users', jsonBody('DELETE', { userId })),
    onSuccess: () => {
      invalidateUsers();
      toast.success('User deleted');
    },
    onError: () => toast.error('Failed to delete user'),
  });

  const currentUserId = (session?.user as Record<string, unknown> | undefined)?.id;

  const setRole = (userId: string, role: string) => roleMutation.mutate({ userId, role });

  const setStatus = (userId: string, status: 'APPROVED' | 'REJECTED') =>
    statusMutation.mutate({ userId, status });

  const rejectUser = async (user: UserRow) => {
    const ok = await confirmDialog({
      title: `Reject ${user.name}?`,
      description: 'They will be denied access to this account.',
      confirmLabel: 'Reject',
    });
    if (!ok) return;
    setStatus(user.id, 'REJECTED');
  };

  const deleteUser = async (user: UserRow) => {
    const ok = await confirmDialog({
      title: `Delete user "${user.name}"?`,
      description: 'This will also delete their conversations.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteMutation.mutate(user.id);
  };

  const showSkeleton = useDeferredSkeleton(isPending);

  if (isPending) return showSkeleton ? <AdminTableSkeleton columns={7} /> : null;

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader title="Users" description="Manage roles, approvals, and access." />
      </RiseIn>

      <RiseIn delay={0.06}>
      {isError ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users yet" description="Users will appear here once they sign in." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Claude</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    {isSelf ? (
                      <StatusBadge kind="role" value={user.role} />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent">
                            <StatusBadge kind="role" value={user.role} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem disabled={user.role === 'admin'} onSelect={() => setRole(user.id, 'admin')}>
                            Admin
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={user.role === 'user'} onSelect={() => setRole(user.id, 'user')}>
                            User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="userStatus" value={user.status} />
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-block size-2 rounded-full',
                        user.claudeLinked ? 'bg-success' : 'bg-muted-foreground/30',
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(user.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!isSelf && user.status !== 'APPROVED' && (
                          <DropdownMenuItem onSelect={() => setStatus(user.id, 'APPROVED')}>Approve</DropdownMenuItem>
                        )}
                        {!isSelf && user.status === 'PENDING' && (
                          <DropdownMenuItem onSelect={() => rejectUser(user)}>Reject</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setViewingConvos({ userId: user.id, name: user.name })}>
                          Conversations
                        </DropdownMenuItem>
                        {!isSelf && (
                          <DropdownMenuItem variant="destructive" onSelect={() => deleteUser(user)}>
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      </RiseIn>

      <Dialog open={viewingConvos !== null} onOpenChange={(open) => !open && setViewingConvos(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conversations — {viewingConvos?.name}</DialogTitle>
          </DialogHeader>
          {viewingConvos && <AdminUserConversationsPanel userId={viewingConvos.userId} />}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
