import { NextResponse } from 'next/server';
import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';

export async function POST(request: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const body = await request.json();
  const { token } = body as { token: string };
  const cleaned = token?.replace(/\s+/g, '');

  if (!cleaned) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      claudeToken: encrypt(cleaned),
      claudeEmail: user.email,
    },
  });

  return NextResponse.json({ success: true });
}
