import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

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
