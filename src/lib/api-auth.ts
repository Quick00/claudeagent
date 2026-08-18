import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { USER_STATUS } from '@/lib/user-approval';
import type { User } from '@prisma/client';

export type AuthResult = { ok: true; user: User } | { ok: false; response: Response };

async function getSessionUser(): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { ok: false, response: new Response('Unauthorized', { status: 401 }) };
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return { ok: false, response: new Response('User not found', { status: 404 }) };
  }

  return { ok: true, user };
}

/**
 * Resolves the signed-in user and rejects anyone whose account has not been
 * approved. Use this in every route that serves app data.
 */
export async function requireApprovedUser(): Promise<AuthResult> {
  const result = await getSessionUser();
  if (!result.ok) return result;

  if (result.user.status !== USER_STATUS.approved) {
    return { ok: false, response: new Response('Account not approved', { status: 403 }) };
  }

  return result;
}

/** As requireApprovedUser, but also requires the admin role. */
export async function requireAdminUser(): Promise<AuthResult> {
  const result = await requireApprovedUser();
  if (!result.ok) return result;

  if (result.user.role !== 'admin') {
    return { ok: false, response: new Response('Forbidden', { status: 403 }) };
  }

  return result;
}
