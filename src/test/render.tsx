import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/hooks/use-confirm';

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

/**
 * Renders inside the same provider stack as the real app and returns a
 * `userEvent` instance. `pointerEventsCheck: 0` is required: jsdom reports
 * `pointer-events: none` for Radix portals it has no stylesheet for.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  return { user, ...render(ui, { wrapper: AllProviders, ...options }) };
}

export * from '@testing-library/react';
