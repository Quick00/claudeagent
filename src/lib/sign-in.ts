import { prisma } from '@/lib/prisma';
import { getRequireUserApproval } from '@/lib/settings';
import { isUserStatus, resolveSignIn, USER_STATUS } from '@/lib/user-approval';
import { sendNewAccountNotification } from '@/lib/email';
import type { User } from '@prisma/client';

interface SignInInput {
  email: string;
  name: string;
  image?: string | null;
}

/**
 * Creates or refreshes the account behind a sign-in, applying the approval
 * setting and notifying admins about new accounts.
 *
 * Shared by both providers so the Google and test-credentials paths behave
 * identically.
 */
export async function applySignIn(
  input: SignInInput
): Promise<{ allowed: boolean; user: User | null }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  const existingStatus = isUserStatus(existing?.status) ? existing.status : null;
  const requireApproval = await getRequireUserApproval();
  const decision = resolveSignIn(existingStatus, requireApproval);

  if (!decision.allowed) {
    return { allowed: false, user: null };
  }

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      ...(input.image === undefined ? {} : { image: input.image }),
    },
    create: {
      email: input.email,
      name: input.name,
      image: input.image ?? null,
      status: decision.status,
    },
  });

  if (decision.notifyAdmins) {
    // Never let a mail failure block someone from signing in.
    try {
      await sendNewAccountNotification(
        { name: user.name, email: user.email },
        decision.status === USER_STATUS.pending
      );
    } catch (err) {
      console.error('Failed to send new account notification:', err);
    }
  }

  return { allowed: true, user };
}
