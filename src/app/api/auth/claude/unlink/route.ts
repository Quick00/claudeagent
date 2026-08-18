import { NextResponse } from 'next/server';
import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      claudeToken: null,
      claudeEmail: null,
    },
  });

  return NextResponse.json({ success: true });
}
