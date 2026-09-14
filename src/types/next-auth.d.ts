import 'next-auth';

declare module 'next-auth' {
  /**
   * Fields the `session` callback in `src/lib/auth.ts` copies off the User row.
   * Declaring them here removes the `as Record<string, unknown>` casts at the
   * call sites.
   */
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      status: string;
    };
  }
}
