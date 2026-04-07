import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { token } = body as { token: string };

  if (!token?.trim()) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      claudeToken: encrypt(token.trim()),
      claudeEmail: session.user.email,
    },
  });

  return NextResponse.json({ success: true });
}
