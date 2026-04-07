import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      claudeToken: null,
      claudeEmail: null,
    },
  });

  return NextResponse.json({ success: true });
}
