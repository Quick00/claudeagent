export const USER_STATUS = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export function isUserStatus(value: unknown): value is UserStatus {
  return value === USER_STATUS.pending || value === USER_STATUS.approved || value === USER_STATUS.rejected;
}

export interface SignInDecision {
  /** Whether NextAuth should let the sign-in through at all. */
  allowed: boolean;
  /** Status to persist for a newly created account. */
  status: UserStatus;
  /** Whether this sign-in created an account admins should be told about. */
  notifyAdmins: boolean;
}

/**
 * Decides what happens when someone signs in.
 *
 * A rejected account is turned away outright — otherwise signing in again
 * would quietly reset it to pending. Pending accounts are allowed through so
 * they can reach the "waiting for approval" screen; the API guards keep them
 * away from everything else.
 */
export function resolveSignIn(
  existingStatus: UserStatus | null,
  requireApproval: boolean
): SignInDecision {
  if (existingStatus === null) {
    return {
      allowed: true,
      status: requireApproval ? USER_STATUS.pending : USER_STATUS.approved,
      notifyAdmins: true,
    };
  }

  if (existingStatus === USER_STATUS.rejected) {
    return { allowed: false, status: USER_STATUS.rejected, notifyAdmins: false };
  }

  return { allowed: true, status: existingStatus, notifyAdmins: false };
}
