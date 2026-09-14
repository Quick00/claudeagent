import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/hooks/use-confirm';

/**
 * A fresh client per render, with retries off: a test asserting an error state
 * should see it immediately rather than waiting out the production retry
 * policy, and cache must never leak between tests.
 */
function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeTestQueryClient()}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
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
