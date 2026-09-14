import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

const mockSetTheme = jest.fn();

jest.mock('next-themes', () => {
  const actual = jest.requireActual('next-themes') as object;
  return {
    ...actual,
    useTheme: () => ({ theme: 'system', setTheme: mockSetTheme }),
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

  test('marks "System" as the checked option when theme is unset', async () => {
    renderWithProviders(<UserSettings />);

    expect(await screen.findByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
