/**
 * Accounts listed in `BLOCKED_EMAILS` (comma-separated, case-insensitive) are
 * sent to `/no-access` by the proxy. Like `MAINTENANCE_MODE`, it is an env
 * switch: clear the entry and the account gets straight back in.
 */
export function isBlockedEmail(
  email: string | null | undefined,
  list: string | undefined = process.env.BLOCKED_EMAILS,
): boolean {
  if (!email || !list) return false;
  const target = email.trim().toLowerCase();
  return list
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry !== '' && entry === target);
}
