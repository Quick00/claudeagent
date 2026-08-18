'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import ThemeProvider from './ThemeProvider';
import ApprovalGate from './ApprovalGate';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ApprovalGate>{children}</ApprovalGate>
      </ThemeProvider>
    </SessionProvider>
  );
}
