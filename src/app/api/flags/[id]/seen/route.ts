import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('User not found', { status: 404 });
  }

  const { id } = await params;

  const flag = await prisma.flag.findFirst({
    where: { id, userId: user.id },
  });
  if (!flag) {
    return new Response('Flag not found', { status: 404 });
  }

  await prisma.flag.update({
    where: { id },
    data: { seenByUser: true },
  });

  return new Response(null, { status: 204 });
}
