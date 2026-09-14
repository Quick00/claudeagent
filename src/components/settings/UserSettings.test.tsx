import { act } from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as ReactDOMClient from 'react-dom/client';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';

/**
 * A stateful `/api/auth/claude/*` mock: link/unlink flip an in-memory flag
 * that subsequent status GETs reflect, so a test can prove the mutation's
 * `onSuccess` invalidation actually causes the status query to refetch and
 * pick up the change — not just that a request went out.
 */
function makeClaudeStatusFetchMock(initiallyLinked: boolean) {
  let linked = initiallyLinked;
  return jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/claude/status') {
      return { ok: true, json: async () => ({ linked, email: linked ? 'user@example.com' : null }) };
    }
    if (url === '/api/auth/claude/unlink' && init?.method === 'POST') {
      linked = false;
      return { ok: true, json: async () => ({}) };
    }
    if (url === '/api/auth/claude/link' && init?.method === 'POST') {
      linked = true;
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

/** A fresh, retry-off client per hydration pass — UserSettings now reads the
 * Claude status via `useQuery`, so it needs a provider even in this
 * server/client hydration reproduction, not just in `renderWithProviders`. */
function makeHydrationQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

const mockSetTheme = jest.fn();
// Mutable so the hydration test can reproduce the real bug: next-themes
// resolves `theme` as `undefined` on the server (no localStorage there) and
// only knows the real value — e.g. `'light'` — once mounted on the client.
let mockTheme: string | undefined = 'system';

jest.mock('next-themes', () => {
  const actual = jest.requireActual('next-themes') as object;
  return {
    ...actual,
    useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
  };
});

// `jest.mock` above is not hoisted in this project's SWC transform (see
// AppShell.test.tsx), so UserSettings — which imports `next-themes` — is
// pulled in via `require` after the mock is registered rather than a
// top-level `import`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UserSettings = (require('./UserSettings') as typeof import('./UserSettings')).default;

describe('UserSettings', () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    mockTheme = 'system';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ linked: false, email: null }),
    })) as unknown as typeof fetch;
  });

  test('calls setTheme with the chosen value when a ToggleGroup option is picked', async () => {
    const { user } = renderWithProviders(<UserSettings />);

    await user.click(await screen.findByRole('radio', { name: 'Light' }));

    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  test('calls setTheme with "dark" when Dark is picked', async () => {
    const { user } = renderWithProviders(<UserSettings />);

    await user.click(await screen.findByRole('radio', { name: 'Dark' }));

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  test('marks "System" as the checked option once mounted, when theme is unset', async () => {
    renderWithProviders(<UserSettings />);

    expect(await screen.findByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('hydrates with no console error even when the client resolves a different theme than the server', async () => {
    // The bug this guards against: next-themes can't resolve `theme` on the
    // server (no localStorage there), so a naive `value={theme ?? 'system'}`
    // makes the server HTML always mark "System" selected. Once the client
    // mounts and next-themes reads localStorage — say it finds `'light'` —
    // the naive code re-renders with "Light" selected instead, and React
    // logs exactly the observed bug:
    //   <button ... aria-label="System" ... + data-state="off" - data-state="on">
    //   <button ... aria-label="Light"  ... + data-state="on"  - data-state="off">
    // Render the real server HTML (`theme` unset, as it always is server-side)
    // with `renderToString`, then hydrate with `useTheme` now resolving to
    // `'light'` — reproducing the exact divergence — and assert React logs no
    // hydration-mismatch error, proving the `mounted` gate keeps the server
    // and first client paint identical regardless of the resolved theme.
    mockTheme = undefined;
    const html = ReactDOMServer.renderToString(
      <QueryClientProvider client={makeHydrationQueryClient()}>
        <UserSettings />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="System"');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const errors: unknown[] = [];
    const restoreError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    mockTheme = 'light';
    let root: ReactDOMClient.Root | undefined;
    try {
      await act(async () => {
        root = ReactDOMClient.hydrateRoot(
          container,
          <QueryClientProvider client={makeHydrationQueryClient()}>
            <UserSettings />
          </QueryClientProvider>,
        );
      });

      const hydrationErrors = errors.filter((args) =>
        String(args[0]).toLowerCase().includes('hydrat'),
      );
      expect(hydrationErrors).toEqual([]);

      // After the mount effect flips, the real (client-resolved) theme wins.
      const lightRadio = container.querySelector('[aria-label="Light"]');
      expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    } finally {
      console.error = restoreError;
      if (root) {
        await act(async () => {
          root!.unmount();
        });
      }
      container.remove();
    }
  });

  test('unlinking invalidates the Claude status query, so the card falls back to "Not connected"', async () => {
    const fetchMock = makeClaudeStatusFetchMock(true);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { user } = renderWithProviders(<UserSettings />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unlink Claude Account' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/claude/unlink',
      expect.objectContaining({ method: 'POST' }),
    );
    // Proves the mutation's onSuccess invalidated the status query — the
    // card re-fetches on its own rather than the old hand-set local state.
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });

  test('linking invalidates the Claude status query, so the card shows "Connected"', async () => {
    const fetchMock = makeClaudeStatusFetchMock(false);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { user } = renderWithProviders(<UserSettings />);

    await user.click(await screen.findByRole('button', { name: 'Link Claude Account' }));
    await user.type(
      await screen.findByPlaceholderText('Paste your Claude token here...'),
      'sk-test-token',
    );
    await user.click(screen.getByRole('button', { name: 'Link Account' }));

    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });
});
