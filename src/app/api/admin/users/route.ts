import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/api-auth';
import { isUserStatus, USER_STATUS } from '@/lib/user-approval';
import { NextResponse } from 'next/server';

export async function PATCH(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const currentUser = auth.user;

  const { userId, role, status } = (await request.json()) as {
    userId: string;
    role?: string;
    status?: string;
  };

  if (role === undefined && status === undefined) {
    return new Response('Nothing to update', { status: 400 });
  }

  if (role !== undefined && !['user', 'admin'].includes(role)) {
    return new Response('Invalid role', { status: 400 });
  }

  if (status !== undefined && !isUserStatus(status)) {
    return new Response('Invalid status', { status: 400 });
  }

  if (userId === currentUser.id) {
    return new Response('Cannot change your own account', { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(role === undefined ? {} : { role }),
      ...(status === undefined
        ? {}
        : {
            status,
            // Only approvals are worth an audit trail; anything else clears it.
            approvedAt: status === USER_STATUS.approved ? new Date() : null,
            approvedById: status === USER_STATUS.approved ? currentUser.id : null,
          }),
    },
    select: { id: true, role: true, status: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  const currentUser = auth.user;

  const { userId } = (await request.json()) as { userId: string };

  if (userId === currentUser.id) {
    return new Response('Cannot delete yourself', { status: 400 });
  }

  await prisma.user.delete({ where: { id: userId } });

  return new Response(null, { status: 204 });
}

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      status: true,
      claudeEmail: true,
      createdAt: true,
    },
  });

  const result = users
    // Accounts waiting on a decision come first.
    .sort((a, b) => Number(b.status === USER_STATUS.pending) - Number(a.status === USER_STATUS.pending))
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      status: user.status,
      claudeLinked: !!user.claudeEmail,
      createdAt: user.createdAt,
    }));

  return NextResponse.json(result);
}
