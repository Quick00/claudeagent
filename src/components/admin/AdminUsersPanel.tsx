'use client';

import { useEffect, useState } from 'react';
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
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingConvos, setViewingConvos] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => {
        if (res.status === 403) { setError('Forbidden'); return []; }
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
      })
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const currentUserId = (session?.user as Record<string, unknown> | undefined)?.id;

  const setRole = async (userId: string, role: string) => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) { toast.error('Failed to change role'); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    toast.success('Role updated');
  };

  const setStatus = async (userId: string, status: 'APPROVED' | 'REJECTED') => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status }),
    });
    if (!res.ok) { toast.error('Failed to update user'); return; }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, status } : u)));
    toast.success(status === 'APPROVED' ? 'User approved' : 'User rejected');
  };

  const rejectUser = async (user: UserRow) => {
    const ok = await confirmDialog({
      title: `Reject ${user.name}?`,
      description: 'They will be denied access to this account.',
      confirmLabel: 'Reject',
    });
    if (!ok) return;
    await setStatus(user.id, 'REJECTED');
  };

  const deleteUser = async (user: UserRow) => {
    const ok = await confirmDialog({
      title: `Delete user "${user.name}"?`,
      description: 'This will also delete their conversations.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) { toast.error('Failed to delete user'); return; }
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    toast.success('User deleted');
  };

  if (loading) return <AdminTableSkeleton columns={7} />;

  return (
    <PageContainer>
      <RiseIn delay={0}>
        <PageHeader title="Users" description="Manage roles, approvals, and access." />
      </RiseIn>

      <RiseIn delay={0.06}>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
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
