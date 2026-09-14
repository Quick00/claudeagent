'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/hooks/use-confirm';
import { ThemeProvider } from './theme-provider';
import ApprovalGate from './ApprovalGate';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider>
          <ConfirmDialogProvider>
            <ApprovalGate>{children}</ApprovalGate>
            <Toaster richColors closeButton />
          </ConfirmDialogProvider>
        </TooltipProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
