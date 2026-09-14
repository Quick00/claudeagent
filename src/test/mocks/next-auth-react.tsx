import type { ReactNode } from 'react';
import { jest } from '@jest/globals';

type MockSession = {
  user: { id: string; name?: string; email?: string; image?: string; role: string; status: string };
  expires: string;
} | null;

let session: MockSession = null;
let status: 'authenticated' | 'unauthenticated' | 'loading' = 'unauthenticated';

export function setMockSession(next: MockSession) {
  session = next;
  status = next ? 'authenticated' : 'unauthenticated';
}

export const useSession = () => ({ data: session, status, update: jest.fn() });
export const signIn = jest.fn();
export const signOut = jest.fn();
export const getSession = jest.fn(async () => session);
export function SessionProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
